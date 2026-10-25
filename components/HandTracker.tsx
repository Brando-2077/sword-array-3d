/**
 * HandTracker — 手势捕捉（谷歌官方预训练方案）
 * @version 6.0 废弃自研判定，全面改用 MediaPipe GestureRecognizer
 * @description
 *   v4.2~v5.1 的自研手指判定（关节角/距离比）实测不可用，整体废弃。
 *   本版直接采用 Google 官方 **GestureRecognizer** 预训练模型：
 *   - 模型直接输出识别好的手势（✊☝✌🤘👍👋），零自定义手指几何
 *   - 同一模型同时输出 21 点 landmarks（骨骼可视化/掌心定位/测距）
 *
 *   七式映射（全部官方预训练手势）：
 *     无手 → 御剑巡空   ✊ Closed_Fist → 千丝绞杀   ☝ Point_Up → 青元剑芒
 *     ✌ Victory → 剑影分光术   🤘 ILoveYou → 青元剑盾
 *     👍 Thumb_Up/Down → 通天剑阵   👋 Open_Palm → 大庚剑阵
 *
 *   左手（数量/速度/锁定）用同一套手势映射：
 *     ☝=32 ✌=64 🤘=128 👍=256 👋=512 ✊=冻结
 *
 *   距离 = 几何测距（掌长画面占比 × FOV 反推 cm），与手势识别无关。
 *   手势稳定性 = 时序投票（同一手势持续 ~200ms 才切换）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  GestureRecognizer, FilesetResolver, GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import {
  FormationState, HandData, HandRole, InteractionData,
  SWORD_COUNT_BY_FINGER, SPEED_LEVELS, SCALE_MIN, SCALE_MAX,
} from '../types';

export type HandTrackerStatus = 'loading' | 'active' | 'error' | 'no-cam' | 'no-permission';

export interface HandTrackerProps {
  onUpdate: (data: InteractionData) => void;
}

// ─── 官方模型（已本地化到 public/，摆脱对谷歌网络的运行时依赖） ──
// 背景：storage.googleapis.com 在部分网络时断时续，模型拉不下来时
// 识别器永远起不来 → 所有参数僵死。本地优先，远端兜底。
const MODEL_LOCAL = '/models/gesture_recognizer.task';
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const WASM_BASE = '/mediapipe-wasm';

// ─── 手势 → 指数 映射（官方手势名；右手查阵式，左手查数量） ──
const GESTURE_TO_FINGERS: Record<string, number> = {
  Closed_Fist: 0,
  Point_Up: 1,
  Victory: 2,
  ILoveYou: 3,
  Thumb_Up: 4,
  Thumb_Down: 4,
  Open_Palm: 5,
};
const GESTURE_CN: Record<string, string> = {
  Closed_Fist: '✊握拳', Point_Up: '☝食指', Victory: '✌剪刀',
  ILoveYou: '🤘ROCK', Thumb_Up: '👍点赞', Thumb_Down: '👎点赞',
  Open_Palm: '👋摊掌', None: '…',
};

// ─── 测距参数（几何法，与手势无关） ────────────────
const PALM_CM = 9.0;    // 手腕横纹→中指根典型掌长
const VFOV_DEG = 52;    // 典型网络摄像头垂直视场角
const NEAR_CM = 35, FAR_CM = 140;
const SMOOTH_POS = 0.35, SMOOTH_DIST = 0.20;
const SCALE_SMOOTH = 0.30, SPEED_SMOOTH = 0.40;
const GESTURE_STABLE_FRAMES = 5;   // ~200ms @24fps
const FRAME_INTERVAL_MS = 42;
const DEBUG_PANEL = true;

const VIRTUAL_CAM_RE = /droidcam|virtual|e2esoft|manycam|obs|snap camera/i;

// MediaPipe 官方约定：标签按镜像输入判定，我们送原始帧 → 需对调
const SWAP_HANDEDNESS = true;

// ─── 21 点手骨拓扑（官方 HAND_CONNECTIONS） ─────────
const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],
  [13,14],[14,15],[15,16],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],[0,17],
];

type WLM = { x: number; y: number; z: number };

// ─── 单手状态机：手势时序投票 + 掌心/测距平滑 ────────
class HandState {
  private candGesture = 'None';
  private candFrames = 0;
  private stableGesture = 'None';
  private sx = 0.5; private sy = 0.5;
  private sd = 0.5;
  private seen = false;
  private normSm: WLM[] = [];

  /** 输入本帧手势名+landmarks，输出稳定手势/掌心/距离(cm) */
  update(gesture: string, norm: WLM[], nowMs: number): {
    gesture: string; fingerCount: number; x: number; y: number; distance: number; distCm: number; normSm: WLM[];
  } {
    // 手势时序投票
    if (gesture === this.candGesture) this.candFrames++;
    else { this.candGesture = gesture; this.candFrames = 1; }
    if (this.candFrames >= GESTURE_STABLE_FRAMES || this.stableGesture === 'None') {
      this.stableGesture = gesture;
    }

    // 关键点 EMA 平滑（骨骼绘制与掌心共用）
    const a = 0.45;
    if (this.normSm.length === 0) this.normSm = norm.map((p: WLM) => ({ x: p.x, y: p.y, z: p.z }));
    else for (let kk = 0; kk < 21; kk++) {
      const s = this.normSm[kk], n = norm[kk];
      s.x += (n.x - s.x) * a; s.y += (n.y - s.y) * a; s.z += (n.z - s.z) * a;
    }
    const nm = this.normSm;

    // 掌心 = 中指根(9)
    const k = this.seen ? SMOOTH_POS : 1.0;
    this.sx += (nm[9].x - this.sx) * k;
    this.sy += (nm[9].y - this.sy) * k;

    // 几何测距：三根掌骨均值（4:3 拉正）→ 真实 cm → 0~1
    const ax = 4 / 3;
    const spanPx = (
      Math.hypot((norm[0].x - norm[5].x) * ax, norm[0].y - norm[5].y) +
      Math.hypot((norm[0].x - norm[9].x) * ax, norm[0].y - norm[9].y) +
      Math.hypot((norm[0].x - norm[17].x) * ax, norm[0].y - norm[17].y)
    ) / 3;
    const distCm = PALM_CM / (2 * Math.max(spanPx, 1e-4) * Math.tan((VFOV_DEG * Math.PI / 180) / 2));
    const d01 = Math.max(0, Math.min(1, (FAR_CM - distCm) / (FAR_CM - NEAR_CM)));
    this.sd += (d01 - this.sd) * (this.seen ? SMOOTH_DIST : 1.0);

    this.seen = true;
    return {
      gesture: this.stableGesture,
      fingerCount: GESTURE_TO_FINGERS[this.stableGesture] ?? 0,
      x: this.sx, y: this.sy, distance: this.sd, distCm,
      normSm: nm,
    };
  }
}

// ─── 主组件 ──────────────────────────────────────
const HandTracker: React.FC<HandTrackerProps> = ({ onUpdate }) => {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const skelCanvasRef = useRef<HTMLCanvasElement>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const rafIdRef      = useRef<number>(0);
  const lastFrameRef  = useRef<number>(0);
  const busyRef       = useRef<boolean>(false);

  const [status, setStatus]     = useState<HandTrackerStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [cameras, setCameras]   = useState<MediaDeviceInfo[]>([]);
  const [camIdx, setCamIdx]     = useState(0);
  const camIdxRef = useRef(0);
  const videoConstraints = {
    width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 },
  };

  // 调试读数（5Hz）
  const [dbg, setDbg] = useState<{ l: string; r: string }>({ l: '', r: '' });
  const dbgRef = useRef({ t: 0 });

  // 派生稳定状态
  const stableRef = useRef({ scale: 15, count: 128, speed: 0.75, locked: false });
  const smoothScale = useRef({ v: 15 });
  const smoothSpeed = useRef({ v: 0.75 });
  const states = useRef({ L: new HandState(), R: new HandState() });
  const lastRGesture = useRef<string>('None');

  useEffect(() => {
    let active = true;

    const tick = (now: number) => {
      if (!active) return;
      rafIdRef.current = requestAnimationFrame(tick);
      if (now - lastFrameRef.current < FRAME_INTERVAL_MS) return;
      if (!videoRef.current) return;
      const video = videoRef.current;
      if (video.paused || video.readyState < 2) return;
      if (busyRef.current) return;
      lastFrameRef.current = now;
      busyRef.current = true;
      try {
        const result = recognizerRef.current?.recognizeForVideo(video, now);
        if (result) onResults(result, now);
      } catch (e) {
        console.warn('[HandTracker] recognize 失败:', e);
      } finally {
        busyRef.current = false;
      }
    };

    const onResults = (result: GestureRecognizerResult, now: number) => {
      const nHands = result.landmarks?.length ?? 0;
      if (nHands === 0) {
        const sctx0 = skelCanvasRef.current?.getContext('2d');
        if (sctx0) sctx0.clearRect(0, 0, sctx0.canvas.width, sctx0.canvas.height);
        setDbg5({ l: '—', r: '—' });
        onUpdate({
          left:  blankHand(HandRole.LEFT),
          right: blankHand(HandRole.RIGHT),
          cursorX: 0.5, cursorY: 0.5, cursorActive: false,
          formation: FormationState.IDLE,
          swordScale: stableRef.current.scale,
          swordCount: stableRef.current.count,
          animSpeed:  stableRef.current.speed,
          locked:     stableRef.current.locked,
        });
        return;
      }

      // 分类左右手（官方镜像约定对调）
      let leftIdx = -1, rightIdx = -1;
      for (let i = 0; i < nHands; i++) {
        const label = result.handedness?.[i]?.[0]?.categoryName || result.handedness?.[i]?.[0]?.displayName;
        const isUserRight = SWAP_HANDEDNESS ? label === 'Left' : label === 'Right';
        if (isUserRight && rightIdx < 0) rightIdx = i;
        else if (!isUserRight && leftIdx < 0) leftIdx = i;
      }

      const L = analyze(HandRole.LEFT,  leftIdx,  result, states.current.L, now);
      const R = analyze(HandRole.RIGHT, rightIdx, result, states.current.R, now);
      const left = L.hand, right = R.hand;

      // LIVE 骨骼可视化
      const sctx = skelCanvasRef.current?.getContext('2d');
      if (sctx) {
        const hands: { norm: WLM[]; isRight: boolean; label: string }[] = [];
        if (L.normSm) hands.push({ norm: L.normSm, isRight: false, label: `左 ${GESTURE_CN[L.gesture] ?? L.gesture}` });
        if (R.normSm) hands.push({ norm: R.normSm, isRight: true,  label: `右 ${GESTURE_CN[R.gesture] ?? R.gesture}` });
        drawHandSkeleton(sctx, hands);
      }
      if (DEBUG_PANEL) {
        setDbg5({
          l: left.detected  ? `${GESTURE_CN[L.gesture] ?? L.gesture} ${left.distCm ? (left.distCm|0) : '?'}cm` : '—',
          r: right.detected ? `${GESTURE_CN[R.gesture] ?? R.gesture} ${right.distCm ? (right.distCm|0) : '?'}cm` : '—',
        });
      }

      // ── 派生参数 ──
      const locked = left.detected && left.fingerCount === 0; // ✊ 冻结
      stableRef.current.locked = locked;

      if (!locked && right.detected) {
        const target = SCALE_MIN + right.distance * (SCALE_MAX - SCALE_MIN);
        smoothScale.current.v = smoothScale.current.v * (1 - SCALE_SMOOTH) + target * SCALE_SMOOTH;
      }
      stableRef.current.scale = smoothScale.current.v;

      if (!locked && left.detected && left.fingerCount > 0 && SWORD_COUNT_BY_FINGER[left.fingerCount] !== undefined) {
        stableRef.current.count = SWORD_COUNT_BY_FINGER[left.fingerCount];
      }

      if (!locked && left.detected) {
        const level = Math.max(0, Math.min(4, Math.round(left.distance * 4)));
        const target = SPEED_LEVELS[level].value;
        smoothSpeed.current.v = smoothSpeed.current.v * (1 - SPEED_SMOOTH) + target * SPEED_SMOOTH;
      }
      stableRef.current.speed = smoothSpeed.current.v;

      // 右手手势 → 阵式（None 保持上一阵，避免闪跳）
      if (right.detected && R.gesture !== 'None') lastRGesture.current = R.gesture;
      const formation = right.detected && R.gesture !== 'None'
        ? pickFormation(R.gesture)
        : (right.detected ? pickFormation(lastRGesture.current) : FormationState.IDLE);

      onUpdate({
        left, right,
        cursorX: right.detected ? 1 - right.x : 0.5,
        cursorY: right.detected ? right.y : 0.5,
        cursorActive: right.detected,
        formation,
        swordScale: stableRef.current.scale,
        swordCount: stableRef.current.count,
        animSpeed:  stableRef.current.speed,
        locked,
      });
    };

    const setDbg5 = (v: { l: string; r: string }) => {
      const nowT = performance.now();
      if (nowT - dbgRef.current.t > 200) { dbgRef.current.t = nowT; setDbg(v); }
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持 getUserMedia');
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t: MediaStreamTrack) => t.stop());

        const allCams = (await navigator.mediaDevices.enumerateDevices())
          .filter((d: MediaDeviceInfo) => d.kind === 'videoinput');
        if (allCams.length === 0) throw Object.assign(new Error('未检测到摄像头设备'), { name: 'NotFoundError' });
        const preferred = allCams.find((d: MediaDeviceInfo) => !VIRTUAL_CAM_RE.test(d.label)) ?? allCams[0];
        setCameras(allCams);
        camIdxRef.current = Math.max(0, allCams.indexOf(preferred));
        setCamIdx(camIdxRef.current);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: preferred.deviceId }, ...videoConstraints },
          audio: false,
        });
        streamRef.current = stream;
        if (!videoRef.current) throw new Error('视频元素未就绪');
        const video = videoRef.current;
        video.srcObject = stream;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => video.play().then(() => resolve()).catch(reject);
          setTimeout(() => reject(new Error('摄像头启动超时')), 5000);
        });

        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        let recognizer: GestureRecognizer;
        try {
          recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_LOCAL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        } catch {
          // 本地模型缺失（如旧部署）时回退远端；GPU 不支持时回退 CPU
          recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_REMOTE, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          }).catch(() => GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_LOCAL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          }));
        }
        recognizerRef.current = recognizer;
        if (!active) { recognizer.close(); return; }

        setStatus('active');
        lastFrameRef.current = 0;
        rafIdRef.current = requestAnimationFrame(tick);
      } catch (err: any) {
        console.error('[HandTracker] 启动失败:', err);
        if (!active) return;
        const name = err?.name || '';
        if (name === 'NotAllowedError') { setStatus('no-permission'); setErrorMsg('摄像头权限被拒绝'); }
        else if (name === 'NotFoundError') { setStatus('no-cam'); setErrorMsg('未检测到摄像头设备'); }
        else if (name === 'NotReadableError') { setStatus('error'); setErrorMsg('摄像头被其他应用占用'); }
        else { setStatus('error'); setErrorMsg(err?.message || '阵眼感应失效'); }
      }
    };
    void start();

    return () => {
      active = false;
      cancelAnimationFrame(rafIdRef.current);
      try { recognizerRef.current?.close(); } catch { /* noop */ }
      recognizerRef.current = null;
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onUpdate]);

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const next = (camIdxRef.current + 1) % cameras.length;
    camIdxRef.current = next;
    setCamIdx(next);
    try {
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cameras[next].deviceId }, ...videoConstraints },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { /* 忽略 */ });
      }
    } catch (e) {
      console.warn('[HandTracker] 切换摄像头失败:', e);
    }
  };

  return (
    <div className="fixed bottom-12 right-12 z-50 pointer-events-none select-none">
      <div className={`w-[320px] aspect-[4/3] rounded-2xl overflow-hidden border-2 backdrop-blur-md transition-colors duration-500 relative ${
        status === 'active'  ? 'border-emerald-400/70 shadow-[0_0_30px_rgba(16,185,129,0.25)]' :
        status === 'loading' ? 'border-emerald-500/30' :
                               'border-red-500/50'
      } bg-black/85`}>
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className="w-full h-full object-cover scale-x-[-1] grayscale contrast-125 opacity-50"
        />
        {/* 谷歌 MediaPipe 21 点手骨绑定可视化（与镜像视频同向） */}
        <canvas ref={skelCanvasRef} width={640} height={480}
          className="absolute inset-0 w-full h-full pointer-events-none" />
        {status !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
            {status === 'loading' && (
              <>
                <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-300 rounded-full animate-spin" />
                <span className="text-emerald-300/80 text-xs tracking-[0.4em]">感应阵眼…</span>
              </>
            )}
            {(status === 'error' || status === 'no-cam' || status === 'no-permission') && (
              <>
                <span className="text-2xl">⚠️</span>
                <span className="text-red-300/90 text-[11px] text-center px-3 leading-relaxed">{errorMsg}</span>
                <span className="text-slate-400/60 text-[10px] text-center px-3">请检查浏览器权限后刷新</span>
              </>
            )}
          </div>
        )}
        {status === 'active' && (
          <>
            <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
            <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-emerald-500/20 border border-emerald-400/40 rounded text-[9px] text-emerald-300/90 tracking-widest font-bold">
              LIVE
            </div>
            {DEBUG_PANEL && (
              <div className="absolute top-8 left-2 px-1.5 py-1 bg-black/70 border border-emerald-400/30 rounded space-y-0.5 font-mono">
                <div className="text-[10px] text-amber-300/90">左 {dbg.l}</div>
                <div className="text-[10px] text-emerald-300/90">右 {dbg.r}</div>
              </div>
            )}
            {cameras.length > 1 && (
              <button
                onClick={switchCamera}
                title={cameras[camIdx]?.label || '切换摄像头'}
                className="absolute bottom-2 right-2 pointer-events-auto px-2 py-0.5 bg-black/60 border border-emerald-400/40 rounded text-[9px] text-emerald-300/90 tracking-widest font-bold hover:bg-emerald-500/20 transition-colors"
              >
                换摄像头 {camIdx + 1}/{cameras.length}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── 工具 ────────────────────────────────────────
function blankHand(role: HandRole): HandData {
  return { role, detected: false, x: 0.5, y: 0.5, distance: 0.5, fingerCount: 0, distCm: 0 };
}

function analyze(
  role: HandRole,
  idx: number,
  result: GestureRecognizerResult,
  state: HandState,
  nowMs: number,
): { hand: HandData; gesture: string; normSm: WLM[] | null } {
  if (idx < 0) return { hand: blankHand(role), gesture: 'None', normSm: null };
  const norm = result.landmarks[idx] as WLM[];
  if (!norm || norm.length < 21) return { hand: blankHand(role), gesture: 'None', normSm: null };
  const top = result.gestures?.[idx]?.[0]?.categoryName ?? 'None';
  const r = state.update(top, norm, nowMs);
  return {
    hand: {
      role, detected: true,
      x: r.x, y: r.y, distance: r.distance,
      fingerCount: r.fingerCount, distCm: r.distCm,
    },
    gesture: r.gesture,
    normSm: r.normSm,
  };
}

function pickFormation(gesture: string): FormationState {
  switch (gesture) {
    case 'Closed_Fist': return FormationState.THOUSAND_SILK;  // ✊ 千丝绞杀
    case 'Point_Up':    return FormationState.SWORD_BEAM;     // ☝ 青元剑芒
    case 'Victory':     return FormationState.SWORD_SHADOW;   // ✌ 剑影分光术
    case 'ILoveYou':    return FormationState.SWORD_SHIELD;   // 🤘 青元剑盾
    case 'Thumb_Up':
    case 'Thumb_Down':  return FormationState.TONGTIAN_ARRAY; // 👍 通天剑阵
    case 'Open_Palm':   return FormationState.DAGENG_ARRAY;   // 👋 大庚剑阵
    default:            return FormationState.IDLE;
  }
}

/** LIVE 骨骼绘制：21 点官方拓扑 + 手势名标签 */
function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hands: { norm: WLM[]; isRight: boolean; label: string }[],
) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  for (const hand of hands) {
    const col = hand.isRight ? '#34d399' : '#fbbf24';
    const px = (lm: WLM) => ({ x: (1 - lm.x) * w, y: lm.y * h });
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 6;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.9;
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = px(hand.norm[a]), p2 = px(hand.norm[b]);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    for (let i = 0; i < 21; i++) {
      const p = px(hand.norm[i]);
      ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.globalAlpha = 0.95; ctx.fill();
    }
    const wrist = px(hand.norm[0]);
    ctx.globalAlpha = 1; ctx.fillStyle = col;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(hand.label, wrist.x + 12, wrist.y + 8);
    ctx.restore();
  }
}

export default HandTracker;

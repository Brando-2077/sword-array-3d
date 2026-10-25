/**
 * HandTracker — MediaPipe Tasks Vision 手势识别
 * @version 4.2 追踪算法彻底重做
 * @description
 *   旧版三大痛点与本次对策：
 *   1. 手指判定不准（2D 距离比，手一倾斜/指尖朝镜头就崩）
 *      → 改用 worldLandmarks 3D 关节角度判定 + 滞回（伸直/弯曲双阈值防抖）
 *   2. 距离（离摄像头远近）不准（一次性 30 帧标定，标定时刻不对就全错）
 *      → 改为绝对测距：掌长在画面中的占比 × 摄像头 FOV 反推真实距离(cm)，
 *        无需标定、无漂移、可复现
 *   3. 数量跳变 → 稳定器：候选指型持续 150ms 才生效
 *
 *   另有：调试面板实时显示每只手的指型/距离（cm），方便现场调参；
 *   摄像头枚举自动跳过虚拟设备（DroidCam 等），支持手动切换。
 *
 *   左右手分工（与 v2.0 一致）：
 *     左手 → 飞剑数量（32/64/128/256/512）、剑光速度（5 档）、锁定
 *     右手 → 剑阵招式（七式）、剑体大小（5~30）、光标定位
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  HandLandmarker, FilesetResolver, HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  FormationState, HandData, HandRole, InteractionData,
  SWORD_COUNT_BY_FINGER, SPEED_LEVELS, SCALE_MIN, SCALE_MAX,
} from '../types';

export type HandTrackerStatus = 'loading' | 'active' | 'error' | 'no-cam' | 'no-permission';

export interface HandTrackerProps {
  onUpdate: (data: InteractionData) => void;
}

// ─── 调参区（现场实测不满意时只动这里） ─────────────
const ANGLE_EXTEND = 155;    // 关节角 > 此值判伸直（度）
const ANGLE_CURL   = 130;    // 关节角 < 此值判弯曲（度，与上行构成滞回带）
const THUMB_SEP    = 0.95;   // 拇指张开度：拇指尖到手掌缘距离 / 掌长
const PALM_CM      = 9.0;    // 手腕横纹→中指根典型掌长（成年人 ~8.5-10cm）
const VFOV_DEG     = 52;     // 典型网络摄像头垂直视场角
const NEAR_CM      = 35;     // 距离映射：近端（distance=1）
const FAR_CM       = 140;    // 距离映射：远端（distance=0）
const STABLE_MS    = 150;    // 指型候选需持续时长（ms）
const SMOOTH_POS   = 0.35;   // 掌心位置 EMA
const SMOOTH_DIST  = 0.20;   // 距离 EMA
const SCALE_SMOOTH = 0.30;   // 剑体大小平滑（派生层）
const SPEED_SMOOTH = 0.40;   // 剑速平滑（派生层）
const DEBUG_PANEL  = true;   // 摄像头面板上显示 指型/距离 实时读数

const FRAME_INTERVAL_MS = 42; // ~24fps 识别节流
const WASM_BASE = '/node_modules/@mediapipe/tasks-vision/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// 虚拟摄像头特征（DroidCam/OBS/ManyCam 等）：自动选摄像头时跳过，避免拿到未推流的占位画面
const VIRTUAL_CAM_RE = /droidcam|virtual|e2esoft|manycam|obs|snap camera/i;

// ─── 3D 点与关节角 ────────────────────────────────
type WLM = { x: number; y: number; z: number };

const dist3 = (a: WLM, b: WLM) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** b 为顶点，∠abc 的角度（度）；用 3D 世界坐标，旋转/俯仰不变 */
const angleAt = (a: WLM, b: WLM, c: WLM) => {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = a.z - b.z;
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = c.z - b.z;
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z);
  return Math.acos(Math.min(1, Math.max(-1, dot / (m || 1e-9)))) * 180 / Math.PI;
};

// 四指链（MCP, PIP, TIP）——判 PIP 关节角
const FINGER_CHAINS: [number, number, number][] = [
  [5, 6, 8],    // 食指
  [9, 10, 12],  // 中指
  [13, 14, 16], // 无名指
  [17, 18, 20], // 小指
];

// ─── 单手分析器：3D 角度指型 + 绝对测距 + 指型稳定器 ──
class HandAnalysis {
  private ext = [false, false, false, false, false]; // 拇..小（滞回态）
  private candCount = -1;
  private candSince = 0;
  private stableCount = 0;
  private sx = 0.5; private sy = 0.5;
  private sd = 0.5;
  private seen = false;

  /** 输入 world/norm landmarks，输出指型 + 平滑掌心 + 绝对距离(0~1, 近=1) */
  update(world: WLM[], norm: WLM[], nowMs: number): {
    fingerCount: number; x: number; y: number; distance: number; distCm: number;
  } {
    // ── 指型：3D 关节角 + 滞回 ──
    const palmSpan = dist3(world[0], world[9]) || 1e-6;
    for (let f = 0; f < 4; f++) {
      const [mcp, pip, tip] = FINGER_CHAINS[f];
      const ang = angleAt(world[mcp], world[pip], world[tip]);
      if (!this.ext[f + 1] && ang > ANGLE_EXTEND) this.ext[f + 1] = true;
      else if (this.ext[f + 1] && ang < ANGLE_CURL) this.ext[f + 1] = false;
    }
    // 拇指：IP/MCP 双角接近伸直 且 拇指尖远离手掌缘（握拳收拢时贴近）
    const thumbStraight =
      angleAt(world[2], world[3], world[4]) > ANGLE_EXTEND - 8 &&
      angleAt(world[1], world[2], world[3]) > ANGLE_CURL;
    const thumbSep = (dist3(world[4], world[17]) + dist3(world[4], world[5])) / (2 * palmSpan);
    if (!this.ext[0] && thumbStraight && thumbSep > THUMB_SEP + 0.15) this.ext[0] = true;
    else if (this.ext[0] && (!thumbStraight || thumbSep < THUMB_SEP - 0.15)) this.ext[0] = false;

    const rawCount = this.ext.reduce((n, e) => n + (e ? 1 : 0), 0);

    // ── 指型稳定器：候选持续 STABLE_MS 才提交 ──
    if (rawCount !== this.candCount) { this.candCount = rawCount; this.candSince = nowMs; }
    if (nowMs - this.candSince >= STABLE_MS || this.stableCount === 0 && this.candSince === nowMs) {
      this.stableCount = rawCount;
    }

    // ── 掌心：中指根(9)，EMA 平滑 ──
    const k = this.seen ? SMOOTH_POS : 1.0;
    this.sx += (norm[9].x - this.sx) * k;
    this.sy += (norm[9].y - this.sy) * k;

    // ── 绝对测距：掌长画面占比 → 真实距离(cm) → 0~1 ──
    // norm 坐标 x/y 均归一化，需按 4:3 画幅把 x 拉正后再算几何长度（单位：画面高度）
    const ax = 4 / 3;
    const spanPx = (
      Math.hypot((norm[0].x - norm[5].x) * ax, norm[0].y - norm[5].y) +
      Math.hypot((norm[0].x - norm[9].x) * ax, norm[0].y - norm[9].y) +
      Math.hypot((norm[0].x - norm[17].x) * ax, norm[0].y - norm[17].y)
    ) / 3;
    const vfovRad = (VFOV_DEG * Math.PI) / 180;
    const distCm = PALM_CM / (2 * Math.max(spanPx, 1e-4) * Math.tan(vfovRad / 2));
    const d01 = Math.max(0, Math.min(1, (FAR_CM - distCm) / (FAR_CM - NEAR_CM)));
    this.sd += (d01 - this.sd) * (this.seen ? SMOOTH_DIST : 1.0);

    this.seen = true;
    return { fingerCount: this.stableCount, x: this.sx, y: this.sy, distance: this.sd, distCm };
  }
}

// ─── 主组件 ──────────────────────────────────────
const HandTracker: React.FC<HandTrackerProps> = ({ onUpdate }) => {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
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

  // 调试面板读数（5Hz 刷新，避免重渲染压力）
  const [dbg, setDbg] = useState<{ l: string; r: string }>({ l: '', r: '' });
  const dbgRef = useRef({ l: '', r: '', t: 0 });

  // 稳定派生状态（剑体大小 / 数量 / 速度 / 锁定）
  const stableRef = useRef({ scale: 15, count: 64, speed: 0.75, locked: false });
  const smoothScale = useRef({ v: 15 });
  const smoothSpeed = useRef({ v: 0.75 });
  const analyses = useRef({ L: new HandAnalysis(), R: new HandAnalysis() });

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
        const result = landmarkerRef.current?.detectForVideo(video, now);
        if (result) onResults(result, now);
      } catch (e) {
        console.warn('[HandTracker] detect 失败:', e);
      } finally {
        busyRef.current = false;
      }
    };

    const onResults = (result: HandLandmarkerResult, now: number) => {
      const noHand = !result.landmarks || result.landmarks.length === 0;
      if (noHand) {
        setDbgThrottled({ l: '—', r: '—' });
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

      // ── 分类左右手（handedness.label；镜像画面下 'Left'=用户右手） ──
      let leftIdx = -1, rightIdx = -1;
      for (let i = 0; i < result.landmarks.length; i++) {
        const label = result.handednesses?.[i]?.[0]?.displayName || result.handednesses?.[i]?.[0]?.categoryName;
        if (label === 'Right' && rightIdx < 0) rightIdx = i;   // 用户右手
        else if (label !== 'Right' && leftIdx < 0) leftIdx = i;
      }

      const left  = buildHand(HandRole.LEFT,  leftIdx,  result, analyses.current.L, now);
      const right = buildHand(HandRole.RIGHT, rightIdx, result, analyses.current.R, now);

      if (DEBUG_PANEL) {
        setDbgThrottled({
          l: left.detected  ? `${left.fingerCount}指 ${(left.distCm ?? 0) | 0}cm` : '—',
          r: right.detected ? `${right.fingerCount}指 ${(right.distCm ?? 0) | 0}cm` : '—',
        });
      }

      // ── 派生参数 ──
      const locked = left.detected && left.fingerCount === 0;
      stableRef.current.locked = locked;

      // 剑体大小：右手距离（近=大）
      if (!locked && right.detected) {
        const target = SCALE_MIN + right.distance * (SCALE_MAX - SCALE_MIN);
        smoothScale.current.v = smoothScale.current.v * (1 - SCALE_SMOOTH) + target * SCALE_SMOOTH;
      }
      stableRef.current.scale = smoothScale.current.v;

      // 飞剑数量：左手指数查表（0 指保持当前）
      if (!locked && left.detected && left.fingerCount > 0 && SWORD_COUNT_BY_FINGER[left.fingerCount] !== undefined) {
        stableRef.current.count = SWORD_COUNT_BY_FINGER[left.fingerCount];
      }

      // 剑光速度：左手距离 5 档
      if (!locked && left.detected) {
        const level = Math.max(0, Math.min(4, Math.round(left.distance * 4)));
        const target = SPEED_LEVELS[level].value;
        smoothSpeed.current.v = smoothSpeed.current.v * (1 - SPEED_SMOOTH) + target * SPEED_SMOOTH;
      }
      stableRef.current.speed = smoothSpeed.current.v;

      const formation = pickFormation(right);
      const cursorX = right.detected ? 1 - right.x : 0.5; // 画面已镜像显示，光标同向镜像
      const cursorY = right.detected ? right.y : 0.5;

      onUpdate({
        left, right,
        cursorX, cursorY, cursorActive: right.detected,
        formation,
        swordScale: stableRef.current.scale,
        swordCount: stableRef.current.count,
        animSpeed:  stableRef.current.speed,
        locked,
      });
    };

    const setDbgThrottled = (v: { l: string; r: string }) => {
      const now = performance.now();
      if (now - dbgRef.current.t > 200) {
        dbgRef.current.t = now;
        setDbg(v);
      } else {
        dbgRef.current.l = v.l; dbgRef.current.r = v.r;
      }
    };

    // ── 启动 ──
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持 getUserMedia');
        // 1) 空约束触发权限（未授权时设备 label 为空），拿授权后立即停探针
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t: MediaStreamTrack) => t.stop());

        // 2) 枚举并优先实体摄像头（跳过 DroidCam 等虚拟设备）
        const allCams = (await navigator.mediaDevices.enumerateDevices())
          .filter((d: MediaDeviceInfo) => d.kind === 'videoinput');
        if (allCams.length === 0) throw Object.assign(new Error('未检测到摄像头设备'), { name: 'NotFoundError' });
        const preferred = allCams.find((d: MediaDeviceInfo) => !VIRTUAL_CAM_RE.test(d.label)) ?? allCams[0];
        setCameras(allCams);
        camIdxRef.current = Math.max(0, allCams.indexOf(preferred));
        setCamIdx(camIdxRef.current);

        // 3) 正式开流
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

        // 4) 识别器
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.4,  // 放宽检测：侧手/部分遮挡也尽量跟上
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        landmarkerRef.current = landmarker;
        if (!active) { landmarker.close(); return; }

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
      try { landmarkerRef.current?.close(); } catch { /* noop */ }
      landmarkerRef.current = null;
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onUpdate]);

  // 手动切换摄像头
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

function buildHand(
  role: HandRole,
  idx: number,
  result: HandLandmarkerResult,
  analysis: HandAnalysis,
  nowMs: number,
): HandData {
  if (idx < 0) return blankHand(role);
  const world = result.worldLandmarks?.[idx] as WLM[] | undefined;
  const norm  = result.landmarks[idx] as WLM[];
  if (!world || world.length < 21) return blankHand(role);
  const r = analysis.update(world, norm, nowMs);
  return {
    role,
    detected: true,
    x: r.x, y: r.y,
    distance: r.distance,
    fingerCount: r.fingerCount,
    distCm: r.distCm,
  };
}

function pickFormation(right: HandData): FormationState {
  if (!right.detected) return FormationState.IDLE;
  const c = right.fingerCount;
  if (c === 0) return FormationState.THOUSAND_SILK; // 握拳 → 千丝绞杀
  if (c === 1) return FormationState.SWORD_BEAM;    // 1 指 → 青元剑芒
  if (c === 2) return FormationState.SWORD_SHADOW;  // 2 指 → 剑影分光术
  if (c === 3) return FormationState.SWORD_SHIELD;  // 3 指 → 青元剑盾
  if (c === 4) return FormationState.TONGTIAN_ARRAY; // 4 指 → 通天剑阵
  return FormationState.DAGENG_ARRAY;               // 5 指 → 大庚剑阵
}

export default HandTracker;

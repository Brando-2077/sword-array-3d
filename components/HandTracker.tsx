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

// 谷歌预训练手势兜底映射（自研角度法无数据时）
const GESTURE_TO_FINGERS: Record<string, number> = {
  Closed_Fist: 0,
  Point_Up: 1,
  Victory: 2,
  ILoveYou: 3,
  Thumb_Up: 4,
  Thumb_Down: 4,
  Open_Palm: 5,
  None: -1,
};
const fingerCountOf = (g: string) => GESTURE_TO_FINGERS[g] ?? -1;

// ─── 测距参数（几何法，与手势无关） ────────────────
const PALM_CM = 9.0;    // 手腕横纹→中指根典型掌长
const VFOV_DEG = 52;    // 典型网络摄像头垂直视场角
// 注：绝对量程(NEAR/FAR_CM)已废弃——改自动量程校准（HandState 内），
// 手在自然可达范围内的远近被拉伸为满档 0~1，任何值都够得着，无盲区。
const SMOOTH_POS = 0.35, SMOOTH_DIST = 0.20;
const SCALE_SMOOTH = 0.30, SPEED_SMOOTH = 0.40;
const GESTURE_STABLE_FRAMES = 5;   // ~200ms @24fps
const FRAME_INTERVAL_MS = 42;
const DEBUG_PANEL = true;

const VIRTUAL_CAM_RE = /droidcam|virtual|e2esoft|manycam|obs|snap camera/i;

// MediaPipe 官方约定：标签按镜像输入判定，我们送原始帧。
// 本机实测（2026-10-26 用户确认为准）：不对调，label 'Right' 即用户右手。
// ⚠️ 用户明确要求：不要再提供左右互换功能，此方向已锁定。
const SWAP_HANDEDNESS = false;

// 量程锚点（标定会话写入 localStorage 'dageng-range' {min,max}，单位 cm）
const RANGE_ANCHOR: { min: number; max: number } | null = (() => {
  try {
    const r = JSON.parse(localStorage.getItem('dageng-range') || 'null');
    if (r && typeof r.min === 'number' && typeof r.max === 'number' && r.max > r.min) return r;
  } catch { /* noop */ }
  return null;
})();

// ─── 21 点手骨拓扑（官方 HAND_CONNECTIONS） ─────────
const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],
  [13,14],[14,15],[15,16],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],[0,17],
];

type WLM = { x: number; y: number; z: number };

const dist3 = (a: WLM, b: WLM) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleAt = (a: WLM, b: WLM, c: WLM) => {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = a.z - b.z;
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = c.z - b.z;
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z);
  return Math.acos(Math.min(1, Math.max(-1, dot / (m || 1e-9)))) * 180 / Math.PI;
};

// ─── 手指伸直度（核心特征）：tip→MCP 距离 ÷ 骨链总长 ──
// 伸直 ≈ 0.95+，全弯 ≈ 0.25~0.5；旋转/朝向/倾斜全无关（3D 世界坐标）。
// 关节角法已被真实数据否定（手朝镜头倾时投影角掉到 120°，收拢拇指反达 150°+）
const FINGER_IDS: number[][] = [
  [5, 6, 7, 8],    // 食指（MCP..TIP）
  [9, 10, 11, 12], // 中指
  [13, 14, 15, 16],// 无名指
  [17, 18, 19, 20],// 小指
];
function fingerMetrics(world: WLM[]): { ratios: number[]; thumbRatio: number; thumbSep: number; thumbAng: number; angles: number[] } {
  const ratios = FINGER_IDS.map((ids) => {
    let len = 0;
    for (let k = 0; k < 3; k++) len += dist3(world[ids[k]], world[ids[k + 1]]);
    return dist3(world[ids[3]], world[ids[0]]) / (len + 1e-6);
  });
  // 拇指链 1-2-3-4
  const tl = dist3(world[1], world[2]) + dist3(world[2], world[3]) + dist3(world[3], world[4]);
  const thumbRatio = dist3(world[4], world[2]) / (tl + 1e-6);
  // 拇指分离度：拇指尖 ↔ 食指根，按掌长（腕→中指根）归一
  const palmSpan = dist3(world[0], world[9]) + 1e-6;
  const thumbSep = dist3(world[4], world[5]) / palmSpan;
  // 拇指指向角：MCP→TIP 在图像平面内偏离"正上"的角度（0°=正上，180°=正下）。
  // 张开手掌拇指朝上/斜上（小角度），收拢在拳边朝下（大角度）——比分离度稳
  const tdx = world[4].x - world[2].x, tdy = world[4].y - world[2].y;
  const tlen = Math.hypot(tdx, tdy) + 1e-6;
  const thumbAng = Math.acos(Math.min(1, Math.max(-1, -tdy / tlen))) * 180 / Math.PI;
  // 角度保留仅供日志对照
  const chains: [number, number, number][] = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  const angles = chains.map(([mcp, pip, tip]) => angleAt(world[mcp], world[pip], world[tip]));
  return { ratios, thumbRatio, thumbSep, thumbAng, angles };
}

// 阈值（每指独立，标定自用户 2026-10-26 真实手部数据日志；滞回：ext_on / ext_off）
const RATIO_EXT = [0, 0.67, 0.63, 0.76, 0.73];   // 四指伸直阈值（食/中/无/小）
const RATIO_CURL = [0, 0.52, 0.48, 0.61, 0.58];  // 四指弯曲阈值
// 拇指：分离度实测重叠（收拢 0.44~0.68 vs 张开 0.44~0.69）已弃用；
// 改用指向角（MCP→TIP 偏离正上的角度，0=正上/180=正下）：
// 张开手掌拇指朝上（小角度），收拢在拳边朝下（大角度）。阈值待实测分布后校准
const THUMB_ANG_ON = 80, THUMB_ANG_OFF = 105;

// ─── 单手状态机：五指滞回 + 手指数时序投票 + 掌心/测距平滑 ──
class HandState {
  private ext = [false, false, false, false, false]; // 拇..小（滞回态）
  private candCount = -1;
  private candFrames = 0;
  private stableCount = -1;
  private sx = 0.5; private sy = 0.5;
  private sd = 0.5;
  private seen = false;
  private normSm: WLM[] = [];
  // 自动量程校准：记住本只手实际可达的最近/最远距离，拉伸为满档 0~1（无盲区）
  private minCm = 0; private maxCm = 0; private cal = false;

  /** 输入五指伸直度+拇指分离度+landmarks，输出稳定手指数/掌心/距离(cm) */
  update(m: { ratios: number[]; thumbRatio: number; thumbSep: number; thumbAng: number; angles: number[] }, norm: WLM[], nowMs: number): {
    count: number; x: number; y: number; distance: number; distCm: number; normSm: WLM[];
  } {
    // 五指滞回判定：四指各用独立阈值；拇指用指向角、且只在四指全伸时计 1
    for (let f = 0; f < 4; f++) {
      const r = m.ratios[f];
      if (!this.ext[f + 1] && r > RATIO_EXT[f + 1]) this.ext[f + 1] = true;
      else if (this.ext[f + 1] && r < RATIO_CURL[f + 1]) this.ext[f + 1] = false;
    }
    const fourCount = this.ext.reduce((n, e, i) => n + (i > 0 && e ? 1 : 0), 0);
    if (!this.ext[0] && fourCount === 4 && m.thumbAng < THUMB_ANG_ON) this.ext[0] = true;
    else if (this.ext[0] && m.thumbAng > THUMB_ANG_OFF) this.ext[0] = false;
    const rawCount = this.ext.reduce((n, e) => n + (e ? 1 : 0), 0);

    // 手指数时序投票
    if (rawCount === this.candCount) this.candFrames++;
    else { this.candCount = rawCount; this.candFrames = 1; }
    if (this.candFrames >= GESTURE_STABLE_FRAMES || this.stableCount === -1) {
      this.stableCount = rawCount;
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
    // 量程：优先用标定锚点（localStorage 'dageng-range'，由标定会话写入，
    // 锚定"手部可达空间 ↔ 数值区间"的绑定）；无锚点时退回自适应跟踪（兜底）
    let lo: number, hi: number;
    const anchor = RANGE_ANCHOR;
    if (anchor) {
      const m = (anchor.max - anchor.min) * 0.15;
      lo = anchor.min - m; hi = anchor.max + m;
    } else {
      if (!this.cal) { this.minCm = distCm; this.maxCm = distCm; this.cal = true; }
      else {
        if (distCm < this.minCm) this.minCm = distCm;
        else this.minCm += (distCm - this.minCm) * 0.004;
        if (distCm > this.maxCm) this.maxCm = distCm;
        else this.maxCm += (distCm - this.maxCm) * 0.004;
      }
      const range = Math.max(15, this.maxCm - this.minCm);
      lo = this.minCm - range * 0.08; hi = this.maxCm + range * 0.08;
    }
    const d01 = Math.max(0, Math.min(1, (hi - distCm) / (hi - lo)));
    this.sd += (d01 - this.sd) * (this.seen ? SMOOTH_DIST : 1.0);

    this.seen = true;
    return {
      count: this.stableCount,
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
  const stableRef = useRef({ scale: 15, scaleTier: 4, count: 72, speed: 1.0, speedTier: 2, locked: false });
  const smoothScale = useRef({ v: 15 });
  const smoothSpeed = useRef({ v: 1.0 });
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
          scaleTier:  stableRef.current.scaleTier,
          swordCount: stableRef.current.count,
          animSpeed:  stableRef.current.speed,
          speedTier:  stableRef.current.speedTier,
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

      // LIVE 骨骼可视化（纯骨架，标签移到面板顶部两角）
      const sctx = skelCanvasRef.current?.getContext('2d');
      if (sctx) {
        const hands: { norm: WLM[]; isRight: boolean }[] = [];
        if (L.normSm) hands.push({ norm: L.normSm, isRight: false });
        if (R.normSm) hands.push({ norm: R.normSm, isRight: true });
        drawHandSkeleton(sctx, hands);
      }
      if (DEBUG_PANEL) {
        setDbg5({
          l: left.detected  ? `${left.fingerCount >= 0 ? left.fingerCount + '指' : '…'} ${left.distCm ? (left.distCm|0) : '?'}cm` : '—',
          r: right.detected ? `${right.fingerCount >= 0 ? right.fingerCount + '指' : '…'} ${right.distCm ? (right.distCm|0) : '?'}cm` : '—',
        });
      }

      // ── 派生参数（单手接管模式） ──────────────────
      // 只伸出一只手时，这只手控制全部（手指数=剑数+阵式，距离=大小+速度）；
      // 两只手都在时才分左右职能。锁定仅双手模式下左手 0 指（握拳）触发
      //（单手模式 0 指 = 千丝绞杀，不锁参数）。
      const onlyLeft = left.detected && !right.detected;
      const onlyRight = right.detected && !left.detected;

      // 右职能（阵式/大小/光标）来源：右手；仅左手时由左手接管
      const fHand = right.detected ? right : (onlyLeft ? left : right);
      const fCount = right.detected ? R.count : (onlyLeft ? L.count : -1);
      // 左职能（剑数/速度）来源：左手；仅右手时由右手接管
      const cHand = left.detected ? left : (onlyRight ? right : left);

      const locked = left.detected && right.detected && L.count === 0;
      stableRef.current.locked = locked;

      if (!locked && fHand.detected) {
        // 剑体 10 档量化（档位直出，UI 与档严格对应；平滑值仅供 3D 渐变）
        const tier = Math.max(0, Math.min(9, Math.round(fHand.distance * 9)));
        const target = SCALE_MIN + (tier * (SCALE_MAX - SCALE_MIN)) / 9;
        stableRef.current.scaleTier = tier;
        smoothScale.current.v = smoothScale.current.v * (1 - SCALE_SMOOTH) + target * SCALE_SMOOTH;
      }
      stableRef.current.scale = smoothScale.current.v;

      if (!locked && cHand.detected && cHand.fingerCount > 0 && SWORD_COUNT_BY_FINGER[cHand.fingerCount] !== undefined) {
        stableRef.current.count = SWORD_COUNT_BY_FINGER[cHand.fingerCount];
      }

      if (!locked && cHand.detected) {
        const level = Math.max(0, Math.min(SPEED_LEVELS.length - 1, Math.round(cHand.distance * (SPEED_LEVELS.length - 1))));
        const target = SPEED_LEVELS[level].value;
        stableRef.current.speedTier = level;           // 目标档位直出（UI 显示用）
        smoothSpeed.current.v = smoothSpeed.current.v * (1 - SPEED_SMOOTH) + target * SPEED_SMOOTH;
      }
      stableRef.current.speed = smoothSpeed.current.v;

      // 阵式：未识别(-1)保持上一阵，避免闪跳
      if (fHand.detected && fCount >= 0) lastRGesture.current = String(fCount);
      const formation = fHand.detected && fCount >= 0
        ? pickFormation(fCount)
        : (fHand.detected ? pickFormation(Number(lastRGesture.current)) : FormationState.IDLE);

      onUpdate({
        left, right,
        cursorX: fHand.detected ? 1 - fHand.x : 0.5,
        cursorY: fHand.detected ? fHand.y : 0.5,
        cursorActive: fHand.detected,
        formation,
        swordScale: stableRef.current.scale,
        scaleTier:  stableRef.current.scaleTier,
        swordCount: stableRef.current.count,
        animSpeed:  stableRef.current.speed,
        speedTier:  stableRef.current.speedTier,
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
            {/* 顶部标签栏：左手在左（琥珀），右手在右（翠绿），中间 LIVE */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-1 px-2 py-1 bg-gradient-to-b from-black/85 to-transparent">
              <span className="text-[10px] text-amber-300 font-mono font-bold whitespace-nowrap">左 {dbg.l}</span>
              <span className="text-[9px] text-emerald-300 tracking-[0.25em] font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]" />
                LIVE
              </span>
              <span className="text-[10px] text-emerald-300 font-mono font-bold whitespace-nowrap">{dbg.r} 右</span>
            </div>
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
): { hand: HandData; count: number; normSm: WLM[] | null } {
  if (idx < 0) return { hand: blankHand(role), count: -1, normSm: null };
  const norm = result.landmarks[idx] as WLM[];
  const world = result.worldLandmarks?.[idx] as WLM[] | undefined;
  if (!norm || norm.length < 21 || !world || world.length < 21)
    return { hand: blankHand(role), count: -1, normSm: null };

  // 手指数判定：伸直度比值法（tip→MCP 距离/骨链总长，旋转朝向全无关）+ 拇指分离度
  const metrics = fingerMetrics(world);
  const r = state.update(metrics, norm, nowMs);

  // 实时数据记录器：控制台 window.__FINGERLOG 可查每帧五指伸直度/拇指分离度/判定
  try {
    const w = window as any;
    if (!w.__FINGERLOG) w.__FINGERLOG = [];
    w.__FINGERLOG.push({
      t: Date.now(), side: role === HandRole.RIGHT ? 'R' : 'L',
      raw: r.count, cm: Math.round(r.distCm),
      ratios: metrics.ratios.map((v) => +v.toFixed(2)),
      thumbRatio: +metrics.thumbRatio.toFixed(2),
      thumbSep: +metrics.thumbSep.toFixed(2),
      thumbAng: Math.round(metrics.thumbAng),
      google: result.gestures?.[idx]?.[0]?.categoryName ?? 'None',
    });
    if (w.__FINGERLOG.length > 3000) w.__FINGERLOG.splice(0, w.__FINGERLOG.length - 3000);
  } catch { /* noop */ }

  return {
    hand: {
      role, detected: true,
      x: r.x, y: r.y, distance: r.distance,
      fingerCount: r.count, distCm: r.distCm,
    },
    count: r.count,
    normSm: r.normSm,
  };
}

function pickFormation(count: number): FormationState {
  switch (count) {
    case 0: return FormationState.THOUSAND_SILK;  // ✊ 千丝绞杀
    case 1: return FormationState.SWORD_BEAM;     // 1 指 青元剑芒
    case 2: return FormationState.SWORD_SHADOW;   // 2 指 剑影分光术
    case 3: return FormationState.SWORD_SHIELD;   // 3 指 青元剑盾
    case 4: return FormationState.TONGTIAN_ARRAY; // 4 指 通天剑阵
    case 5: return FormationState.DAGENG_ARRAY;   // 5 指 大庚剑阵
    default: return FormationState.IDLE;
  }
}

/** LIVE 骨骼绘制：21 点官方拓扑（标签显示在面板顶部两角，不在骨架上） */
function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hands: { norm: WLM[]; isRight: boolean }[],
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
    ctx.restore();
  }
}

export default HandTracker;

/**
 * HandTrackerTF — 手势捕捉（TF.js WebGL 运行时版）
 * @description
 *   为小红书小工具容器定制：容器禁用 WASM / Worker / fetch( 网络请求 / module 导入，
 *   MediaPipe tasks-vision 全依赖链不可用。改用 @tensorflow-models/hand-pose-detection
 *   的 TF.js 运行时（纯 WebGL 推理，零 WASM），模型从包内 .js 数据模块加载
 *   （window.__WEIGHTS_* 注入，自定义 IOHandler 供权重，全程零 fetch）。
 *   输出 21 关键点 + 3D 世界坐标 → 复用 hand-analysis 共享判定（v7 伸直度比值法）。
 *
 *   容器约束适配：
 *   - 无 enumerateDevices → 使用默认摄像头
 *   - 无 Worker → 推理在主线程（WebGL backend 上传 GPU，主线程仅调度）
 *   - DPR 上限 1.5、visibilitychange 暂停、context lost 兜底 → 渲染层已适配
 */
import React, { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-converter';
import { SupportedModels, createDetector, HandDetector as TFHandDetector } from '@tensorflow-models/hand-pose-detection';
import {
  FormationState, HandData, HandRole, InteractionData,
  SWORD_COUNT_BY_FINGER, SPEED_LEVELS, SCALE_MIN, SCALE_MAX,
} from '../types';
import { dist3, fingerMetrics, HandState, HAND_CONNECTIONS, type WLM } from './hand-analysis';

export type HandTrackerStatus = 'loading' | 'active' | 'error' | 'no-cam' | 'no-permission';

export interface HandTrackerProps {
  onUpdate: (data: InteractionData) => void;
}

const FRAME_INTERVAL_MS = 42;
const DEBUG_PANEL = true;
const SCALE_SMOOTH = 0.30, SPEED_SMOOTH = 0.40;
const MODEL_DETECTOR = '/models/handdetector/model.json';
const MODEL_LANDMARK = '/models/handlandmark/model.json';

// ─── 权重加载器：从包内 .js 数据模块读取（model.js 注入 __MODEL_*_TOPOLOGY/__SHARDS） ──
// 零 fetch、零网络、零 WASM——完全符合容器 CSP
function makeMemoryIOHandler(isDetector: boolean): tf.io.IOHandler {
  return {
    async load() {
      const w = window as any;
      const topology = isDetector ? w.__MODEL_DETECTOR_TOPOLOGY : w.__MODEL_LANDMARK_TOPOLOGY;
      const shards = isDetector ? w.__MODEL_DETECTOR_SHARDS : w.__MODEL_LANDMARK_SHARDS;
      if (!topology || !shards) throw new Error(`模型数据缺失: ${isDetector ? 'DETECTOR' : 'LANDMARK'}`);
      const weightSpecs: tf.io.WeightsManifestEntry[] = [];
      const buffers: ArrayBuffer[] = [];
      for (const group of topology.weightsManifest ?? []) {
        for (const spec of group.weights) weightSpecs.push(spec);
        for (const path of group.paths) {
          const b64 = shards[path];
          if (!b64) throw new Error(`权重分片缺失: ${path}`);
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          buffers.push(buf.buffer);
        }
      }
      const total = buffers.reduce((n, b) => n + b.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of buffers) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
      return { modelTopology: topology.modelTopology, weightSpecs, weightData: merged.buffer };
    },
  };
}

// ─── 主组件 ──────────────────────────────────────
const HandTrackerTF: React.FC<HandTrackerProps> = ({ onUpdate }) => {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const skelCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef   = useRef<TFHandDetector | null>(null);
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

  const [dbg, setDbg] = useState<{ l: string; r: string }>({ l: '', r: '' });
  const dbgRef = useRef({ t: 0 });

  const stableRef = useRef({ scale: 14, scaleTier: 3, count: 72, speed: 1.0, speedTier: 2, locked: false });
  const smoothScale = useRef({ v: 14 });
  const smoothSpeed = useRef({ v: 1.0 });
  const states = useRef({
    L: new HandState(), R: new HandState(),
  });
  // 量程锚点
  const rangeAnchorRef = useRef<{ min: number; max: number } | null>((() => {
    try {
      const r = JSON.parse(localStorage.getItem('dageng-range') || 'null');
      return r && typeof r.min === 'number' && typeof r.max === 'number' && r.max > r.min ? r : null;
    } catch { return null; }
  })());
  states.current.L.anchor = rangeAnchorRef.current;
  states.current.R.anchor = rangeAnchorRef.current;

  const lastFCount = useRef<number>(-1);
  const SCALE_SMOOTH = 0.30, SPEED_SMOOTH = 0.40;

  useEffect(() => {
    let active = true;
    // 可见性暂停（性能预算要求）
    let visible = true;
    const onVis = () => { visible = document.hidden === false; };
    document.addEventListener('visibilitychange', onVis);

    const tick = async (now: number) => {
      if (!active) return;
      rafIdRef.current = requestAnimationFrame(tick);
      if (!visible || !videoRef.current || !detectorRef.current) return;
      const video = videoRef.current;
      if (video.paused || video.readyState < 2) return;
      if (busyRef.current) return;
      if (now - lastFrameRef.current < FRAME_INTERVAL_MS) return;
      lastFrameRef.current = now;
      busyRef.current = true;
      try {
        const hands = await detectorRef.current.estimateHands(video) as Array<{ keypoints: Array<{x:number;y:number;z:number}>; keypoints3D: Array<{x:number;y:number;z:number}>; handedness: string; score?: number }>; // 不翻转（容器内视频不做镜像）
        if (hands && hands.length >= 0) onResults(hands, now);
      } catch (e) {
        console.warn('[HandTrackerTF] estimateHands 失败:', e);
      } finally {
        busyRef.current = false;
      }
    };

    const onResults = (hands: Array<{ keypoints: Array<{x:number;y:number;z:number}>; keypoints3D: Array<{x:number;y:number;z:number}>; handedness: string; score?: number }>, now: number) => {
      const noHand = !hands || hands.length === 0;
      if (noHand) {
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
          speedTier:  stableRef.current.speedTier,
          scaleTier:  stableRef.current.scaleTier,
          locked:     stableRef.current.locked,
        });
        return;
      }

      // 分类左右手（容器内视频不镜像 → MediaPipe 约定标签直接对应）
      let leftIdx = -1, rightIdx = -1;
      for (let i = 0; i < hands.length; i++) {
        const label = hands[i].handedness;
        const isUserRight = label === 'Right';
        if (isUserRight && rightIdx < 0) rightIdx = i;
        else if (!isUserRight && leftIdx < 0) leftIdx = i;
      }

      const L = analyzeHand(HandRole.LEFT,  leftIdx,  hands, states.current.L, now);
      const R = analyzeHand(HandRole.RIGHT, rightIdx, hands, states.current.R, now);
      const left = L.hand, right = R.hand;

      // LIVE 骨骼可视化
      const sctx = skelCanvasRef.current?.getContext('2d');
      if (sctx) {
        const skelHands: { norm: WLM[]; isRight: boolean }[] = [];
        if (L.normSm) skelHands.push({ norm: L.normSm, isRight: false });
        if (R.normSm) skelHands.push({ norm: R.normSm, isRight: true });
        drawHandSkeleton(sctx, skelHands);
      }
      if (DEBUG_PANEL) {
        setDbg5({
          l: left.detected  ? `${left.fingerCount >= 0 ? left.fingerCount + '指' : '…'} ${left.distCm ? (left.distCm|0) : '?'}cm` : '—',
          r: right.detected ? `${right.fingerCount >= 0 ? right.fingerCount + '指' : '…'} ${right.distCm ? (right.distCm|0) : '?'}cm` : '—',
        });
      }

      // ── 派生参数（单手接管模式，与 MediaPipe 版一致） ──
      const onlyLeft = left.detected && !right.detected;
      const onlyRight = right.detected && !left.detected;
      const fHand = right.detected ? right : (onlyLeft ? left : right);
      const fCount = right.detected ? R.count : (onlyLeft ? L.count : -1);
      const cHand = left.detected ? left : (onlyRight ? right : left);

      const locked = left.detected && right.detected && L.count === 0;
      stableRef.current.locked = locked;

      if (!locked && fHand.detected) {
        const target = SCALE_MIN + fHand.distance * (SCALE_MAX - SCALE_MIN);
        smoothScale.current.v = smoothScale.current.v * (1 - SCALE_SMOOTH) + target * SCALE_SMOOTH;
      }
      stableRef.current.scale = smoothScale.current.v;

      if (!locked && cHand.detected && cHand.fingerCount > 0 && SWORD_COUNT_BY_FINGER[cHand.fingerCount] !== undefined) {
        stableRef.current.count = SWORD_COUNT_BY_FINGER[cHand.fingerCount];
      }

      if (!locked && cHand.detected) {
        const level = Math.max(0, Math.min(SPEED_LEVELS.length - 1, Math.round(cHand.distance * (SPEED_LEVELS.length - 1))));
        const target = SPEED_LEVELS[level].value;
        smoothSpeed.current.v = smoothSpeed.current.v * (1 - SPEED_SMOOTH) + target * SPEED_SMOOTH;
      }
      stableRef.current.speed = smoothSpeed.current.v;

      if (fHand.detected && fCount >= 0) lastFCount.current = fCount;
      const formation = fHand.detected && fCount >= 0
        ? pickFormation(fCount)
        : (fHand.detected ? pickFormation(lastFCount.current) : FormationState.IDLE);

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
        // 摄像头（容器允许，默认设备）
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { ...videoConstraints }, audio: false,
        });
        streamRef.current = stream;
        if (!videoRef.current) throw new Error('视频元素未就绪');
        const video = videoRef.current;
        video.srcObject = stream;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => video.play().then(() => resolve()).catch(reject);
          setTimeout(() => reject(new Error('摄像头启动超时')), 8000);
        });

        // WebGL 后端初始化
        await tf.setBackend('webgl');
        await tf.ready();

        // 模型加载（自定义 IOHandler 从包内 .js 数据模块读取）
        const detector = await createDetector(SupportedModels.MediaPipeHands, {
          runtime: 'tfjs',
          detectorModelUrl: makeMemoryIOHandler(true) as any,
          landmarkModelUrl: makeMemoryIOHandler(false) as any,
          maxHands: 2,
        });
        detectorRef.current = detector;
        if (!active) { detector.dispose(); return; }

        setStatus('active');
        lastFrameRef.current = 0;
        requestAnimationFrame(tick);
      } catch (err: any) {
        console.error('[HandTrackerTF] 启动失败:', err);
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
      document.removeEventListener('visibilitychange', onVis);
      try { detectorRef.current?.dispose(); } catch { /* noop */ }
      detectorRef.current = null;
      streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onUpdate]);

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
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-1 px-2 py-1 bg-gradient-to-b from-black/85 to-transparent">
              <span className="text-[10px] text-amber-300 font-mono font-bold whitespace-nowrap">左 {dbg.l}</span>
              <span className="text-[9px] text-emerald-300 tracking-[0.25em] font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]" />
                LIVE
              </span>
              <span className="text-[10px] text-emerald-300 font-mono font-bold whitespace-nowrap">{dbg.r} 右</span>
            </div>
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

function analyzeHand(
  role: HandRole,
  idx: number,
  hands: Array<{ keypoints: WLM[]; keypoints3D: WLM[]; handedness: string }>,
  state: HandState,
  nowMs: number,
): { hand: HandData; count: number; normSm: WLM[] | null } {
  if (idx < 0) return { hand: blankHand(role), count: -1, normSm: null };
  const hand = hands[idx];
  const norm = hand.keypoints as unknown as WLM[];
  const world = hand.keypoints3D as unknown as WLM[];
  if (!norm || norm.length < 21 || !world || world.length < 21)
    return { hand: blankHand(role), count: -1, normSm: null };

  const metrics = fingerMetrics(world);
  const r = state.update(metrics, norm, nowMs);
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
    case 0: return FormationState.THOUSAND_SILK;
    case 1: return FormationState.SWORD_BEAM;
    case 2: return FormationState.SWORD_SHADOW;
    case 3: return FormationState.SWORD_SHIELD;
    case 4: return FormationState.TONGTIAN_ARRAY;
    case 5: return FormationState.DAGENG_ARRAY;
    default: return FormationState.IDLE;
  }
}

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

export default HandTrackerTF;

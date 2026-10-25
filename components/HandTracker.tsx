/**
 * HandTracker — MediaPipe Tasks Vision 手势识别
 * @version 4.0 阵式重制
 * @description
 *   采用 MediaPipe Tasks Vision API（v0.10+），本地 WASM 加速。
 *
 *   左右手分工（与 v2.0 一致）：
 *     左手 → 飞剑数量（32/64/128/256/512）、剑光速度（5 档）、锁定
 *     右手 → 剑阵招式（v4.0 七式，全部为动漫真实剑招）、剑体大小（5~30）、光标定位
 *       握拳 → 千丝绞杀 / 1 指 → 青元剑芒 / 2 指 → 剑影分光术
 *       3 指 → 青元剑盾 / 4 指 → 剑丝流光 / 5 指 → 大庚剑阵
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

// ─── 常量配置 ───────────────────────────────────────
const MODEL_URL        = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_BASE        = '/node_modules/@mediapipe/tasks-vision/wasm';
const FRAME_INTERVAL_MS = 42;       // ~24fps
const FINGER_HOLD_MS    = 220;       // 数量防抖
const DIST_CALIB_FRAMES = 30;        // 距离校准帧数
const SCALE_SMOOTH      = 0.30;
const SPEED_SMOOTH      = 0.40;

// ─── 工具：手指识别（基于 MediaPipe 21 个关键点） ──
/**
 * MediaPipe Hands 21 关键点索引：
 *   0   wrist
 *   1-4   拇指：CMC, MCP, IP, TIP
 *   5-8   食指：MCP, PIP, DIP, TIP
 *   9-12  中指
 *   13-16 无名指
 *   17-20 小指
 *
 * 算法：每根手指的 TIP 到 wrist 的 2D 距离 > PIP 到 wrist 距离 × 阈值
 *       拇指特殊：TIP 到 食指 MCP 距离 > 阈值
 */
function fingersUp(landmarks: { x: number; y: number; z: number }[]): { count: number; fist: boolean } {
  const wrist = landmarks[0];
  // 四指：TIP(8,12,16,20) vs PIP(6,10,14,18)
  const fingerPairs: [number, number, number][] = [
    [8, 6, 0],    // 食指
    [12, 10, 1],  // 中指
    [16, 14, 2],  // 无名指
    [20, 18, 3],  // 小指
  ];
  let count = 0;
  for (const [tip, pip] of fingerPairs) {
    const tipDist = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    const pipDist = Math.hypot(landmarks[pip].x - wrist.x, landmarks[pip].y - wrist.y);
    // 伸出时 tipDist / pipDist ≈ 1.3~1.5，弯曲时 ≈ 0.9~1.0
    if (tipDist / Math.max(pipDist, 0.001) > 1.15) count++;
  }
  // 拇指：TIP(4) 到 食指 MCP(5) 的距离
  // 拇指侧展时距离大，内收时距离小
  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const thumbDist = Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y);
  // 拇指伸出时 thumbDist 明显大于 食指 MCP 到 wrist 的距离
  const indexBaseDist = Math.hypot(indexMcp.x - wrist.x, indexMcp.y - wrist.y);
  if (thumbDist > indexBaseDist * 0.95) count++;
  return { count: Math.min(count, 5), fist: count <= 1 };
}

// ─── 距离标定器 ─────────────────────────────────
class DistanceCalibrator {
  private samples: number[] = [];
  private refSize = 0;
  private calibrated = false;
  private smoothed = 0.5;
  update(handSize: number): number {
    if (handSize < 0.01) return this.smoothed;
    if (!this.calibrated) {
      this.samples.push(handSize);
      if (this.samples.length >= DIST_CALIB_FRAMES) {
        const sorted = [...this.samples].sort((a, b) => a - b);
        // 去掉头尾 20% 异常值
        const drop = Math.floor(sorted.length * 0.2);
        const trimmed = sorted.slice(drop, sorted.length - drop);
        this.refSize = trimmed[Math.floor(trimmed.length / 2)];
        this.calibrated = true;
      }
      return 0.5;
    }
    const ratio = handSize / Math.max(this.refSize, 0.001);
    const target = Math.max(0, Math.min(1, (ratio - 0.5) / 1.2));
    this.smoothed = this.smoothed * 0.65 + target * 0.35;
    return this.smoothed;
  }
  reset() { this.samples = []; this.refSize = 0; this.calibrated = false; this.smoothed = 0.5; }
}

// ─── 数量防抖器 ─────────────────────────────────
class FingerDebouncer {
  private candidate = -1;
  private holdStart = 0;
  private lastStable = 0;
  accept(current: number, nowMs: number): number {
    if (current === this.candidate) return this.lastStable;
    this.candidate = current;
    this.holdStart = nowMs;
    return this.lastStable;
  }
  tick(nowMs: number): number {
    if (this.candidate < 0) return this.lastStable;
    if (nowMs - this.holdStart >= FINGER_HOLD_MS) {
      this.lastStable = this.candidate;
    }
    return this.lastStable;
  }
}

// ─── 主组件 ──────────────────────────────────────
const HandTracker: any = ({ onUpdate }: HandTrackerProps) => {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const rafIdRef     = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const busyRef      = useRef<boolean>(false);

  const [status, setStatus]     = useState<HandTrackerStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 稳定状态
  const stableRef = useRef({
    scale: 15, count: 32, speed: 0.75, locked: false,
  });

  useEffect(() => {
    let active = true;
    // 摄像头 → 识别 循环
    const tick = (now: number) => {
      if (!active) return;
      rafIdRef.current = requestAnimationFrame(tick);
      // 节流
      if (now - lastFrameRef.current < FRAME_INTERVAL_MS) return;
      if (!videoRef.current) return;
      const video = videoRef.current;
      if (video.paused || video.readyState < 2) return;
      if (busyRef.current) return;
      lastFrameRef.current = now;
      busyRef.current = true;
      // Tasks Vision 新 API：detectForVideo 返回同步结果
      try {
        const result = landmarkerRef.current?.detectForVideo(video, now);
        if (result) onResults(result);
      } catch (e: any) {
        console.warn('[HandTracker] detect 失败:', e);
      } finally {
        busyRef.current = false;
      }
    };

    const onResults = (result: HandLandmarkerResult) => {
      const now = performance.now();
      const noHand = !result.landmarks || result.landmarks.length === 0;
      if (noHand) {
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

      // ── 分类左右手（用 handedness.label） ──
      let leftLand: any = null, rightLand: any = null;
      for (let i = 0; i < result.landmarks.length; i++) {
        const lm = result.landmarks[i];
        const label = result.handednesses?.[i]?.[0]?.displayName || result.handednesses?.[i]?.[0]?.categoryName;
        // selfieMode=true 时 'Left' = 用户视角左手
        const isUserRight = (label === 'Right');
        if (isUserRight && !rightLand) rightLand = lm;
        else if (!isUserRight && !leftLand) leftLand = lm;
      }

      // 校准器
      const calibL = calibrators.current.L;
      const calibR = calibrators.current.R;
      const debL   = debouncers.current.L;
      const debR   = debouncers.current.R;

      const left  = buildHandData(HandRole.LEFT,  leftLand,  calibL, debL, now);
      const right = buildHandData(HandRole.RIGHT, rightLand, calibR, debR, now);

      // ── 派生参数 ──
      const locked = left.detected && left.fingerCount <= 1;
      stableRef.current.locked = locked;

      // 剑体大小：右手距离 → 5~30
      if (!locked && right.detected) {
        const target = SCALE_MIN + right.distance * (SCALE_MAX - SCALE_MIN);
        smoothScale.current.v = smoothScale.current.v * (1 - SCALE_SMOOTH) + target * SCALE_SMOOTH;
      }
      stableRef.current.scale = smoothScale.current.v;

      // 飞剑数量：左手伸出指 → 查表
      if (!locked && left.detected) {
        const fc = debL.tick(now);
        if (fc > 0 && SWORD_COUNT_BY_FINGER[fc] !== undefined) {
          stableRef.current.count = SWORD_COUNT_BY_FINGER[fc];
        }
      }

      // 剑光速度：左手距离 → 5 档
      if (!locked && left.detected) {
        const level = Math.round(left.distance * 4);
        const target = SPEED_LEVELS[Math.max(0, Math.min(4, level))].value;
        smoothSpeed.current.v = smoothSpeed.current.v * (1 - SPEED_SMOOTH) + target * SPEED_SMOOTH;
      }
      stableRef.current.speed = smoothSpeed.current.v;

      // 阵式
      const formation = pickFormation(right);

      // 光标（已镜像）
      const cursorX = right.detected ? 1 - right.x : 0.5;
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

    // 启动流程
    const start = async () => {
      try {
        // 1) 初始化摄像头
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持 getUserMedia');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
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

        // 2) 初始化 HandLandmarker（Tasks Vision 新 API）
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.5,
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
      streamRef.current?.getTracks().forEach((t: any) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onUpdate]);

  // 平滑缓冲
  const smoothScale = useRef({ v: 15 });
  const smoothSpeed = useRef({ v: 0.75 });
  // 校准器/防抖器（全局唯一，按角色分别实例化）
  const calibrators = useRef({ L: new DistanceCalibrator(), R: new DistanceCalibrator() });
  const debouncers = useRef({ L: new FingerDebouncer(), R: new FingerDebouncer() });

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
          </>
        )}
      </div>
    </div>
  );
};

// ─── 工具：空白手部数据 ─────────────────────────
function blankHand(role: HandRole): HandData {
  return { role, detected: false, x: 0.5, y: 0.5, distance: 0.5, fingerCount: 0 };
}

function buildHandData(
  role: HandRole,
  landmarks: any,
  calibrator: DistanceCalibrator,
  debouncer: FingerDebouncer,
  nowMs: number,
): HandData {
  if (!landmarks) return blankHand(role);
  const fingers = fingersUp(landmarks);
  debouncer.accept(fingers.count, nowMs);
  const wrist = landmarks[0];
  const midMcp = landmarks[9];
  const handSize = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y);
  const distance = calibrator.update(handSize);
  return {
    role,
    detected: true,
    x: landmarks[9].x,
    y: landmarks[9].y,
    distance,
    fingerCount: fingers.count,
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

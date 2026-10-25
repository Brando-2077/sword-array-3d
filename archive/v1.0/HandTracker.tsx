import React, { useEffect, useRef, useState } from 'react';
import { FormationState, InteractionData, HandData, HandRole } from '../types';

declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

interface HandTrackerProps {
  onUpdate: (data: InteractionData) => void;
}

// ─── Helpers ────────────────────────────────────────────────
function fingersUp(landmarks: any[]): { count: number; allUp: boolean; noneUp: boolean } {
  const wrist = landmarks[0];
  // Thumb(4,2), Index(8,5), Middle(12,9), Ring(16,13), Pinky(20,17)
  const pairs = [[4,2], [8,5], [12,9], [16,13], [20,17]];
  let up = 0;
  for (const [tipIdx, mcpIdx] of pairs) {
    const tipDist = Math.hypot(landmarks[tipIdx].x - wrist.x, landmarks[tipIdx].y - wrist.y);
    const mcpDist = Math.hypot(landmarks[mcpIdx].x - wrist.x, landmarks[mcpIdx].y - wrist.y);
    // Extended if tip is >=15% farther from wrist than MCP
    if (tipDist > mcpDist * 1.15) up++;
  }
  return { count: up, allUp: up >= 5, noneUp: up <= 1 };
}

// ─── Adaptive distance calibration ──────────────────────────
// Collects initial hand-size samples to establish a fixed "head-size" reference
class DistanceCalibrator {
  private samples = 0;
  private refSize = 0;

  update(handSize: number): number {
    this.samples++;
    // First 60 frames (~2s): build reference from neutral hand position
    if (this.samples <= 60) {
      this.refSize = (this.refSize * (this.samples - 1) + handSize) / this.samples;
      return 0.5; // neutral during calibration
    }
    // After calibration: compare to fixed reference (like comparing hand to head)
    const ratio = handSize / this.refSize;
    return Math.min(Math.max((ratio - 0.4) / 1.6, 0), 1);
  }
}

// Estimate hand distance relative to calibrated reference (head-size analogy)
function estimateDistance(landmarks: any[], calibrator: DistanceCalibrator): number {
  const wrist = landmarks[0];
  const middleBase = landmarks[9];
  const handSize = Math.hypot(wrist.x - middleBase.x, wrist.y - middleBase.y);
  return calibrator.update(handSize);
}

function getHand(x: number): HandRole {
  // MediaPipe returns left/right handedness but we detect from position
  // Right hand typically appears on right side of frame (x > 0.5 if not mirrored)
  // Actually, we compute based on landmark relative position
  return x < 0.5 ? HandRole.RIGHT : HandRole.LEFT;
}

// ─── Component ──────────────────────────────────────────────
const HandTracker: React.FC<HandTrackerProps> = ({ onUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handsRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'loading' | 'active' | 'error' | 'no-cam'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Stable state for locked values
  const lockedRef = useRef({ scale: 200, count: 72, speed: 15, locked: false });

  useEffect(() => {
    let active = true;
    let animFrame = 0;

    const loadScripts = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (window.Hands) { resolve(); return; }
        let attempts = 0;
        const check = setInterval(() => {
          attempts++;
          if (window.Hands) { clearInterval(check); resolve(); }
          else if (attempts >= 40) { clearInterval(check); reject(new Error('MediaPipe 脚本加载超时')); }
        }, 250);
      });
    };

    const initCamera = async (): Promise<HTMLVideoElement> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => { video.play().then(() => resolve()); };
      });
      return video;
    };

    const initHands = async (): Promise<any> => {
      // ─── Debounce state: only apply param changes after 0.5s stability ──
      const DEBOUNCE_MS = 300;
      const pendingRef = { scale: 20, count: 72, speed: 1.5 };
      const stableRef = { scale: 20, count: 72, speed: 1.5 };
      // Adaptive distance calibrators (one per hand)
      const calibLeft = new DistanceCalibrator();
      const calibRight = new DistanceCalibrator();
      let lastChangeTime = 0;

      const hands = new window.Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });
      return new Promise((resolve) => {
        hands.onResults((res: any) => {
          if (!res.multiHandLandmarks || res.multiHandLandmarks.length === 0) {
            // No hands → idle
            onUpdate({
              left:  { role: HandRole.LEFT,  detected: false, x: 0, y: 0, distance: 0, fingerCount: 0, isPalm: false, isFist: false },
              right: { role: HandRole.RIGHT, detected: false, x: 0, y: 0, distance: 0, fingerCount: 0, isPalm: false, isFist: false },
              targetX: 0.5, targetY: 0.5, targetActive: false,
              formation: FormationState.IDLE,
              swordScale: lockedRef.current.scale, swordCount: lockedRef.current.count,
              animSpeed: lockedRef.current.speed, locked: lockedRef.current.locked,
            });
            return;
          }

          // Classify hands
          let rightHand: any = null, leftHand: any = null;
          for (let i = 0; i < res.multiHandLandmarks.length; i++) {
            const lm = res.multiHandLandmarks[i];
            const avgX = lm.slice(0, 10).reduce((s: number, l: any) => s + l.x, 0) / 10;
            // In mirrored camera: right hand appears on left side
            const isRight = avgX < 0.5;
            if (isRight && !rightHand) rightHand = lm;
            else if (!isRight && !leftHand) leftHand = lm;
          }

          // Process right hand (formation + cursor + speed)
          const right: HandData = {
            role: HandRole.RIGHT, detected: !!rightHand, x: 0, y: 0, distance: 0,
            fingerCount: 0, isPalm: false, isFist: false,
          };
          if (rightHand) {
            const f = fingersUp(rightHand);
            right.fingerCount = f.count;
            right.isPalm = f.allUp;
            right.isFist = f.noneUp;
            right.distance = estimateDistance(rightHand, calibRight);
            right.x = 1 - rightHand[9].x;
            right.y = rightHand[9].y;
          }

          // Process left hand (scale + count + lock)
          const left: HandData = {
            role: HandRole.LEFT, detected: !!leftHand, x: 0, y: 0, distance: 0,
            fingerCount: 0, isPalm: false, isFist: false,
          };
          if (leftHand) {
            const f = fingersUp(leftHand);
            left.fingerCount = f.count;
            left.isPalm = f.allUp;
            left.isFist = f.noneUp;
            left.distance = estimateDistance(leftHand, calibLeft);
            left.x = 1 - leftHand[9].x;
            left.y = leftHand[9].y;
          }

          // ─── Derive sword parameters ─────────────────────
          let locked = left.isFist;

          // Scale: real-time from left hand distance (no debounce)
          let swordScale = lockedRef.current.scale;
          if (!locked && left.detected) {
            swordScale = 5 + right.distance * 25; // 5~30, real-time
            lockedRef.current.scale = swordScale;
          }

          // Count: left finger count → discrete levels → debounced 300ms
          let swordCount = lockedRef.current.count;
          if (!locked && left.detected && left.fingerCount >= 1 && left.fingerCount <= 5) {
            const levels = [8, 16, 32, 64, 128];
            const targetCount = levels[left.fingerCount - 1];
            const now = performance.now();
            if (targetCount !== pendingRef.count) {
              pendingRef.count = targetCount;
              lastChangeTime = now;
            }
            if (now - lastChangeTime >= DEBOUNCE_MS) {
              stableRef.count = pendingRef.count;
            }
            swordCount = stableRef.count;
            lockedRef.current.count = swordCount;
          }

          // Speed: real-time from right hand distance (no debounce)
          let animSpeed = lockedRef.current.speed;
          if (!locked && left.detected) {
            const speedLevel = Math.round(left.distance * 4); // 0~4
            const speedLevels = [0.5, 1.0, 1.5, 2.0, 2.8];
            animSpeed = speedLevels[speedLevel];
            lockedRef.current.speed = animSpeed;
          }

          if (locked) {
            lockedRef.current.locked = true;
            lastChangeTime = performance.now();
            swordScale = lockedRef.current.scale;
            swordCount = lockedRef.current.count;
            animSpeed = lockedRef.current.speed;
          }

          // Right hand formation selection
          let formation = FormationState.IDLE;
          if (right.detected) {
            if (right.isFist)      formation = FormationState.RETRACT;
            else if (right.isPalm) formation = FormationState.SHIELD_DISK;
            else if (right.fingerCount === 1) formation = FormationState.POINT_STRIKE;
            else if (right.fingerCount === 2) formation = FormationState.DUAL_STREAM;
            else if (right.fingerCount === 3) formation = FormationState.TRIPLE_HELIX;
            else if (right.fingerCount === 4) formation = FormationState.FAN_WAVE;
            else if (right.fingerCount === 5) formation = FormationState.SWARM;
          }

          // Smooth cursor
          const targetX = right.detected ? right.x : 0.5;
          const targetY = right.detected ? right.y : 0.5;

          onUpdate({
            left, right,
            targetX, targetY, targetActive: right.detected,
            formation,
            swordScale, swordCount, animSpeed, locked,
          });
        });
        resolve(hands);
      });
    };

    const start = async () => {
      try {
        await loadScripts();
        if (!active) return;
        if (!videoRef.current) return;
        await initCamera();
        if (!active) return;
        setStatus('active');
        const hands = await initHands();
        handsRef.current = hands;

        const video = videoRef.current;
        const processFrame = async () => {
          if (!active || !video || video.paused || video.readyState < 2) {
            animFrame = requestAnimationFrame(processFrame);
            return;
          }
          try { await hands.send({ image: video }); } catch (_) {}
          animFrame = requestAnimationFrame(processFrame);
        };
        animFrame = requestAnimationFrame(processFrame);
      } catch (err: any) {
        console.error('[剑阵] 初始化失败:', err);
        if (!active) return;
        if (err.name === 'NotAllowedError') { setStatus('error'); setErrorMsg('摄像头权限被拒绝'); }
        else if (err.name === 'NotFoundError') { setStatus('no-cam'); setErrorMsg('未检测到摄像头'); }
        else { setStatus('error'); setErrorMsg(err.message || '阵眼感应失效'); }
      }
    };

    start();
    return () => {
      active = false;
      cancelAnimationFrame(animFrame);
      if (handsRef.current) { try { handsRef.current.close(); } catch (_) {} }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
      if (videoRef.current) { videoRef.current.srcObject = null; }
    };
  }, []);

  return (
    <div className="fixed bottom-12 right-12 z-50 pointer-events-none">
      <div className={`w-[400px] aspect-[4/3] rounded-2xl overflow-hidden border-2 ${
        status === 'active' ? 'border-emerald-500/70' : status === 'loading' ? 'border-emerald-500/30' : 'border-red-500/50'
      } bg-black/80 transition-all duration-700 relative`}>
        <video ref={videoRef} autoPlay playsInline muted
          className="w-full h-full object-cover scale-x-[-1] grayscale contrast-125 opacity-50" />
        {status !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-2">
            {status === 'loading' && <>
              <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
              <span className="text-emerald-400/80 text-xs tracking-widest">感应阵眼...</span>
            </>}
            {(status === 'error' || status === 'no-cam') && <>
              <span className="text-xl">⚠️</span>
              <span className="text-red-400/80 text-[10px] text-center px-2">{errorMsg}</span>
            </>}
          </div>
        )}
        {status === 'active' && (
          <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </div>
    </div>
  );
};

export default HandTracker;

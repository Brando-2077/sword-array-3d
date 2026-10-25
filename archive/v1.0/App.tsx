import React, { useState, useEffect, useRef } from 'react';
import SwordArray3D from './components/SwordArray3D';
import HandTracker from './components/HandTracker';
import { FormationState, InteractionData } from './types';
import { Sword, Lock, Unlock } from 'lucide-react';

const App: React.FC = () => {
  const [interact, setInteract] = useState<InteractionData>({
    left:  { role: 'LEFT' as any, detected: false, x: 0, y: 0, distance: 0, fingerCount: 0, isPalm: false, isFist: false },
    right: { role: 'RIGHT' as any, detected: false, x: 0, y: 0, distance: 0, fingerCount: 0, isPalm: false, isFist: false },
    targetX: 0.5, targetY: 0.5, targetActive: false,
    formation: FormationState.IDLE,
    swordScale: 20, swordCount: 72, animSpeed: 1.5, locked: false,
  });

  const smoothScale = useRef(20);
  const smoothCount = useRef(72);
  const smoothSpeed = useRef(1.5);
  const smoothTargetX = useRef(0.5);
  const smoothTargetY = useRef(0.5);

  useEffect(() => {
    let frame: number;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const loop = () => {
      smoothTargetX.current = lerp(smoothTargetX.current, interact.targetX, 0.3);
      smoothTargetY.current = lerp(smoothTargetY.current, interact.targetY, 0.3);
      smoothScale.current = lerp(smoothScale.current, interact.swordScale, 0.25);
      smoothCount.current = lerp(smoothCount.current, interact.swordCount, 0.25);
      smoothSpeed.current = lerp(smoothSpeed.current, interact.animSpeed, 0.3);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [interact.targetX, interact.targetY, interact.swordScale, interact.swordCount, interact.animSpeed]);

  const effectiveScale = smoothScale.current;
  const effectiveCount = Math.round(smoothCount.current);
  const effectiveSpeed = smoothSpeed.current;

  const formationDisplay: Record<number, string> = {
    0: '剑丸归元', 1: '青元剑河', 2: '龙吟双流', 3: '三才螺旋', 4: '庚金巨浪', 5: '万剑随心', 6: '庚金盾幕'
  };
  const formationColors: Record<number, string> = {
    0: 'text-red-300', 1: 'text-emerald-300', 2: 'text-blue-300', 3: 'text-yellow-300',
    4: 'text-emerald-200', 5: 'text-amber-300', 6: 'text-emerald-300'
  };

  // 右手控招式（手指数量）
  const rightFingerCount = interact.right.detected
    ? (interact.right.isFist ? 0 : interact.right.isPalm ? 6 : interact.right.fingerCount)
    : -1;
  const formationName = rightFingerCount >= 0 ? formationDisplay[rightFingerCount] : '剑意感知';
  const formationColor = rightFingerCount >= 0 ? formationColors[rightFingerCount] : 'text-cyan-400';

  // 左手控数值：速度（左手距离）
  const speedLevel = interact.left.detected ? Math.round(interact.left.distance * 4) : -1;
  const speedLabels = ['极缓', '缓流', '中速', '疾驰', '雷光'];
  const speedColors = ['text-slate-300', 'text-blue-300', 'text-emerald-300', 'text-amber-300', 'text-red-300'];

  const scalePct = ((effectiveScale - 5) / 25) * 100; // 0-100%

  return (
    <div className="h-screen w-screen bg-[#010409] text-slate-100 flex overflow-hidden relative font-['Noto_Serif_SC']">
      
      {/* ─── 3D Scene ─────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <SwordArray3D 
          state={interact.formation}
          targetPos={{ x: smoothTargetX.current, y: smoothTargetY.current, vx: 0, vy: 0, active: interact.targetActive }}
          swordScale={effectiveScale}
          swordCount={effectiveCount}
          animSpeed={effectiveSpeed}
        />
      </div>

      {/* ─── TOP BAR ──────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="px-12 py-6">
          
          {/* Main row: [Title Left] [Numbers Center] [Formation Right] */}
          <div className="flex items-center justify-between gap-8">

            {/* Left: Title */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="p-4 bg-emerald-500/25 rounded-xl border-2 border-emerald-400/50 shadow-[0_0_50px_rgba(16,185,129,0.35)]">
                <Sword className="text-emerald-300 w-10 h-10" />
              </div>
              <div>
                <h1 className="text-[2.2rem] font-black bg-gradient-to-r from-emerald-300 via-cyan-200 to-white bg-clip-text text-transparent tracking-[0.2em] leading-tight">
                  大庚剑阵
                </h1>
                <p className="text-base text-emerald-300/70 tracking-[0.5em] font-bold uppercase -mt-1">赛博修炼</p>
              </div>
            </div>

            {/* Center: Numbers — 3 columns */}
            <div className="flex-1 flex justify-center">
              <div className="flex items-center gap-10 px-10 py-5 rounded-2xl bg-slate-900/80 backdrop-blur-2xl border-2 border-slate-500/30 shadow-[0_0_80px_rgba(16,185,129,0.08)]">

                {/* ── Scale ── */}
                <div className="flex flex-col items-center min-w-[120px]">
                  <span className="text-sm text-slate-300 font-bold tracking-[0.15em] mb-1.5">剑体大小</span>
                  <span className="text-[3.2rem] font-black text-emerald-300 tabular-nums leading-none"
                    style={{ textShadow: '0 0 40px rgba(16,185,129,0.7)' }}>
                    {effectiveScale.toFixed(0)}
                  </span>
                  <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden border border-slate-500/30 mt-2.5">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-200 transition-all duration-300 shadow-[0_0_16px_#10b981]"
                      style={{ width: `${scalePct}%` }} />
                  </div>
                </div>

                {/* Divider */}
                <div className="w-0.5 h-16 bg-slate-600/60" />

                {/* ── Count ── */}
                <div className="flex flex-col items-center min-w-[120px]">
                  <span className="text-sm text-slate-300 font-bold tracking-[0.15em] mb-1.5">飞剑数量</span>
                  <span className="text-[3.2rem] font-black text-amber-300 tabular-nums leading-none"
                    style={{ textShadow: '0 0 40px rgba(245,158,11,0.7)' }}>
                    {effectiveCount}
                  </span>
                  <div className="flex gap-2.5 mt-2.5">
                    {[1,2,3,4,5].map(n => (
                      <div key={n} className="w-5 h-3 rounded-full transition-all duration-300"
                        style={{
                          background: interact.right.detected && interact.right.fingerCount >= n
                            ? 'linear-gradient(to right, #d97706, #fbbf24)'
                            : '#334155',
                          boxShadow: interact.right.detected && interact.right.fingerCount >= n ? '0 0 12px rgba(251,191,36,0.7)' : 'none'
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="w-0.5 h-16 bg-slate-600/60" />

                {/* ── Speed ── */}
                <div className="flex flex-col items-center min-w-[120px]">
                  <span className="text-sm text-slate-300 font-bold tracking-[0.15em] mb-1.5">剑光速度</span>
                  <span className={`text-[3.2rem] font-black tabular-nums leading-none transition-colors duration-300 ${speedLevel >= 0 ? speedColors[speedLevel] : 'text-slate-500'}`}
                    style={{ textShadow: speedLevel >= 0 ? '0 0 40px rgba(245,158,11,0.6)' : 'none' }}>
                    {speedLevel >= 0 ? speedLabels[speedLevel] : '—'}
                  </span>
                  <div className="flex gap-2.5 mt-2.5">
                    {[0,1,2,3,4].map(n => (
                      <div key={n} className="w-5 h-3 rounded-full transition-all duration-300"
                        style={{
                          background: speedLevel >= 0 && n <= speedLevel
                            ? n <= 1 ? 'linear-gradient(to right, #2563eb, #60a5fa)' :
                              n === 2 ? 'linear-gradient(to right, #059669, #34d399)' :
                              n === 3 ? 'linear-gradient(to right, #d97706, #fbbf24)' :
                              'linear-gradient(to right, #dc2626, #f87171)'
                            : '#334155',
                          boxShadow: speedLevel >= 0 && n <= speedLevel ? `0 0 12px ${n <= 1 ? 'rgba(59,130,246,0.6)' : n === 2 ? 'rgba(16,185,129,0.6)' : n === 3 ? 'rgba(245,158,11,0.6)' : 'rgba(239,68,68,0.6)'}` : 'none'
                        }}
                      />
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* Right: Formation name + hand status */}
            <div className="flex items-center gap-5 shrink-0">
              
              {/* Hand indicators（左右手功能已互换） */}
              <div className="flex flex-col gap-2 items-end">
                {/* 右手：控数值，显示锁定状态 */}
                <div className="flex items-center gap-2">
                  <span className="text-base text-slate-300 font-bold tracking-[0.1em]">右手</span>
                  {interact.locked ? (
                    <Lock className="w-5 h-5 text-red-400" />
                  ) : interact.right.detected ? (
                    <Unlock className="w-5 h-5 text-emerald-400" />
                  ) : null}
                </div>
                {/* 左手：控招式，显示检测状态 */}
                <div className="flex items-center gap-2">
                  {interact.left.detected ? (
                    <div className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_10px_#f59e0b] animate-pulse" />
                  ) : null}
                  <span className="text-base text-slate-300 font-bold tracking-[0.1em]">左手</span>
                </div>
              </div>

              {/* Formation name — large, glowing */}
              <div className={`text-[2.8rem] font-black tracking-[0.35em] transition-all duration-500 whitespace-nowrap ${formationColor}`}
                style={{ textShadow: `0 0 60px currentColor` }}>
                {formationName}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ─── Bottom: Idle message ────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none flex justify-center pb-12">
        {!interact.targetActive && (
          <div className="flex items-center gap-5 bg-black/60 backdrop-blur-3xl px-14 py-5 rounded-full border-2 border-emerald-500/20">
            <div className="w-7 h-7 border-3 border-emerald-500/30 border-t-emerald-300 rounded-full animate-spin"></div>
            <span className="text-emerald-300/80 text-xl tracking-[0.8em] font-black">待主领阵</span>
          </div>
        )}
      </div>

      <HandTracker onUpdate={setInteract} />
      <div className="absolute inset-0 pointer-events-none z-20" style={{ boxShadow: 'inset 0 0 600px rgba(0,0,0,0.8)' }} />
    </div>
  );
};

export default App;

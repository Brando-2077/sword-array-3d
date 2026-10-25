/**
 * App — 大庚剑阵 · 灵动篇 主应用
 * @version 2.0 重置版
 * @description
 *   UI 完全按需求 §5 设计：
 *   - 顶部三段式：标题 / 三大参数 / 阵名 + 手部状态
 *   - 摄像头缩到 320px
 *   - 底部"待主领阵"
 *   - 颜色统一：绿色基 + 金色点缀
 *   - 数字 + 进度条 + 指示灯联动
 *
 *   性能优化：所有平滑用 ref + RAF，setState 只在用户可感知的离散量上触发
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import SwordArray3D from './components/SwordArray3D';
import HandTracker  from './components/HandTracker';
import {
  FormationState, HandData, HandRole, InteractionData, FORMATION_META, SPEED_LEVELS,
} from './types';
import { Sword, Lock, Unlock, Zap, Crosshair, ChevronRight } from 'lucide-react';

const App: React.FC = () => {
  // 调试/演示参数：?f=FIVE_FINGER&c=512&s=18 → 固定阵式/数量/大小，跳过手势识别（用于无摄像头验证）
  const debugParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const debugPin = debugParams.get('f') !== null;
  const initScale = Number(debugParams.get('s') || (localStorage.getItem('dageng-scale-default')) || 15);
  const initCount = Number(debugParams.get('c')) || 72;
  const initSpeed = SPEED_LEVELS[2].value; // 与速度档位一致（中速），杜绝初始态落在档间

  // 顶层 state：只存"会触发重渲染"的离散量（初始值与档位表严格一致）
  const blankHandL: HandData = { role: HandRole.LEFT,  detected: false, x: 0.5, y: 0.5, distance: 0.5, fingerCount: 0, distCm: 0 };
  const blankHandR: HandData = { role: HandRole.RIGHT, detected: false, x: 0.5, y: 0.5, distance: 0.5, fingerCount: 0, distCm: 0 };
  const [interact, setInteract] = useState<InteractionData>({
    left:  blankHandL,
    right: blankHandR,
    cursorX: 0.5, cursorY: 0.5, cursorActive: false,
    formation: (FormationState as Record<string, FormationState>)[debugParams.get('f') ?? ''] ?? FormationState.IDLE,
    swordScale: initScale, scaleTier: 4, swordCount: initCount,
    animSpeed: initSpeed, speedTier: 2, locked: false,
  });

  // 平滑缓冲（不触发重渲染）；初始值与 interact 一致，保证无手势更新（调试模式）时参数直达
  const smoothScale = useRef(initScale);
  const smoothCount = useRef(initCount);
  const smoothSpeed = useRef(initSpeed);
  const smoothCx    = useRef(0.5);
  const smoothCy    = useRef(0.5);

  // RAF 平滑循环
  useEffect(() => {
    let rafId = 0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const loop = () => {
      smoothCx.current    = lerp(smoothCx.current,    interact.cursorX,     0.30);
      smoothCy.current    = lerp(smoothCy.current,    interact.cursorY,     0.30);
      smoothScale.current = lerp(smoothScale.current, interact.swordScale,  0.25);
      smoothCount.current = lerp(smoothCount.current, interact.swordCount,  0.20);
      smoothSpeed.current = lerp(smoothSpeed.current, interact.animSpeed,   0.30);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [interact.cursorX, interact.cursorY, interact.swordScale, interact.swordCount, interact.animSpeed]);

  // ── 派生展示数据 ──────────────────────────────
  const scale         = smoothScale.current;
  const count         = Math.round(smoothCount.current);          // 平滑值：仅供 3D 渐变
  const targetCount   = interact.swordCount;                      // 目标档位：UI 显示用（始终为档位值）
  const speed         = smoothSpeed.current;
  const formation     = interact.formation;
  const meta          = FORMATION_META[formation];
  const scaleTier     = Math.max(0, Math.min(9, interact.scaleTier ?? 4)); // 识别层目标档位直出
  const scalePct      = (scaleTier + 1) * 10;
  const speedLevel    = Math.max(0, Math.min(SPEED_LEVELS.length - 1, interact.speedTier ?? 2)); // 识别层目标档位直出
  const speedMeta     = SPEED_LEVELS[speedLevel];
  const leftDetected  = interact.left.detected;
  const rightDetected = interact.right.detected;
  const locked        = interact.locked;
  const cursorActive  = interact.cursorActive;

  // ── 实时数据监测面板（?debug=1 或按 D 键开关，localStorage 记忆） ──
  const [showHud, setShowHud] = useState<boolean>(() => {
    if (debugParams.get('debug') === '1') return true;
    try { return localStorage.getItem('dageng-hud') === '1'; } catch { return false; }
  });
  const fpsRef = useRef({ frames: 0, t: performance.now(), fps: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        setShowHud((v) => {
          try { localStorage.setItem('dageng-hud', v ? '0' : '1'); } catch { /* noop */ }
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const f = fpsRef.current;
      f.frames++;
      const now = performance.now();
      if (now - f.t >= 1000) { f.fps = f.frames; f.frames = 0; f.t = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  // 数据同步挂 window，控制台可 window.__DAGENG 实时查看
  useEffect(() => {
    (window as any).__DAGENG = {
      fps: fpsRef.current.fps,
      target: { count: interact.swordCount, scale: interact.swordScale, tier: interact.scaleTier, speed: interact.animSpeed, speedTier: interact.speedTier, formation: interact.formation },
      smoothed: { count: Math.round(smoothCount.current), scale: smoothScale.current, speed: smoothSpeed.current },
      left: interact.left, right: interact.right,
      cursor: { x: interact.cursorX, y: interact.cursorY, active: interact.cursorActive },
      locked: interact.locked,
    };
  });

  return (
    <div className="h-screen w-screen bg-[#010409] text-slate-100 flex overflow-hidden relative font-['Noto_Serif_SC']">

      {/* ── 3D Scene（底层） ───────────────────── */}
      <div className="absolute inset-0 z-0">
        <SwordArray3D
          formation={formation}
          cursorX={smoothCx.current}
          cursorY={smoothCy.current}
          cursorActive={cursorActive}
          swordScale={scale}
          swordCount={count}
          animSpeed={speed}
        />
      </div>

      {/* ── Top Bar ────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="px-10 py-6">
          <div className="flex items-start justify-between gap-6">

            {/* 左段：标题 */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="p-4 bg-emerald-500/20 rounded-2xl border-2 border-emerald-400/50 shadow-[0_0_40px_rgba(16,185,129,0.35)] backdrop-blur-md">
                <Sword className="text-emerald-300 w-9 h-9" strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="text-[2.1rem] font-black bg-gradient-to-r from-emerald-300 via-teal-200 to-white bg-clip-text text-transparent tracking-[0.2em] leading-tight">
                  大庚剑阵
                </h1>
                <p className="text-sm text-emerald-300/70 tracking-[0.5em] font-bold uppercase -mt-0.5">
                  赛博修炼
                </p>
              </div>
            </div>

            {/* 中段：三大参数 */}
            <div className="flex-1 flex justify-center">
              <div className="flex items-stretch gap-8 px-9 py-4 rounded-2xl bg-slate-900/70 backdrop-blur-2xl border-2 border-emerald-500/15 shadow-[0_0_60px_rgba(16,185,129,0.08)]">

                {/* 剑体大小 */}
                <ParamPanel
                  label="剑体大小"
                  value={`${scaleTier + 1} 档`}
                  valueColor="text-emerald-300"
                  valueShadow="0 0 40px rgba(16,185,129,0.7)"
                  minWidth={120}
                  progress={{
                    pct: scalePct,
                    gradient: 'from-emerald-600 via-emerald-400 to-teal-200',
                    glow: 'rgba(16,185,129,0.7)',
                  }}
                />

                <Divider />

                {/* 飞剑数量 */}
                <ParamPanel
                  label="飞剑数量"
                  value={String(targetCount)}
                  valueColor="text-amber-300"
                  valueShadow="0 0 40px rgba(245,158,11,0.7)"
                  minWidth={120}
                  dots={{
                    count: 5,
                    active: ({ 9: 1, 12: 2, 24: 3, 36: 4, 72: 5 } as Record<number, number>)[targetCount] ?? 0,
                    color: 'linear-gradient(to right, #d97706, #fbbf24)',
                    glow: 'rgba(251,191,36,0.7)',
                  }}
                />

                <Divider />

                {/* 剑光速度 */}
                <ParamPanel
                  label="剑光速度"
                  value={speedMeta.label}
                  valueColor={speedMeta.color}
                  valueShadow={`0 0 40px ${speedMeta.hex}80`}
                  minWidth={120}
                  dots={{
                    count: SPEED_LEVELS.length,
                    active: speedLevel,
                    color: speedMeta.hex,
                    glow: `${speedMeta.hex}aa`,
                  }}
                />
              </div>
            </div>

            {/* 右段：阵名 + 手部状态 */}
            <div className="flex items-center gap-4 shrink-0">
              <HandStatus
                label="左手"
                detected={leftDetected}
                extra={leftDetected ? (interact.left.fingerCount > 0 ? `${interact.left.fingerCount}指` : '…') : null}
                tone="emerald"
              />
              <HandStatus
                label="右手"
                detected={rightDetected}
                extra={rightDetected ? (interact.right.fingerCount > 0 ? `${interact.right.fingerCount}指` : '…') : null}
                tone="amber"
                locked={locked}
              />
              <div className="flex flex-col items-end">
                <div className={`text-[2.4rem] font-black tracking-[0.3em] whitespace-nowrap transition-all duration-700 ${meta.uiColor}`}
                  style={{ textShadow: `0 0 50px ${meta.uiColorHex}aa, 0 0 20px ${meta.uiColorHex}66` }}>
                  {meta.name}
                </div>
                <div className="text-[10px] text-slate-400/60 tracking-[0.3em] mt-0.5 font-bold">
                  {meta.trigger.toUpperCase()}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── 左下：手势操控图例 ───────────────── */}
      <div className="absolute bottom-12 left-12 z-20 pointer-events-none">
        <div className="bg-slate-900/70 backdrop-blur-2xl border border-emerald-500/20 rounded-2xl p-4 max-w-[260px]">
          <div className="text-[11px] text-emerald-300/80 font-bold tracking-[0.3em] mb-3 flex items-center gap-2">
            <Zap className="w-3 h-3" /> 手势心法
          </div>
          <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-300/80">
            <LegendRow>单手模式：一只手控全部</LegendRow>
            <LegendRow>1~5 指 → 剑数 9/12/24/36/72 + 对应阵式</LegendRow>
            <LegendRow>手远近 → 剑体 10 档 + 速度 4 档（已按手位锚定）</LegendRow>
            <LegendRow>双手模式：右手阵式/大小 左手剑数/速度</LegendRow>
            <LegendRow>双手时左手握拳（0 指）→ 冻结参数</LegendRow>
          </div>
        </div>
      </div>

      {/* ── 底部中央：待主领阵 ──────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none flex justify-center pb-10">
        {!cursorActive && (
          <div className="flex items-center gap-4 bg-black/60 backdrop-blur-3xl px-12 py-4 rounded-full border-2 border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
            <div className="relative w-6 h-6">
              <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full" />
              <div className="absolute inset-0 border-2 border-t-emerald-300 rounded-full animate-spin" />
            </div>
            <span className="text-emerald-300/90 text-lg tracking-[0.7em] font-black pl-2">待主领阵</span>
            <ChevronRight className="w-4 h-4 text-emerald-300/40 animate-pulse" />
          </div>
        )}
      </div>

      {/* ── 右上：当前阵式小卡 ──────────────── */}
      <div className="absolute top-[140px] right-10 z-20 pointer-events-none">
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-emerald-500/15 rounded-2xl p-4 max-w-[260px]">
          <div className="text-[10px] text-emerald-300/70 font-bold tracking-[0.3em] mb-2 flex items-center gap-2">
            <Crosshair className="w-3 h-3" /> 当前阵式
          </div>
          <div className={`text-lg font-black ${meta.uiColor} mb-1`} style={{ textShadow: `0 0 30px ${meta.uiColorHex}99` }}>
            {meta.name}
          </div>
          <div className="text-[11px] text-slate-300/70 leading-relaxed">
            {meta.description}
          </div>
        </div>
      </div>

      {/* ── 左上：实时数据监测面板（D 键开关） ─────── */}
      {showHud && (
        <div className="absolute top-[140px] left-10 z-30 pointer-events-none select-none">
          <div className="px-3 py-2 bg-black/75 backdrop-blur-md border border-emerald-500/25 rounded-xl font-mono text-[10px] leading-relaxed text-emerald-200/90 space-y-0.5 min-w-[240px]">
            <div className="text-emerald-300 font-bold tracking-widest">监测 · FPS {fpsRef.current.fps} {locked ? <span className="text-red-400">[锁定]</span> : ''}</div>
            <div className="text-amber-300/90">左 {interact.left.detected
              ? `${interact.left.fingerCount > 0 ? interact.left.fingerCount + '指' : '…'} ${interact.left.distCm ? interact.left.distCm.toFixed(0) : '?'}cm d${interact.left.distance.toFixed(2)} (${interact.left.x.toFixed(2)},${interact.left.y.toFixed(2)})`
              : '未检测'}</div>
            <div className="text-emerald-300/90">右 {interact.right.detected
              ? `${interact.right.fingerCount > 0 ? interact.right.fingerCount + '指' : '…'} ${interact.right.distCm ? interact.right.distCm.toFixed(0) : '?'}cm d${interact.right.distance.toFixed(2)} (${interact.right.x.toFixed(2)},${interact.right.y.toFixed(2)})`
              : '未检测'}</div>
            <div>目标 剑{interact.swordCount} 大小{interact.swordScale.toFixed(1)} 速度{interact.animSpeed.toFixed(2)}</div>
            <div>平滑 剑{count} 大小{scale.toFixed(1)} 速度{speed.toFixed(2)}</div>
            <div className="text-cyan-300/90">阵式 {formation} {cursorActive ? `光标(${interact.cursorX.toFixed(2)},${interact.cursorY.toFixed(2)})` : '无光标'}</div>
          </div>
        </div>
      )}

      {/* 手势识别（调试模式下跳过，避免摄像头权限弹窗） */}
      {!debugPin && <HandTracker onUpdate={setInteract} />}

      {/* 暗角 */}
      <div className="absolute inset-0 pointer-events-none z-20"
        style={{ boxShadow: 'inset 0 0 600px rgba(0,0,0,0.85)' }} />
    </div>
  );
};

// ─── 子组件：参数面板 ──────────────────────────────
const ParamPanel: React.FC<{
  label: string;
  value: string;
  valueColor: string;
  valueShadow: string;
  minWidth: number;
  progress?: { pct: number; gradient: string; glow: string };
  dots?: { count: number; active: number; color: string; glow: string };
}> = ({ label, value, valueColor, valueShadow, minWidth, progress, dots }) => (
  <div className="flex flex-col items-center" style={{ minWidth }}>
    <span className="text-[11px] text-slate-300/80 font-bold tracking-[0.2em] mb-1">{label}</span>
    <span className={`text-[2.4rem] font-black ${valueColor} tabular-nums leading-none`}
      style={{ textShadow: valueShadow }}>
      {value}
    </span>
    {progress && (
      <div className="w-full h-2 bg-slate-700/60 rounded-full overflow-hidden border border-slate-500/30 mt-2">
        <div className={`h-full rounded-full bg-gradient-to-r ${progress.gradient} transition-all duration-300`}
          style={{ width: `${progress.pct}%`, boxShadow: `0 0 12px ${progress.glow}` }} />
      </div>
    )}
    {dots && (
      <div className="flex gap-1.5 mt-2">
        {Array.from({ length: dots.count }).map((_, n) => {
          const on = n < dots.active;
          return (
            <div key={n} className="w-4 h-2 rounded-full transition-all duration-300"
              style={{
                background: on ? dots.color : '#334155',
                boxShadow: on ? `0 0 8px ${dots.glow}` : 'none',
              }}
            />
          );
        })}
      </div>
    )}
  </div>
);

// ─── 子组件：分隔线 ──────────────────────────────
const Divider: React.FC = () => (
  <div className="w-px self-stretch bg-gradient-to-b from-transparent via-emerald-500/30 to-transparent" />
);

// ─── 子组件：手部状态指示 ─────────────────────────
const HandStatus: React.FC<{
  label: string;
  detected: boolean;
  extra: string | null;
  tone: 'emerald' | 'amber';
  locked?: boolean;
}> = ({ label, detected, extra, tone, locked }) => {
  const dotColor = tone === 'emerald' ? 'bg-emerald-400' : 'bg-amber-400';
  const dotGlow  = tone === 'emerald' ? '#10b981' : '#f59e0b';
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/60 backdrop-blur-md rounded-full border border-slate-500/20">
        {locked ? (
          <Lock className="w-3.5 h-3.5 text-red-400" />
        ) : detected ? (
          <Unlock className="w-3.5 h-3.5 text-emerald-300" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-slate-600" />
        )}
        <span className="text-xs text-slate-200 font-bold tracking-[0.15em]">{label}</span>
        {detected && <div className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`} style={{ boxShadow: `0 0 6px ${dotGlow}` }} />}
      </div>
      {extra && (
        <div className="text-[10px] text-slate-400/80 tracking-widest pr-3">{extra}</div>
      )}
    </div>
  );
};

// ─── 子组件：图例行 ──────────────────────────────
const LegendRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2">
    <div className="w-1 h-1 rounded-full bg-emerald-400/60 mt-1.5 shrink-0" />
    <div>{children}</div>
  </div>
);

export default App;

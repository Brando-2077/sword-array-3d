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
  FormationState, InteractionData, FORMATION_META, SPEED_LEVELS,
  SCALE_MIN, SCALE_MAX,
} from './types';
import { Sword, Lock, Unlock, Zap, Crosshair, ChevronRight } from 'lucide-react';

const App: any = () => {
  // 调试/演示参数：?f=FIVE_FINGER&c=512&s=18 → 固定阵式/数量/大小，跳过手势识别（用于无摄像头验证）
  const debugParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const debugPin = debugParams.get('f') !== null;
  const initScale = Number(debugParams.get('s')) || 15;
  const initCount = Number(debugParams.get('c')) || 128;
  const initSpeed = 0.75;

  // 顶层 state：只存"会触发重渲染"的离散量
  const [interact, setInteract] = useState<any>({
    left:  { role: 'LEFT'  as any, detected: false, x: 0, y: 0, distance: 0, fingerCount: 0 },
    right: { role: 'RIGHT' as any, detected: false, x: 0, y: 0, distance: 0, fingerCount: 0 },
    cursorX: 0.5, cursorY: 0.5, cursorActive: false,
    formation: (FormationState as any)[debugParams.get('f') ?? ''] ?? FormationState.IDLE,
    swordScale: initScale, swordCount: initCount, animSpeed: initSpeed, locked: false,
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
  const count         = Math.round(smoothCount.current);
  const speed         = smoothSpeed.current;
  const formation     = interact.formation;
  const meta          = FORMATION_META[formation as FormationState];
  const scalePct      = ((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  const speedLevel    = Math.round(speed <= 0.35 ? 0 : speed <= 0.625 ? 1 : speed <= 0.875 ? 2 : speed <= 1.35 ? 3 : 4);
  const speedMeta     = SPEED_LEVELS[speedLevel];
  const leftDetected  = interact.left.detected;
  const rightDetected = interact.right.detected;
  const locked        = interact.locked;
  const cursorActive  = interact.cursorActive;

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
                  value={scale.toFixed(0)}
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
                  value={count.toString()}
                  valueColor="text-amber-300"
                  valueShadow="0 0 40px rgba(245,158,11,0.7)"
                  minWidth={120}
                  dots={{
                    count: 5,
                    active: leftDetected ? Math.min(5, Math.max(0, Math.round((interact.left.distance * 4)))) : 0,
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
                    count: 5,
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
                extra={leftDetected ? `${interact.left.fingerCount}指` : null}
                tone="emerald"
              />
              <HandStatus
                label="右手"
                detected={rightDetected}
                extra={rightDetected ? `${interact.right.fingerCount}指` : null}
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
            <LegendRow>右手 ✊千丝绞杀 ☝青元剑芒 ✌剑影分光</LegendRow>
            <LegendRow>右手 🤘青元剑盾 👍通天剑阵 👋大庚剑阵</LegendRow>
            <LegendRow>左手 ☝✌🤘👍👋 → 剑数 32/64/128/256/512</LegendRow>
            <LegendRow>左手 ✊ → 冻结参数；左手距离 → 剑速</LegendRow>
            <LegendRow>右手距离 → 剑体大小；右手位置 → 群剑追随</LegendRow>
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

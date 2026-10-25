/**
 * 大庚剑阵 · 灵动篇 — 类型定义
 * @version 2.0 重置版
 * @description
 *   明确字段语义，加 JSDoc 注释，定义七种阵式元数据。
 *   左右手分工（最终正确版，与实现一致）：
 *     左手 → 飞剑数量（按伸出指数量化）、剑光速度（按距离 5 档）
 *     右手 → 剑阵招式（按手形 6 种）、剑体大小（按距离 5~30 连续）、光标定位
 *   锁定功能：左手握拳触发，冻结数量/速度/大小三个参数
 */

import type { ReactNode } from 'react';

// ─── 手部角色 ───────────────────────────────────────
export enum HandRole {
  RIGHT = 'RIGHT',
  LEFT  = 'LEFT',
}

// ─── 阵式状态 ───────────────────────────────────────
/**
 * 剑阵阵式（右手手势驱动）
 *  - FIST         : 握拳 → 剑丸归元
 *  - ONE_FINGER   : 1 指 → 青元剑河
 *  - TWO_FINGER   : 2 指 → 巨剑术
 *  - THREE_FINGER : 3 指 → 剑影分光术
 *  - FOUR_FINGER  : 4 指 → 庚金盾幕
 *  - FIVE_FINGER  : 5 指 → 大庚剑阵
 *  - IDLE         : 无手势/无右手 → 剑意感知
 */
export enum FormationState {
  IDLE         = 'IDLE',
  FIST         = 'FIST',         // 剑丸归元
  ONE_FINGER   = 'ONE_FINGER',   // 青元剑河
  TWO_FINGER   = 'TWO_FINGER',   // 巨剑术
  THREE_FINGER = 'THREE_FINGER', // 剑影分光术
  FOUR_FINGER  = 'FOUR_FINGER',  // 庚金盾幕
  FIVE_FINGER  = 'FIVE_FINGER',  // 大庚剑阵
}

// ─── 单手状态 ───────────────────────────────────────
/**
 * 单手识别数据
 * @property role          角色（左/右）
 * @property detected      是否在本帧检测到手
 * @property x             掌心归一化 X（0~1，已镜像：0=屏幕左，1=屏幕右）
 * @property y             掌心归一化 Y（0~1，0=屏幕顶，1=屏幕底）
 * @property distance      距离档位 0~1（0=远，1=近，1=很远为校准失效）
 * @property fingerCount   伸出手指数 0~5
 */
export interface HandData {
  role: HandRole;
  detected: boolean;
  x: number;
  y: number;
  distance: number;
  fingerCount: number;
}

// ─── 顶层交互数据（HandTracker → App 传递） ─────────
/**
 * 手势识别的派生交互数据
 * @property left               左手状态
 * @property right              右手状态
 * @property cursorX            右手掌心 X（归一化，0~1，镜像后）
 * @property cursorY            右手掌心 Y（归一化，0~1）
 * @property cursorActive       右手是否激活
 * @property formation          当前阵式（右手手势决定）
 * @property swordScale         剑体大小（右手距离驱动，5~30）
 * @property swordCount         飞剑数量（左手指数量化，8/16/32/64/128）
 * @property animSpeed          动画速度（左手距离驱动，0.25/0.5/0.75/1.0/1.75）
 * @property locked             左手握拳 = 锁定数量/速度/大小三参数
 */
export interface InteractionData {
  left: HandData;
  right: HandData;
  cursorX: number;
  cursorY: number;
  cursorActive: boolean;
  formation: FormationState;
  swordScale: number;
  swordCount: number;
  animSpeed: number;
  locked: boolean;
}

// ─── 阵式元数据（UI 展示与映射） ─────────────────────
export interface FormationMeta {
  id: FormationState;
  /** 阵式中文名 */
  name: string;
  /** 触发手势（用于 UI 提示） */
  trigger: string;
  /** 一句话视觉描述（用于 tooltip/提示） */
  description: string;
  /** UI 主题色（Tailwind 文字色） */
  uiColor: string;
  /** 主题色十六进制（用于内联 style） */
  uiColorHex: string;
  /** Shader 阵式编号（uFormation uniform） */
  shaderId: number;
}

export const FORMATION_META: Record<FormationState, FormationMeta> = {
  [FormationState.IDLE]: {
    id: FormationState.IDLE,
    name: '剑意感知',
    trigger: '无手势',
    description: '飞剑自由穿梭于虚空，不随手动而散',
    uiColor: 'text-cyan-300',
    uiColorHex: '#67e8f9',
    shaderId: 0,
  },
  [FormationState.FIST]: {
    id: FormationState.FIST,
    name: '剑丸归元',
    trigger: '右手握拳',
    description: '群剑螺旋收敛，凝为旋转不休的剑丸',
    uiColor: 'text-emerald-200',
    uiColorHex: '#a7f3d0',
    shaderId: 7,
  },
  [FormationState.ONE_FINGER]: {
    id: FormationState.ONE_FINGER,
    name: '青元剑河',
    trigger: '右手 1 指',
    description: '群剑化龙，蜿蜒游弋，龙头追随手部',
    uiColor: 'text-emerald-300',
    uiColorHex: '#6ee7b7',
    shaderId: 1,
  },
  [FormationState.TWO_FINGER]: {
    id: FormationState.TWO_FINGER,
    name: '巨剑术',
    trigger: '右手 2 指',
    description: '万剑归一，凝聚为一柄缓缓摇曳的巨剑',
    uiColor: 'text-teal-300',
    uiColorHex: '#5eead4',
    shaderId: 2,
  },
  [FormationState.THREE_FINGER]: {
    id: FormationState.THREE_FINGER,
    name: '剑影分光术',
    trigger: '右手 3 指',
    description: '一实三虚四道剑光，扇形铺陈，虚实相生',
    uiColor: 'text-green-300',
    uiColorHex: '#86efac',
    shaderId: 3,
  },
  [FormationState.FOUR_FINGER]: {
    id: FormationState.FOUR_FINGER,
    name: '庚金盾幕',
    trigger: '右手 4 指',
    description: '三层同心剑盾，反向旋转化解万法',
    uiColor: 'text-lime-300',
    uiColorHex: '#bef264',
    shaderId: 4,
  },
  [FormationState.FIVE_FINGER]: {
    id: FormationState.FIVE_FINGER,
    name: '大庚剑阵',
    trigger: '右手 5 指（摊掌）',
    description: '万剑归宗：群剑结成放射剑球，缓缓自转',
    uiColor: 'text-amber-300',
    uiColorHex: '#fcd34d',
    shaderId: 5,
  },
};

// ─── 速度档位（右手距离 → 速度系数） ────────────────
export const SPEED_LEVELS: { label: string; value: number; color: string; hex: string }[] = [
  { label: '极缓', value: 0.25, color: 'text-slate-300',  hex: '#cbd5e1' },
  { label: '缓流', value: 0.50, color: 'text-blue-300',   hex: '#93c5fd' },
  { label: '中速', value: 0.75, color: 'text-emerald-300',hex: '#6ee7b7' },
  { label: '疾驰', value: 1.00, color: 'text-amber-300',  hex: '#fcd34d' },
  { label: '雷光', value: 1.75, color: 'text-red-300',    hex: '#fca5a5' },
];

// ─── 飞剑数量档位（左手伸出指 → 剑数，v3.0 提升至万剑规模） ──
export const SWORD_COUNT_BY_FINGER: Record<number, number> = {
  1: 32,
  2: 64,
  3: 128,
  4: 256,
  5: 512,
};

// ─── 剑体大小范围 ───────────────────────────────────
export const SCALE_MIN = 5;
export const SCALE_MAX = 30;

// ─── UI 子组件 Props 类型 ────────────────────────────
export interface TopBarProps {
  scale: number;
  count: number;
  speedLevel: number;
  formation: FormationState;
  leftDetected: boolean;
  rightDetected: boolean;
  locked: boolean;
}

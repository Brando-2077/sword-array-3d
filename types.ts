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
 * 剑阵阵式（右手手势驱动）—— v4.0 全部换用动漫中真实出现的韩立剑招
 *  - THOUSAND_SILK : 握拳 → 千丝绞杀（vs 阴罗宗四长老名场面：金丝织茧层层收紧）
 *  - SWORD_BEAM    : 1 指 → 青元剑芒（筑基期标志剑光，一线剑光流）
 *  - SWORD_SHADOW  : 2 指 → 剑影分光术（飞剑分影名场面，一实多虚）
 *  - SWORD_SHIELD  : 3 指 → 青元剑盾（青元剑诀护体剑盾神通）
 *  - TONGTIAN_ARRAY: 4 指 → 通天剑阵（仙界剑阵：紫金剑柱+剑雨+紫电）
 *  - DAGENG_ARRAY  : 5 指 → 大庚剑阵（元婴至高神通，万剑齐发放射剑球）
 *  - IDLE          : 无手势/无右手 → 御剑巡空（御剑飞行，剑群自由游弋）
 */
export enum FormationState {
  IDLE          = 'IDLE',
  THOUSAND_SILK = 'THOUSAND_SILK', // 千丝绞杀（握拳）
  SWORD_BEAM    = 'SWORD_BEAM',    // 青元剑芒（1 指）
  SWORD_SHADOW  = 'SWORD_SHADOW',  // 剑影分光术（2 指）
  SWORD_SHIELD  = 'SWORD_SHIELD',  // 青元剑盾（3 指）
  DAGENG_ARRAY  = 'DAGENG_ARRAY',  // 大庚剑阵（5 指）
  TONGTIAN_ARRAY = 'TONGTIAN_ARRAY', // 通天剑阵（4 指，仙界：剑柱+剑雨+紫电）
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
  /** 距离档位 0~1（0=远 FAR_CM，1=近 NEAR_CM；v4.2 起为绝对测距，无需标定） */
  distance: number;
  /** 离摄像头真实距离(cm)，绝对测距读数（调试/手感校准用） */
  distCm?: number;
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
 * @property swordCount         飞剑数量（左手指数量化，32~512）
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
    name: '御剑巡空',
    trigger: '无手势',
    description: '御剑飞行：飞剑自由巡弋于虚空，不随手动而散',
    uiColor: 'text-cyan-300',
    uiColorHex: '#67e8f9',
    shaderId: 0,
  },
  [FormationState.THOUSAND_SILK]: {
    id: FormationState.THOUSAND_SILK,
    name: '千丝绞杀',
    trigger: '右手 ✊ 握拳',
    description: '剑光分化千丝金线，织茧缠敌层层收紧（vs 阴罗宗四长老名场面）',
    uiColor: 'text-amber-300',
    uiColorHex: '#fcd34d',
    shaderId: 1,
  },
  [FormationState.SWORD_BEAM]: {
    id: FormationState.SWORD_BEAM,
    name: '青元剑芒',
    trigger: '右手 ☝ 食指',
    description: '筑基期标志剑光：群剑凝成一线剑芒，随手疾射',
    uiColor: 'text-emerald-300',
    uiColorHex: '#6ee7b7',
    shaderId: 2,
  },
  [FormationState.SWORD_SHADOW]: {
    id: FormationState.SWORD_SHADOW,
    name: '剑影分光术',
    trigger: '右手 ✌ 剪刀手',
    description: '一实多虚剑影扇面铺陈，虚实相生（飞剑分影名场面）',
    uiColor: 'text-teal-300',
    uiColorHex: '#5eead4',
    shaderId: 3,
  },
  [FormationState.SWORD_SHIELD]: {
    id: FormationState.SWORD_SHIELD,
    name: '青元剑盾',
    trigger: '右手 🤘 ROCK手',
    description: '青元剑诀护体神通：剑光成栅，结盾御敌',
    uiColor: 'text-emerald-200',
    uiColorHex: '#a7f3d0',
    shaderId: 4,
  },
  [FormationState.DAGENG_ARRAY]: {
    id: FormationState.DAGENG_ARRAY,
    name: '大庚剑阵',
    trigger: '右手 👋 摊掌',
    description: '元婴至高神通：万剑齐发结成放射剑球，金丝环绕缓缓自转',
    uiColor: 'text-amber-300',
    uiColorHex: '#fcd34d',
    shaderId: 6,
  },
  [FormationState.TONGTIAN_ARRAY]: {
    id: FormationState.TONGTIAN_ARRAY,
    name: '通天剑阵',
    trigger: '右手 👍 点赞手',
    description: '仙界剑阵：紫金仙纹剑柱通天彻地，万道剑雨落下，紫雷穿梭',
    uiColor: 'text-purple-300',
    uiColorHex: '#d8b4fe',
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

// ─── 飞剑数量档位（左手手势 → 剑数；忠于原著序列，360 封顶保特效质量） ──
// 12 = 青竹蜂云剑成套 ｜ 36 = 大庚剑阵半套 ｜ 72 = 大庚完全体（齐淬庚精）
// 144 = 剑影分光（二倍分化）｜ 360 = 万剑剑丝（视觉上限内的分化之极）
export const SWORD_COUNT_BY_FINGER: Record<number, number> = {
  1: 12,
  2: 36,
  3: 72,
  4: 144,
  5: 360,
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

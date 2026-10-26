# 大庚剑阵 · 灵动篇 (Sword Array 3D)

<div align="center">

**凡人修仙传 · 韩立 · 大庚剑阵 | 手势操控 3D 飞剑模拟器**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-7.1.0-emerald)](CHANGELOG.md)
[![Built with](https://img.shields.io/badge/Built%20with-React%2019-%2361DAFB?logo=react)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-0.160-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-6.2-%23646CFF?logo=vite)](https://vitejs.dev)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-blue)](https://ai.google.dev/edge/mediapipe)
[![GitHub stars](https://img.shields.io/github/stars/Brando-2077/sword-array-3d?style=social)](https://github.com/Brando-2077/sword-array-3d)

</div>

---

## 概述

**大庚剑阵 · 灵动篇** 是一款基于手势识别的沉浸式 3D 飞剑操控体验。通过摄像头捕捉双手动作，实时操控 9~72 把青竹蜂云剑在虚空中结成剑阵，还原《凡人修仙传》中韩立驱使大庚剑阵的体验。

完整版本演进（v1.0 → v7.1）见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 🆕 当前版本（v7.1）要点

- 🖐 **谷歌官方 GestureRecognizer 手势识别**（模型本地化 + CDN 兜底）：右手一个手势换一个剑招，七式见下表
- 🔢 **自研几何手指计数**（左手）：伸直度比值法 + 每指独立阈值（真实手部数据标定）+ 滞回 + 时序投票，稳定不抖动
- ⚔️ **七式特效**：v7.1 基础拉伸系统整体重写，逐式重新编排
- 🎚 **参数档位**：数量 9/12/24/36/72 · 速度 4 档 · 剑体 10 档（距离量程锚定标定）
- 🛠 **调试三件套**：`?f=DAGENG_ARRAY&c=72&s=18` 无摄像头演示、D 键 HUD 监测面板、控制台 `window.__DAGENG` / `window.__FINGERLOG`

---

## 手势操控

> 完整规范见 [CHANGELOG §2](./CHANGELOG.md)。以下为速查表。

| 手 | 手势 | 控制参数 |
|---|------|----------|
| **左手** | 1 指 | 飞剑数量：**9** |
| 左手 | 2 指 | 飞剑数量：**12** |
| 左手 | 3 指 | 飞剑数量：**24** |
| 左手 | 4 指 | 飞剑数量：**36**（大庚半套） |
| 左手 | 5 指 | 飞剑数量：**72**（大庚完全体·齐淬庚精） |
| 左手 | 握拳（双手在场时） | **锁定** 数量/速度/大小三个参数 |
| 左手 | 手部距离 | **剑光速度** 4 档：极缓/缓流/中速/疾驰 |
| **右手** | ✊ 握拳 | 剑阵：**千丝绞杀** |
| 右手 | ☝ 食指 | 剑阵：**青元剑芒** |
| 右手 | ✌ 剪刀手 | 剑阵：**剑影分光术** |
| 右手 | 🤘 | 剑阵：**青元剑盾** |
| 右手 | 👍 点赞 | 剑阵：**通天剑阵** |
| 右手 | 👋 摊掌 | 剑阵：**大庚剑阵** |
| 右手 | 手部距离 | **剑体大小** 10 档量化调节（5~30） |
| 右手 | 手部位置 | **光标定位**（群剑追随） |

---

## 七种剑阵一览

| 阵式 | 触发 | 视觉 |
|------|------|------|
| 御剑巡空 | 无手势 | 御剑飞行，飞剑自由巡弋于虚空 |
| 千丝绞杀 | ✊ 握拳 | 剑光分化千丝金线，织茧缠敌层层收紧（vs 阴罗宗四长老名场面） |
| 青元剑芒 | ☝ 食指 | 群剑凝成一线剑芒，随手疾射（筑基期标志剑光） |
| 剑影分光术 | ✌ 剪刀手 | 一实多虚剑影扇面铺陈，虚实相生（飞剑分影名场面） |
| 青元剑盾 | 🤘 | 剑光成栅，结盾御敌（青元剑诀护体神通） |
| 通天剑阵 | 👍 点赞 | 紫金仙纹剑柱通天彻地，万道剑雨落下，紫雷穿梭（仙界剑阵） |
| 大庚剑阵 | 👋 摊掌 | 万剑齐发结成放射剑球，金丝环绕缓缓自转（元婴至高神通） |

---

## 视觉效果

### 3D 渲染（v5 质感复辟 + v7.1 特效重写）
- **真 3D 汉剑形制剑模**：汉剑形制青竹蜂云剑（ExtrudeGeometry 竹刃 + 翼形护手 + 竹柄）
- **程序化青竹蜂云剑材质**：竹节环纹、金色雷电弧（三频噪声）、菲涅尔描金、剑尖脉动、速度辉光
- **v7.1 基础拉伸系统**：高速运动时剑身液态拉伸成流光，七式动效逐式编排
- **Boids 群体智能**御剑巡空 + 龙形链式跟随 + 非线性 PD（变刚度弹簧 + 速度自适应摩擦）
- **能量拖尾粒子**（每剑 3 粒，生命渐隐漂移，按阵式换色）
- **UnrealBloomPass**：呼吸脉动，强度随剑数自适应防过曝

---

## UI 界面

```
┌────────────────────────────────────────────────────────────┐
│  [🗡️ 大庚剑阵]  │  剑体大小 │ 飞剑数量 │ 剑光速度  │ 锁/解锁 │ [剑阵名称] │
│   赛博修炼      │   15    │   72   │  中速   │ ● ○     │  大庚剑阵   │
├────────────────────────────────────────────────────────────┤
│ ┌─[手势心法]┐                          ┌─[当前阵式]┐         │
│ │ 左手 1~5指│     [3D 剑阵场景]         │ 大庚剑阵  │         │
│ │ 左手握拳锁│                          │ 万剑齐发  │         │
│ │ 右手 6 招式│         ┌─[摄像头 LIVE]┐ └────────┘         │
│ │ 右手位置定│         │ 21点手骨绑定 │                      │
│ └──────────┘         └─────────────┘  ┌─[待主领阵]─┐     │
│                                        │  ◎ 旋转中  │     │
│                                        └────────────┘     │
└────────────────────────────────────────────────────────────┘
```

- **顶部栏**：标题 + 三大参数（数字+进度条+档位灯）+ 手部状态 + 阵名（发光大字）
- **左下图例**：新手友好的操作说明
- **右上小卡**：当前阵式 + 一句话描述 + 监测 FPS/锁定状态
- **右下摄像头**：LIVE 画面 + 21 点手骨绑定可视化
- **底部中央**：双圈旋转 + "待主领阵"（无手势时显示）
- **HUD 监测面板**：D 键呼出，实时查看识别链路数据

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 5.8（strict 模式） |
| 3D 渲染 | Three.js 0.160 + InstancedMesh（72 剑容量） |
| 后处理 | EffectComposer + UnrealBloomPass |
| Shader | 自定义 GLSL 顶点/片元着色器 |
| 手势识别 | MediaPipe tasks-vision GestureRecognizer（官方预训练模型，本地优先 + CDN 兜底）+ 自研几何手指计数 |
| 构建 | Vite 6.2 + Tailwind CSS 4.3 |
| 图标 | Lucide React 0.562 |

---

## 🚀 快速开始

### 本地运行

#### 前置条件
- **Node.js** ≥ 18
- **摄像头**（用于手势识别）
- **现代浏览器**（Chrome / Edge / Firefox）

#### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/Brando-2077/sword-array-3d.git
cd sword-array-3d

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev
```

浏览器访问 `http://localhost:3000/`，首次打开会请求摄像头权限，允许后即可用手势操控。

#### 生产构建

```bash
npm run build      # 输出到 dist/
npm run preview    # 本地预览构建产物
npm run typecheck  # TypeScript 类型检查
```

`dist/` 目录可部署到任意静态托管服务（Vercel / Netlify / GitHub Pages / CloudStudio）。

### 📱 支持的设备
- ✅ 带摄像头的台式机/笔记本
- ✅ 平板电脑（支持摄像头）
- ⚠️ 手机（摄像头支持有限，建议使用 PC）

---

## 项目结构

```
sword-array-3d/
├── index.html              # 入口 HTML
├── index.tsx              # React 入口
├── index.css              # Tailwind + 全局样式 + 关键帧
├── App.tsx                # 主应用：布局 + 状态管理 + UI
├── types.ts               # TypeScript 类型 + 阵式元数据
├── vite.config.ts         # Vite 配置
├── tsconfig.json          # TypeScript 配置（strict）
├── package.json           # 依赖管理
├── README.md              # 本文件
├── CHANGELOG.md           # 更新日志
├── components/
│   ├── HandTracker.tsx   # 手势识别（GestureRecognizer + 自研手指计数）
│   └── SwordArray3D.tsx  # 3D 场景核心（Three.js + GLSL）
├── public/
│   ├── mediapipe-wasm/   # MediaPipe WASM（本地化）
│   └── models/           # gesture_recognizer 模型（本地化）
├── screenshots/           # 版本截图
└── archive/v1.0/          # v1.0 完整备份
```

---

## 💡 常见问题 (FAQ)

<details>
<summary><b>Q: 摄像头无法开启？</b></summary>

A: 请检查：
1. 浏览器是否支持 HTTPS 或 localhost（MediaPipe 需要安全上下文）
2. 是否已授予摄像头权限
3. 是否有其他应用占用摄像头
</details>

<details>
<summary><b>Q: 手势识别不准确？</b></summary>

A: 建议：
1. 确保光线充足
2. 手部距离摄像头 30-60cm
3. 避免复杂背景
4. 手势做出后稍作停留（约 0.2 秒）
</details>

<details>
<summary><b>Q: 画面卡顿？</b></summary>

A: 尝试：
1. 减少飞剑数量（左手手指收回一些）
2. 关闭其他占用 GPU 的应用
3. 使用性能更好的浏览器（Chrome/Edge）
4. 降低浏览器缩放比例
</details>

<details>
<summary><b>Q: 左右手搞反了？</b></summary>

A: 左手控**数量/速度/锁定**，右手控**招式/大小/位置**。手势心法图例显示在屏幕左下角。
</details>

---

## 🤝 贡献

欢迎贡献！请阅读 [CHANGELOG.md](./CHANGELOG.md) 了解最近的变更。

### 贡献者
- [@Brando-2077](https://github.com/Brando-2077)（HanGu） - 初始开发 + v2.0 重置

---

## License

MIT - 详见 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

- [Three.js](https://threejs.org/) - 强大的 3D 渲染引擎
- [MediaPipe](https://ai.google.dev/edge/mediapipe) - 实时手势识别
- [React](https://react.dev/) - UI 框架
- [Vite](https://vitejs.dev/) - 极速构建工具
- [Tailwind CSS](https://tailwindcss.com/) - 样式框架

---

⚡ **道友，开始你的剑阵之旅吧！** 🙏

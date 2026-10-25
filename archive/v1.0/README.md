# 大庚剑阵 · 灵动篇 (Sword Array 3D)

<div align="center">

**凡人修仙传 · 韩立 · 大庚剑阵 | 手势操控 3D 飞剑模拟器**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Built with](https://img.shields.io/badge/Built%20with-React%2019-%2361DAFB?logo=react)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-0.160-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-6.2-%23646CFF?logo=vite)](https://vitejs.dev)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-blue)](https://ai.google.dev/edge/mediapipe)
[![GitHub stars](https://img.shields.io/github/stars/HanGu007/sword-array-3d?style=social)](https://github.com/HanGu007/sword-array-3d)

</div>

---

## 概述

**大庚剑阵 · 灵动篇** 是一款基于手势识别的沉浸式 3D 飞剑操控体验。通过摄像头捕捉双手动作，实时操控 8~200 把青竹蜂云剑在虚空中结成剑阵，完美还原《凡人修仙传》中韩立驱使大庚剑阵的体验。

---

## 截图预览

<div align="center">

| 剑阵效果 | 剑阵效果 |
|----------|----------|
| ![青元剑河](./screenshots/02-sword-river.png) | ![三才螺旋](./screenshots/03-spiral.png) |
| ![庚金巨浪](./screenshots/04-formation.png) | ![庚金盾幕](./screenshots/06-wave.png) |
| ![万剑随心](./screenshots/07-dragon-swarm.png) | ![剑丸归元](./screenshots/08-shield.png) |

| UI 界面 |
|---------|
| ![主界面概览](./screenshots/01-overview.png) |

</div>

---

## 手势操控

| 手 | 手势 | 控制参数 |
|---|------|----------|
| **右手** | 1 指 | 剑阵：**青元剑河**（点刺汇聚） |
| 右手 | 2 指 | 剑阵：**龙吟双流**（双龙并行） |
| 右手 | 3 指 | 剑阵：**三才螺旋**（三重螺旋） |
| 右手 | 4 指 | 剑阵：**庚金巨浪**（扇面冲击） |
| 右手 | 5 指 | 剑阵：**万剑随心**（群龙乱舞） |
| 右手 | 全掌展开 | 剑阵：**庚金盾幕**（圆盘防御） |
| 右手 | 握拳 | 剑阵：**剑丸归元**（护体绕行） |
| 右手 | 手部距离 | **剑光速度**（5 档：极缓→雷光） |
| 右手 | 手部位置 | **光标定位**（群剑追随） |
| **左手** | 1~5 指 | **飞剑数量**（8 / 16 / 32 / 64 / 128） |
| 左手 | 手部距离 | **剑体大小**（5~30 连续调节） |
| 左手 | 握拳 | **锁定**参数（冻结当前数值） |

无手势时，剑阵自动进入 **待主领阵** 状态，飞剑以群体行为算法（Boids Flocking）自由巡游。

---

## 视觉效果

### 3D 渲染
- **青竹蜂云剑**：自定义 GLSL 着色器，模拟竹节青玉剑身、金色雷弧纹理
- **竹节特效**：剑身每 3.5 单位一个竹节节点，节点处泛起金色环光
- **金雷闪电**：剑刃两侧生成动态金色电弧，随飞剑速度增强
- **菲涅尔辉光**：金色边缘光，配合 UnrealBloomPass 后处理产生辉光溢出
- **星域背景**：2000 粒子星空，含翡翠/金色星点，缓慢旋转
- **能量尾迹**：每把飞剑 3 个拖尾粒子，淡入淡出消散

### 物理模拟
- **PD 控制器**：飞剑以弹簧-阻尼系统追随目标，带预测补偿
- **龙形摆尾**：飞剑链沿运动方向形成正弦波浪，越靠尾端摆动幅度越大
- **Boids 集群**：空闲时 5 个分群各自执行分离/对齐/聚合行为
- **速度自适应摩擦**：飞剑越快阻尼越大，防止过冲振荡

---

## UI 界面

```
┌──────────────────────────────────────────────────────────────┐
│  🗡️ 大庚剑阵     │ 剑体大小 │ 飞剑数量 │ 剑光速度 │ 左手/右手 │ ▲ │
│   赛博修炼        │  20     │  72     │  中速   │ ● 待主领阵 │ ✕ │
│                   │ ████░░░ │ ●●●●○  │ ●●●○○  │            │   │
└──────────────────────────────────────────────────────────────┘
│                                                              │
│                    [3D 剑阵场景]                                │
│                                                              │
│         ┌──────────────┐                                     │
│         │ 摄像头预览    │                                     │
│         │ (右手画面)    │                                     │
│         └──────────────┘                                     │
│                          ◎ 待主领阵                             │
└──────────────────────────────────────────────────────────────┘
```

- **顶部栏**：标题 + 三大实时参数表（剑体大小/飞剑数量/剑光速度，均带进度条和指示灯）+ 左右手状态 + 当前剑阵名称（发光大字）
- **右下角**：半透明摄像头预览框（镜像、灰度、对比度增强），显示 MediaPipe 手势识别画面
- **底部中央**：旋转等待圈 + "待主领阵" 文字（无手势时显示）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 3D 渲染 | Three.js 0.160 + InstancedMesh（200 实例） |
| 后处理 | EffectComposer + UnrealBloomPass |
| Shader | 自定义 GLSL 顶点/片元着色器 |
| 手势识别 | MediaPipe Hands（CDN 加载，无需后端） |
| 构建 | Vite 6 + Tailwind CSS 4 |
| 图标 | Lucide React |

---

## 🚀 快速开始

### 在线体验

<!-- 如果有部署好的在线版本，取消注释下一行 -->
<!-- [![Open in CloudStudio](https://cloudstudio.net/button/open-in-cs/8.svg)](https://你的部署地址) -->

### 本地运行

#### 前置条件

- **Node.js** ≥ 18
- **摄像头**（用于手势识别）

#### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/HanGu007/sword-array-3d.git
cd sword-array-3d

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev
```

浏览器访问 `http://localhost:3000/`，首次打开会请求摄像头权限，允许后即可用手势操控。

#### 生产构建

```bash
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建产物
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
├── App.tsx                    # 主应用：布局 + 状态管理
├── index.tsx                  # 入口
├── index.html                 # HTML 模板（加载 MediaPipe CDN）
├── index.css                  # Tailwind + 自定义样式
├── types.ts                   # TypeScript 类型定义
├── metadata.json              # 项目元数据
├── vite.config.ts             # Vite 配置
├── tsconfig.json              # TypeScript 配置
├── components/
│   ├── SwordArray3D.tsx       # 3D 场景核心（Three.js InstancedMesh + GLSL Shader）
│   ├── HandTracker.tsx        # MediaPipe 手势识别 + 自适应距离标定
│   └── SwordArray.tsx         # (已废弃)
└── dist/                      # 构建输出目录
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
2. 手部距离摄像头 20-50cm
3. 避免复杂背景
4. 手势做出后稍作停留（约 0.5 秒）

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
<summary><b>Q: 如何部署到线上？</b></summary>

A: 构建后部署 `dist/` 目录到任意静态托管服务：
- [Vercel](https://vercel.com/) - 推荐，一键部署
- [Netlify](https://www.netlify.com/)
- [GitHub Pages](https://pages.github.com/)
- [CloudStudio](https://cloudstudio.net/)

</details>

---

## 🤝 贡献

欢迎贡献！请阅读 [贡献指南](CONTRIBUTING.md) 了解详情。

### 贡献者

<!-- 如果你贡献了代码，欢迎添加你的名字和链接 -->
- [@HanGu](https://github.com/HanGu007) - 初始开发

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

## 📚 相关资源

- 项目主页：[https://github.com/HanGu007/sword-array-3d](https://github.com/HanGu007/sword-array-3d)
- 问题反馈：[GitHub Issues](https://github.com/HanGu007/sword-array-3d/issues)
- 功能讨论：[GitHub Discussions](https://github.com/HanGu007/sword-array-3d/discussions)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)

---

## 💬 社区

欢迎加入讨论，分享你的剑阵创意！

如有问题，请在 [GitHub Discussions](https://github.com/HanGu007/sword-array-3d/discussions) 提问。

---

⚡ **道友，开始你的剑阵之旅吧！** 🙏

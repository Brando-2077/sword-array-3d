# 大庚剑阵 · 灵动篇 (Sword Array 3D)

<div align="center">

**凡人修仙传 · 韩立 · 大庚剑阵 | 手势操控 3D 飞剑模拟器**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-7.0.0-emerald)](CHANGELOG.md)
[![Built with](https://img.shields.io/badge/Built%20with-React%2019-%2361DAFB?logo=react)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-0.160-black?logo=three.js)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-6.2-%23646CFF?logo=vite)](https://vitejs.dev)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Hands-blue)](https://ai.google.dev/edge/mediapipe)
[![GitHub stars](https://img.shields.io/github/stars/Brando-2077/sword-array-3d?style=social)](https://github.com/Brando-2077/sword-array-3d)

</div>

---

## 概述

**大庚剑阵 · 灵动篇** 是一款基于手势识别的沉浸式 3D 飞剑操控体验。通过摄像头捕捉双手动作，实时操控 32~512 把青竹蜂云剑在虚空中结成剑阵，完美还原《凡人修仙传》中韩立驱使大庚剑阵的体验。

**v2.0 重置** 解决了 v1.0 的卡顿、追踪失灵、控制不准三大问题；**v3.0 视觉重制** 将渲染层彻底重写为「辉光剑影 billboard」，剑数拉到 512、新增拖尾流光与深蓝紫星穹背景，七种阵式全部重做。

---

## 🆕 v3.0 新特性（视觉重制）

- ⚔️ **辉光剑影 billboard**：程序化剑形 + 辉光，512 把满量仍满帧
- 🌊 **拖尾流光**：高速运动时剑身拉伸成流光
- 🌌 **深蓝紫星穹背景**：渐变星穹 + 双辉光 + 暗角，替代纯黑
- 🔢 **数量档位提升**：32 / 64 / 128 / 256 / 512
- 🛠 **调试参数**：`?f=FIVE_FINGER&c=512` 无摄像头演示/验证

详见 [CHANGELOG.md](./CHANGELOG.md)

---

## 手势操控

> 完整规范见 [CHANGELOG §2](./CHANGELOG.md)。以下为速查表。

| 手 | 手势 | 控制参数 |
|---|------|----------|
| **左手** | 1 指 | 飞剑数量：**32** |
| 左手 | 2 指 | 飞剑数量：**64** |
| 左手 | 3 指 | 飞剑数量：**128** |
| 左手 | 4 指 | 飞剑数量：**256** |
| 左手 | 5 指 | 飞剑数量：**512** |
| 左手 | 握拳 | **锁定** 三个参数（数量/速度/大小） |
| 左手 | 手部距离 | **剑光速度** 5 档：极缓/缓流/中速/疾驰/雷光 |
| **右手** | 0~1 指（握拳） | 剑阵：**剑丸归元** |
| 右手 | 2 指 | 剑阵：**青元剑河** |
| 右手 | 3 指 | 剑阵：**巨剑术** |
| 右手 | 4 指 | 剑阵：**剑影分光术** |
| 右手 | 5 指（摊掌） | 剑阵：**大庚剑阵** |
| 右手 | 手部距离 | **剑体大小** 5~30 连续调节 |
| 右手 | 手部位置 | **光标定位**（群剑追随） |

> ⚠️ **注意**：阵名以文档 §2.2 为准，2 指/3 指/4 指/5 指分别对应 青元剑河/巨剑术/剑影分光术/大庚剑阵。

---

## 七种剑阵一览

| 阵式 | 触发 | 视觉 |
|------|------|------|
| 剑意感知 | 无手势 | 飞剑自由穿梭虚空 |
| 剑丸归元 | 右手握拳 | 螺旋收敛为海胆状剑丸 |
| 青元剑河 | 右手 2 指 | 群剑化龙，蜿蜒游弋，龙头追手 |
| 巨剑术 | 右手 3 指 | 双龙螺旋缠绕 |
| 剑影分光术 | 右手 4 指 | 一实三虚四道剑光，扇形平铺 |
| 庚金盾幕 | 右手 4 指 | 三层同心反向旋转剑盾 |
| 大庚剑阵 | 右手 5 指摊掌 | 法阵+千丝绞杀光网+嫩芽花瓣 |

> 详细视觉规范见 [七种阵式一览](#七种剑阵一览)

---

## 视觉效果

### 3D 渲染（v3.0 辉光剑影）
- **程序化剑形**：片元着色器 SDF 绘制剑身/金护手/剑柄 + 高斯辉光
- **拖尾流光**：速度拉伸，高速时剑身化流光
- **屏幕空间朝向**：刃向随阵式切换（径向/切向/流向/固定轴）
- **深蓝紫星穹**：渐变天空 shader + 星野粒子 + 暗角
- **PD 控制器**：弹簧-阻尼系统，飞剑追随目标
- **UnrealBloomPass**：强度随剑数自适应，防止过曝

---

## UI 界面

```
┌────────────────────────────────────────────────────────────┐
│  [🗡️ 大庚剑阵]  │  剑体大小 │ 飞剑数量 │ 剑光速度  │ 锁/解锁 │ [剑阵名称] │
│   赛博修炼      │    15    │   32   │  中速   │ ● ○     │   青元剑河   │
├────────────────────────────────────────────────────────────┤
│ ┌─[手势心法]┐                          ┌─[当前阵式]┐         │
│ │ 左手 1~5指│     [3D 剑阵场景]         │ 青元剑河  │         │
│ │ 左手握拳锁│                          │ 群剑化龙  │         │
│ │ 右手 0~5指│         ┌─[摄像头 320]┐   └────────┘         │
│ │ 右手位置定│         │             │                      │
│ └──────────┘         └─────────────┘   ┌─[待主领阵]─┐     │
│                                        │  ◎ 旋转中  │     │
│                                        └────────────┘     │
└────────────────────────────────────────────────────────────┘
```

- **顶部栏**：标题 + 三大参数（数字+进度条+灯）+ 手部状态 + 阵名（发光大字）
- **左下图例**：新手友好的六行操作说明
- **右上小卡**：当前阵式 + 一句话描述
- **右下摄像头**：320×240，镜像灰度，带 LIVE 标签
- **底部中央**：双圈旋转 + "待主领阵"（无手势时显示）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 5.8（strict 模式） |
| 3D 渲染 | Three.js 0.160 + InstancedMesh（200 实例） |
| 后处理 | EffectComposer + UnrealBloomPass |
| Shader | 自定义 GLSL 顶点/片元着色器 |
| 手势识别 | MediaPipe Hands 0.4（CDN 加载，无需后端） |
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
├── index.html              # 入口 HTML（加载 MediaPipe CDN）
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
│   ├── HandTracker.tsx   # MediaPipe 手势识别 + 鲁棒距离标定
│   └── SwordArray3D.tsx  # 3D 场景核心（Three.js + GLSL）
├── archive/
│   └── v1.0/             # v1.0 完整备份
└── dist/                  # 构建输出
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

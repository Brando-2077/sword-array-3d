# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [Unreleased]

### Removed
- 移除 Gemini AI 对话系统（韩立传音符）
- 删除 CultivationChat 组件和 geminiService 服务
- 删除聊天相关截图 (05-chat-ui.png)
- 删除废弃的 SwordArray.tsx 组件

### Changed
- 更新 README.md，移除所有 Gemini 相关说明和 Badge
- 更新 CONTRIBUTING.md，移除 API Key 配置说明
- 清理 vite.config.ts，移除 GEMINI_API_KEY 环境变量定义
- 优化项目结构，只保留核心功能模块

### Added
- 项目初始化
- 基础 3D 飞剑渲染（Three.js InstancedMesh）
- MediaPipe 手势识别集成
- 7 种剑阵形态（剑丸归元、青元剑河、龙吟双流、三才螺旋、庚金巨浪、万剑随心、庚金盾幕）
- 自定义 GLSL Shader（青竹蜂云剑特效）
- Boids 集群算法（空闲时飞剑自由巡游）
- PD 控制器物理系统
- 能量尾迹粒子效果
- 星域背景

## [1.0.0] - 2026-06-21

### Added
- 首次发布
- 基础手势识别功能
- 双手独立控制（左手控制数量/大小，右手控制形态/速度）
- 实时参数显示 UI
- 摄像头预览
- 剑阵形态说明

### Technical
- React 19 + TypeScript
- Three.js 0.160 + InstancedMesh
- MediaPipe Hands（CDN 加载）
- Vite 6 构建
- Tailwind CSS 4
- EffectComposer + UnrealBloomPass 后处理

---

## [Template]

### Added
- 新功能

### Changed
- 功能变更

### Deprecated
- 即将废弃的功能

### Removed
- 已移除的功能

### Fixed
- Bug 修复

### Security
- 安全问题修复

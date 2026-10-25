# Contributing to 大庚剑阵 · 灵动篇

感谢您对「大庚剑阵 · 灵动篇」项目的关注！我们欢迎任何形式的贡献。

## 🌟 如何贡献

### 报告 Bug

- 使用 [GitHub Issues](https://github.com/HanGu007/sword-array-3d/issues) 提交 Bug 报告
- 请详细描述：
  - 问题描述
  - 复现步骤
  - 预期行为 vs 实际行为
  - 环境信息（浏览器、操作系统、设备）
  - 相关截图或录屏

### 提出新功能

- 在 [GitHub Issues](https://github.com/HanGu007/sword-array-3d/issues) 中提出功能建议
- 描述清楚功能的用途和价值
- 可以附上设计草图或参考示例

### 提交代码

1. **Fork 仓库**
   ```bash
   # 在 GitHub 上 Fork 后
   git clone https://github.com/你的用户名/sword-array-3d.git
   cd sword-array-3d
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/你的功能名
   # 或
   git checkout -b fix/你要修复的问题
   ```

3. **开发和测试**
   ```bash
   npm install
   npm run dev
   # 进行开发和测试
   ```

4. **提交代码**
   ```bash
   git add .
   git commit -m "feat: 添加某某功能"
   # 或
   git commit -m "fix: 修复某某问题"
   ```

5. **推送到 Fork**
   ```bash
   git push origin feature/你的功能名
   ```

6. **创建 Pull Request**
   - 到 GitHub 上创建 PR
   - 填写清晰的 PR 描述
   - 关联相关的 Issue（如果有）

## 📝 代码规范

### Commit Message 规范

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型：**
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链相关

**示例：**
```
feat(sword): 添加新剑阵形态「九宫剑阵」

- 实现九宫站位算法
- 添加对应的手势识别
- 更新 UI 显示

Closes #123
```

### 代码风格

- 使用 TypeScript 进行类型标注
- 组件使用 React.FC 类型
- Three.js 相关代码添加必要注释
- GLSL Shader 代码保持格式清晰

### 测试

提交前请确保：
- 本地运行 `npm run dev` 无报错
- 新功能在 Chrome/Edge 最新版测试通过
- 手势识别功能正常
- 如有条件，在不同设备上测试摄像头兼容性

## 🎨 设计原则

### 视觉风格

- 保持「仙侠」美学风格
- 青竹+金色为主色调
- 特效适度，避免过度花哨
- 保持 60fps 性能底线

### 交互设计

- 手势操控优先，键盘鼠标为辅
- UI 简洁，不遮挡 3D 场景
- 提供清晰的操作反馈

## 🔒 安全注意

- 提交前检查 `.gitignore` 是否完整

## 📚 文档更新

- 新功能请同步更新 README.md
- 新增手势控制请更新「手势操控」表格
- 技术栈变更请更新「技术栈」部分
- 截图请放在 `screenshots/` 目录

## 🏷️ Issue 和 PR 标签

- `bug`: Bug 报告
- `enhancement`: 新功能建议
- `documentation`: 文档相关
- `good first issue`: 适合新手
- `help wanted`: 需要帮助
- `question`: 疑问讨论

## 💬 交流社区

- 有问题可以在 [GitHub Discussions](https://github.com/HanGu007/sword-array-3d/discussions) 提问
- 欢迎分享你的剑阵创意！

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

再次感谢您的贡献！🙏

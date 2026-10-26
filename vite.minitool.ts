import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 小工具版构建配置：
// - 经典脚本（iife，非 ES module）——容器 CSP 禁止 type="module"
// - ES2017 目标（Chrome 61 WebView 基线）
// - base './' 相对路径（zip 离线加载）
// - publicDir 指向 minitool/public/（模型 .js 数据模块拷贝到产物根）
// - minitool/index.html 里的 <script type="module" src="./main.tsx"> 触发 Vite 处理
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: path.resolve(__dirname, 'minitool/public'),
  build: {
    outDir: 'dist-minitool',
    target: 'es2017',
    rollupOptions: {
      input: path.resolve(__dirname, 'minitool/index.html'),
      output: {
        format: 'iife',
        entryFileNames: 'main.js',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

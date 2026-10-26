/**
 * minitool/main.tsx — 小工具版入口
 * 使用 HandTrackerTF（TF.js WebGL 推理）替代 MediaPipe tasks-vision
 * 其余全部复用主 App 组件
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import HandTrackerTF from '../components/HandTrackerTF';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App Tracker={HandTrackerTF} />
  </React.StrictMode>
);

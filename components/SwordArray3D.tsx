/**
 * SwordArray3D — 3D 剑阵渲染核心
 * @version 5.0 质感复辟：v1.0 渲染灵魂全面回归
 * @description
 *   v3.0 曾把真 3D 剑换成辉光贴片换取 512 剑数量，视觉浓度断崖下降；
 *   v5.0 把 v1.0 的全部视觉资产移植回当前引擎，两者兼得：
 *
 *   自 v1.0 回归：
 *   - 真 3D 剑模型（ExtrudeGeometry 竹刃翼形护手）+ 程序化青竹蜂云剑材质
 *     （竹节环纹、金色雷电弧、菲涅尔描金、剑尖脉动、速度辉光、高速拉伸）
 *   - 能量拖尾粒子（每剑 3 粒，生命渐隐漂移，按阵式换色）
 *   - Boids 群体智能 IDLE（5 簇分离/对齐/聚合 + 边界力 + 自适应摩擦）
 *   - 龙形链式跟随 + 速度预测（青元剑芒即龙脊一线）
 *   - 非线性 PD 弹簧 + 有机正弦摆动 + 速度自适应摩擦
 *   - Bloom 1.15 呼吸脉动（v3.0 曾砍到 0.62）
 *
 *   保留 v4.x：
 *   - 512 剑容量、七式动漫真实招式、调试参数、星穹背景
 *   - 零分配纪律（Quaternion/Matrix 全复用，Boids 用对象池）
 *   - 剑刃真实 3D 朝向：沿速度 / 径向 / 竖直（比屏幕空间角度更立体）
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FormationState, SCALE_MIN } from '../types';

// ─── Props ────────────────────────────────────────
interface SwordArray3DProps {
  formation: FormationState;
  cursorX: number;       // 0~1，已镜像
  cursorY: number;       // 0~1
  cursorActive: boolean;
  swordScale: number;    // 5~30（v1.0 语义：直接作实例缩放）
  swordCount: number;    // 32~512
  animSpeed: number;     // 0.25~1.75
}

// ─── 常量 ─────────────────────────────────────────
const MAX_SWORDS   = 3600;      // 万剑剑丝（原著剑影分光之极）
const BOIDS_MAX    = 512;       // Boids 群体智能上限（O(n²)，超限转参数化游弋）
const WORLD_W      = 2800;
const WORLD_H      = 2000;
const BLOOM_BASE   = 0.52;      // 亮度再降：低泛光保剑身可读
const BLOOM_PULSE  = 0.10;
const STAR_COUNT   = 1600;
const TAU          = Math.PI * 2;
const GOLDEN       = 2.39996323;

// PD 物理调参（v1.0 原味）
const PD_KP        = 0.28;
const PD_KD        = 0.60;
const PD_MAX_FORCE = 260;
const PD_VEL_MAX   = 320;
const VEL_MIN      = 18;
const BASE_FRICTION = 0.955;

// ─── 剑色方案（A 暗基 → B 亮色；金雷弧始终保留金） ──
const FORMATION_COLORS: Record<FormationState, number[]> = {
  [FormationState.IDLE]:           [0.02, 0.24, 0.11,  0.26, 0.95, 0.45],
  [FormationState.THOUSAND_SILK]:  [0.30, 0.21, 0.04,  0.95, 0.80, 0.30],
  [FormationState.SWORD_BEAM]:     [0.03, 0.36, 0.16,  0.36, 1.00, 0.58],
  [FormationState.SWORD_SHADOW]:   [0.02, 0.30, 0.15,  0.30, 0.90, 0.55],
  [FormationState.SWORD_SHIELD]:   [0.02, 0.28, 0.16,  0.30, 0.92, 0.62],
  [FormationState.TONGTIAN_ARRAY]: [0.12, 0.06, 0.26,  0.68, 0.55, 1.00],
  [FormationState.DAGENG_ARRAY]:   [0.11, 0.24, 0.07,  0.82, 0.92, 0.42],
};

// ─── 青竹蜂云剑 Shader（v1.0 材质 + 阵式色参数化 + 虚实/种子实例属性） ──
const swordVertexShader = /* glsl */ `
  attribute vec3  instanceVelocity;
  attribute float aAlpha;   // 虚实（剑影分光术的影 = 低透明度）
  attribute float aSeed;    // 每剑种子（雷弧相位/微差异）

  varying float vVel;
  varying vec2  vUv;
  varying float vFresnel;
  varying float vHeight;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    float speed = length(instanceVelocity);
    vVel = speed;
    vUv = uv;
    vHeight = position.y;
    vAlpha = aAlpha;
    vSeed = aSeed;

    vec3 pos = position;
    // 高速拉伸（v1.0 液态流动感）——只拉伸刃段，护手/柄不变形
    if (pos.y > 0.9) pos.y += clamp(speed * 0.40, 0.0, 12.0);

    vec4 instancePosition = instanceMatrix * vec4(pos, 1.0);
    vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
    vec3 viewDir = normalize(cameraPosition - instancePosition.xyz);
    vFresnel = pow(1.0 - abs(dot(worldNormal, viewDir)), 2.5);

    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
  }
`;

const swordFragmentShader = /* glsl */ `
  varying float vVel;
  varying vec2  vUv;
  varying float vFresnel;
  varying float vHeight;
  varying float vAlpha;
  varying float vSeed;

  uniform float uTime;
  uniform vec3  uColA;   // 阵式暗基色
  uniform vec3  uColB;   // 阵式亮色
  uniform float uFlash;  // 切阵白闪

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // 色板：青竹蜂云剑——绿金相间（竹节分段交替染金/玉绿），整体压暗
    vec3 jadeCore  = uColA;
    vec3 jadeMid   = mix(uColA, uColB, 0.65) * 0.88;
    vec3 jadeGlow  = uColB * 0.82;
    vec3 goldAccent = vec3(1.0, 0.72, 0.15);
    vec3 goldEdge  = vec3(1.0, 0.85, 0.25);

    bool isBlade = vHeight > 0.9;
    bool isTip   = vHeight > 22.5;
    bool isGuard = vHeight <= 0.9 && vHeight > -0.95;
    bool isPommel = vHeight <= -5.75;

    vec3 baseColor;
    float alpha = vAlpha;

    if (isBlade) {
      // ── 竹节分段：绿金相间（偶数段玉绿、奇数段染金）+ 节环金线 ──
      float segPos = (vHeight - 0.9) / 4.2;
      float segIdx = floor(segPos);
      float nodeFrac = fract(segPos);
      float goldSeg = step(0.5, mod(segIdx, 2.0));
      float nodeGlow = smoothstep(0.0, 0.06, nodeFrac) * smoothstep(0.14, 0.08, nodeFrac);
      nodeGlow = 1.0 - nodeGlow;
      float ring = smoothstep(0.0, 0.015, nodeFrac) * smoothstep(0.03, 0.015, nodeFrac);

      float heightGrad = smoothstep(0.9, 23.0, vHeight);
      baseColor = mix(jadeCore, jadeMid, heightGrad * 0.7);
      baseColor = mix(baseColor, jadeGlow, ring * 0.30);
      // 相间染色：金段明确染金，玉段保持饱和翠绿
      baseColor = mix(baseColor, goldAccent * 1.15, goldSeg * 0.72);
      baseColor = mix(baseColor, goldAccent * 0.8, ring * 0.35);

      float lateral = abs(vUv.x - 0.5) * 2.0;
      baseColor = mix(baseColor, jadeCore * 0.6, smoothstep(0.3, 0.85, lateral) * 0.4);
      baseColor = mix(baseColor, jadeGlow, smoothstep(21.0, 25.0, vHeight) * 0.45);

      // ── 中脊线（汉剑血槽：中央微亮脊 + 两侧暗槽）+ 玉白刃缘（弱） ──
      float ridge = 1.0 - smoothstep(0.0, 0.14, abs(vUv.x - 0.5));
      baseColor += jadeGlow * ridge * 0.22;
      baseColor *= 1.0 - (smoothstep(0.10, 0.22, abs(vUv.x - 0.5)) - smoothstep(0.22, 0.30, abs(vUv.x - 0.5))) * 0.18;
      baseColor = mix(baseColor, vec3(0.55, 0.92, 0.70), smoothstep(0.68, 0.94, lateral) * 0.12);

      // ── 金色雷电弧（三频噪声，只出现在剑缘与竹节） ──
      float lx = vUv.x * 8.0 + vSeed * 13.0;
      float ly = vHeight * 0.6 + uTime * 2.0;
      float n1 = noise(vec2(lx + uTime * 3.0, ly));
      float n2 = noise(vec2(lx * 2.3 - uTime * 2.0, ly * 1.5));
      float n3 = noise(vec2(lx * 4.1 + uTime * 1.5, ly * 0.8 - uTime));
      float edgeMask = smoothstep(0.3, 0.7, lateral) * (1.0 - smoothstep(0.85, 1.0, lateral));
      float lightning = pow(n1 * n2 * n3, 1.5);
      lightning = smoothstep(0.65, 0.78, lightning) * edgeMask * (0.4 + nodeGlow * 0.6);
      baseColor = mix(baseColor, goldAccent * 2.5, lightning * 0.8);
      baseColor += goldAccent * lightning * 0.4;

      // 剑身能量脉动
      float pulse = sin(uTime * 8.0 + vHeight * 0.4 + vSeed * 6.28) * 0.5 + 0.5;
      baseColor += jadeGlow * pulse * edgeMask * 0.15;
    } else if (isGuard) {
      // ── 剑格：小圆盘，金边玉心（参考图 1 的金环盘） ──
      baseColor = mix(goldAccent * 1.7, jadeMid, smoothstep(0.2, 0.8, abs(vUv.x - 0.5) * 2.0) * 0.5);
      baseColor *= 0.9 + 0.1 * sin(uTime * 4.0 + vSeed * 6.28);
    } else if (isPommel) {
      // ── 剑首：金帽 ──
      baseColor = goldEdge * 1.4;
    } else {
      // ── 剑柄：深玉缠绳（斜纹） ──
      baseColor = mix(jadeCore * 0.55, jadeMid * 0.8, smoothstep(-6.3, -0.9, vHeight) * 0.4);
      float wrapPattern = abs(sin(vHeight * 4.2 + vUv.x * 18.0));
      baseColor = mix(baseColor, goldAccent * 1.1, wrapPattern * 0.35);
    }

    // ── 菲涅尔描金 + 速度辉光 ──
    vec3 rim = goldEdge * 1.9 * vFresnel;
    float speedGlow = clamp(vVel, 0.0, 50.0) / 50.0;
    rim += goldAccent * speedGlow * 0.35;
    vec3 finalColor = baseColor + rim;

    if (isTip) finalColor += goldAccent * (1.0 + sin(uTime * 15.0 + vSeed * 6.28) * 0.5) * 0.4;
    finalColor += vec3(1.0) * uFlash * 0.35; // 切阵白闪

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ─── 星穹背景（v3.0 保留） ─────────────────────────
const bgVertexShader = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.99999, 1.0);
  }
`;
const bgFragmentShader = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vec2 p = vNdc;
    vec3 top = vec3(0.004, 0.006, 0.022);
    vec3 mid = vec3(0.014, 0.018, 0.055);
    vec3 bot = vec3(0.028, 0.042, 0.105);
    vec3 col = mix(bot, mid, smoothstep(-1.0, 0.05, p.y));
    col = mix(col, top, smoothstep(0.05, 1.0, p.y));
    float d1 = length((p - vec2(0.0, -1.2)) * vec2(1.0, 0.55));
    col += vec3(0.05, 0.34, 0.20) * exp(-d1 * 2.3) * 0.35;
    float d2 = length((p - vec2(0.78, 0.62)) * vec2(0.85, 1.0));
    col += vec3(0.20, 0.10, 0.36) * exp(-d2 * 1.8) * 0.30;
    col += (fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
    col *= 1.0 - 0.38 * dot(p * 0.68, p * 0.68);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── 星空（v3.0 保留） ─────────────────────────────
function createStarfield(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 6000 + Math.random() * 8000;
    positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    positions[i * 3 + 2] = Math.cos(phi) * r - 2000;
    const c = Math.random();
    if (c < 0.16)      { colors[i*3]=0.25; colors[i*3+1]=0.95; colors[i*3+2]=0.55; }
    else if (c < 0.28) { colors[i*3]=1.0;  colors[i*3+1]=0.85; colors[i*3+2]=0.45; }
    else               { colors[i*3]=0.75; colors[i*3+1]=0.80; colors[i*3+2]=0.88; }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.2, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.65,
  });
  return new THREE.Points(geom, mat);
}

// ─── 能量拖尾粒子（v1.0 回归，按阵式换色） ──────────
function createTrailParticles(maxSwords: number): {
  points: THREE.Points;
  setColor: (r: number, g: number, b: number) => void;
  update: (swordPositions: Float32Array, count: number, dt: number) => void;
} {
  const trailCount = maxSwords * 3;
  const positions = new Float32Array(trailCount * 3);
  const colors    = new Float32Array(trailCount * 3);
  const life      = new Float32Array(trailCount);
  const attached  = new Int16Array(trailCount);
  let baseR = 0.3, baseG = 1.0, baseB = 0.5;

  for (let i = 0; i < trailCount; i++) {
    positions[i*3+1] = -10000;
    life[i] = 0;
    attached[i] = i % maxSwords;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 6.5, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let elapsed = 0;
  const spawnInterval = 0.03;

  const update = (swordPositions: Float32Array, count: number, dt: number) => {
    elapsed += dt;
    for (let i = 0; i < trailCount; i++) {
      const s = attached[i];
      if (s >= count) { life[i] = 0; positions[i*3+1] = -10000; continue; }
      life[i] -= dt * 3.0;
      if (life[i] <= 0 && elapsed > spawnInterval) {
        positions[i*3]   = swordPositions[s*3];
        positions[i*3+1] = swordPositions[s*3+1];
        positions[i*3+2] = swordPositions[s*3+2];
        life[i] = 0.4 + Math.random() * 0.6;
        elapsed = 0;
      } else if (life[i] > 0) {
        positions[i*3]   += (Math.random() - 0.5) * 4;
        positions[i*3+1] += (Math.random() - 0.5) * 4;
        positions[i*3+2] += (Math.random() - 0.5) * 2;
        const t = life[i];
        colors[i*3] = baseR * t; colors[i*3+1] = baseG * t; colors[i*3+2] = baseB * t;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };

  return {
    points,
    setColor: (r, g, b) => { baseR = r; baseG = g; baseB = b; },
    update,
  };
}

// ─── 青竹蜂云剑几何（按动画参考图重制：汉剑形制） ──
// 细长直刃（带中脊）+ 小圆盘剑格 + 长柄 + 圆形剑首；动画原图比例 刃:柄 ≈ 3.5:1
function createSwordGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  // 剑首（圆帽，y -7.2 ~ -6.35）
  s.moveTo(-0.30, -7.2);
  s.quadraticCurveTo(-0.52, -6.85, -0.44, -6.35);
  // 柄（y -6.35 ~ -0.85，微收）
  s.lineTo(-0.34, -5.7);
  s.lineTo(-0.30, -0.85);
  // 剑格（小圆盘侧影：左右探出的圆弧透镜）
  s.lineTo(-0.95, -0.55);
  s.quadraticCurveTo(-1.15, 0.15, -0.92, 0.8);
  s.lineTo(-0.42, 0.95);
  // 刃（y 0.95 ~ 25.4，直刃缓收，末段收锋）
  s.lineTo(-0.46, 22.0);
  s.quadraticCurveTo(-0.38, 24.4, -0.01, 25.4);
  s.lineTo(0.01, 25.4);
  s.quadraticCurveTo(0.38, 24.4, 0.46, 22.0);
  s.lineTo(0.46, 0.95);
  // 右侧镜像
  s.lineTo(0.92, 0.8);
  s.quadraticCurveTo(1.15, 0.15, 0.95, -0.55);
  s.lineTo(0.30, -0.85);
  s.lineTo(0.34, -5.7);
  s.lineTo(0.44, -6.35);
  s.quadraticCurveTo(0.52, -6.85, 0.30, -7.2);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2,
  }).scale(1.6, 1, 1.3); // x 加宽保剑面可读，z 加厚出剑脊体积
}

// ─── 工具 ─────────────────────────────────────────
const fibDir = (i: number, count: number, out: THREE.Vector3) => {
  const y = 1 - (2 * (i + 0.5)) / count;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN;
  out.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
  return out;
};
const fract = (x: number) => x - Math.floor(x);

// ─── 主组件 ───────────────────────────────────────
const SwordArray3D: React.FC<SwordArray3DProps> = ({
  formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // props → ref 实时同步（避免闭包陷阱）
  const propsRef = useRef({ formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed });
  useEffect(() => {
    propsRef.current = { formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed };
  }, [formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed]);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width  = container.clientWidth;
    const height = container.clientHeight;

    // ── Scene / Camera / Renderer ──
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 1, 20000);
    camera.position.set(0, 0, 2600);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_BASE, 0.45, 0.78);
    composer.addPass(bloomPass);

    // ── 星穹背景 + 星空 ──
    const bgGeom = new THREE.BufferGeometry();
    bgGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    const bgMat = new THREE.ShaderMaterial({
      vertexShader: bgVertexShader, fragmentShader: bgFragmentShader,
      depthTest: false, depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = -10;
    scene.add(bgMesh);
    const starfield = createStarfield(STAR_COUNT);
    scene.add(starfield);

    // ── 剑阵 InstancedMesh（真 3D 剑） ──
    const geom = createSwordGeometry();
    const material = new THREE.ShaderMaterial({
      vertexShader: swordVertexShader,
      fragmentShader: swordFragmentShader,
      uniforms: {
        uTime:  { value: 0 },
        uColA:  { value: new THREE.Color(0.05, 0.30, 0.15) },
        uColB:  { value: new THREE.Color(0.30, 1.00, 0.50) },
        uFlash: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const swordMesh = new THREE.InstancedMesh(geom, material, MAX_SWORDS);
    swordMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    swordMesh.frustumCulled = false;

    // 实例属性：速度（拉伸/辉光）、虚实（分光影）、种子（雷弧相位）
    const velArr   = new Float32Array(MAX_SWORDS * 3);
    const alphaArr = new Float32Array(MAX_SWORDS).fill(1);
    const seedArr  = new Float32Array(MAX_SWORDS);
    for (let i = 0; i < MAX_SWORDS; i++) seedArr[i] = fract(i * 0.618033987);
    const attrVel   = new THREE.InstancedBufferAttribute(velArr, 3).setUsage(THREE.DynamicDrawUsage);
    const attrAlpha = new THREE.InstancedBufferAttribute(alphaArr, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('instanceVelocity', attrVel);
    geom.setAttribute('aAlpha', attrAlpha);
    geom.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedArr, 1));
    scene.add(swordMesh);

    // ── 拖尾粒子 ──
    const trailSystem = createTrailParticles(MAX_SWORDS);
    scene.add(trailSystem.points);

    // ── 粒子状态（pos/vel/acc + 常驻朝向四元数） ──
    interface P { pos: THREE.Vector3; vel: THREE.Vector3; acc: THREE.Vector3; offset: number; quat: THREE.Quaternion }
    const particles: P[] = new Array(MAX_SWORDS);
    for (let i = 0; i < MAX_SWORDS; i++) {
      particles[i] = {
        pos: new THREE.Vector3((Math.random() - 0.5) * 4000, (Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 1600 - 400),
        vel: new THREE.Vector3(),
        acc: new THREE.Vector3(),
        offset: (i / MAX_SWORDS) * TAU,
        quat: new THREE.Quaternion(),
      };
    }

    // ── 零分配复用对象 ──
    const matrix = new THREE.Matrix4();
    const scaleV = new THREE.Vector3();
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), t4 = new THREE.Vector3();
    const fibTmp = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const swordPosBuf = new Float32Array(MAX_SWORDS * 3);

    // Boids 对象池（v1.0）
    const boidVecs: THREE.Vector3[] = [];
    const boidGet = () => { const v = boidVecs.pop() || new THREE.Vector3(); v.set(0, 0, 0); return v; };
    const boidPut = (v: THREE.Vector3) => { if (boidVecs.length < 64) boidVecs.push(v); };

    // ── 渲染循环 ──
    let time = 0, formationTime = 0;
    let prevFormation: FormationState | null = null;
    let smoothCx = 0, smoothCy = 0, prevCx = 0, prevCy = 0;
    let cursorVx = 0, cursorVy = 0;
    let prevCount = 0;
    let rafId = 0, running = true;

    const loop = () => {
      if (!running) return;
      const p = propsRef.current;
      const liveFormation = p.formation;
      const liveCount = Math.max(1, Math.min(MAX_SWORDS, Math.floor(p.swordCount)));
      const dt = 0.016 * p.animSpeed;
      time += dt;

      // ── 阵式切换：换色 + 白闪 + 拖尾换色 ──
      if (liveFormation !== prevFormation) {
        formationTime = 0;
        prevFormation = liveFormation;
        const c = FORMATION_COLORS[liveFormation];
        (material.uniforms.uColA.value as THREE.Color).setRGB(c[0], c[1], c[2]);
        (material.uniforms.uColB.value as THREE.Color).setRGB(c[3], c[4], c[5]);
        trailSystem.setColor(c[3] * 0.7, c[4] * 0.85, c[5] * 0.6);
      }
      formationTime += dt;
      material.uniforms.uTime.value  = time;
      material.uniforms.uFlash.value = Math.max(0, 1 - formationTime * 1.6);

      // ── Bloom 呼吸脉动（v1.0 浓度回归，仅轻微随剑数回落防洗白） ──
      bloomPass.strength = BLOOM_BASE * (1.0 + Math.sin(time * 2.0) * BLOOM_PULSE) * (1.0 - 0.18 * (liveCount / MAX_SWORDS));

      starfield.rotation.y += dt * 0.02;
      starfield.rotation.x += dt * 0.005;

      // ── 光标（0~1 → 世界坐标，EMA + 速度） ──
      const rawCx = (p.cursorX - 0.5) * WORLD_W;
      const rawCy = -(p.cursorY - 0.5) * WORLD_H;
      const ka = p.cursorActive ? 0.28 : 0.05;
      smoothCx += (rawCx - smoothCx) * ka;
      smoothCy += (rawCy - smoothCy) * ka;
      cursorVx = (smoothCx - prevCx) * 60; cursorVy = (smoothCy - prevCy) * 60;
      prevCx = smoothCx; prevCy = smoothCy;
      const cSpeed = Math.hypot(cursorVx, cursorVy) + 0.01;
      const dirX = cursorVx / cSpeed, dirY = cursorVy / cSpeed;
      if (cSpeed < 2.5) { /* 静止：保持上一方向 */ }

      const cx = smoothCx, cy = smoothCy, cz = -120;
      const zPush = (p.swordScale - SCALE_MIN) * 6; // 透视推近（v3.0 减弱版）

      // ── 逐剑：目标位置 + 物理 + 朝向 ──
      for (let i = 0; i < MAX_SWORDS; i++) {
        const pt = particles[i];
        const seed = seedArr[i];
        const sc = p.swordScale; // 阵式间距随剑体自适应：任何大小下构图都不散架

        if (i >= liveCount) {
          // 场外收纳（v1.0：缩到极小而非移除，避免重建）
          matrix.makeScale(0.001, 0.001, 0.001);
          swordMesh.setMatrixAt(i, matrix);
          attrVel.setXYZ(i, 0, 0, 0);
          swordPosBuf[i*3+1] = -10000;
          continue;
        }

        const ratio = i / liveCount;
        // 数量增加：新剑从远方游入
        if (i >= prevCount) {
          pt.pos.set((Math.random() - 0.5) * 4200, (Math.random() - 0.5) * 3200, (Math.random() - 0.5) * 1800 - 400);
          pt.vel.set(0, 0, 0);
        }

        let targetAlpha = 1.0;
        let orientMode: 'velocity' | 'radial' | 'vertical' = 'velocity';

        switch (liveFormation) {
          // ── 御剑巡空：Boids 群体智能（v1.0 五簇三力） ──
          case FormationState.IDLE: {
            if (liveCount > BOIDS_MAX) {
              // 大群模式：Boids O(n²) 不可行，转参数化星域游弋（走 PD 物理）
              const R = 620 + Math.sqrt(liveCount) * 26;
              const a = time * (0.20 + seed * 0.35) + seed * TAU + pt.offset;
              const r = R * (0.30 + 0.70 * fract(seed * 7.31));
              t1.set(
                cx + Math.cos(a) * r,
                cy + Math.sin(a * 0.9 + seed * 5.0) * r * 0.7,
                cz + Math.sin(a * 0.7 + seed * 3.0) * 300,
              );
              break;
            }
            const NUM_CLUSTERS = 5;
            const k = p.swordScale / 15; // 集群域随剑体缩放：剑大簇大，重叠才不爆
            const per = Math.ceil(liveCount / NUM_CLUSTERS);
            const cIdx = Math.floor(i / per);
            const cAng = time * 0.22 + cIdx * Math.PI * 1.3;
            const cRadX = (350 + p.swordScale * 18) + Math.sin(time * 0.35 + cIdx * 0.7) * 240 * k;
            const cRadY = (220 + p.swordScale * 11) + Math.cos(time * 0.4 + cIdx * 1.1) * 150 * k;
            const cZ = Math.cos(time * 0.25 + cIdx * 1.5) * (150 + p.swordScale * 10) - 300;
            const center = boidGet().set(Math.cos(cAng) * cRadX, Math.sin(cAng) * cRadY, cZ);
            // 个人轨道偏移：每剑在簇心周围分配固定壳层位置，结构性防扎堆
            const spread = (110 + p.swordScale * 8) * (0.35 + 0.65 * fract(seed * 2.3));
            fibDir(i % Math.max(1, per), Math.max(1, per), fibTmp);
            center.x += fibTmp.x * spread; center.y += fibTmp.y * spread; center.z += fibTmp.z * spread * 0.7;

            const sep = boidGet(), ali = boidGet(), coh = boidGet();
            let nSep = 0, nAli = 0, nCoh = 0;
            const s0 = cIdx * per, e0 = Math.min(s0 + per, liveCount);
            const sepR = 160 * Math.max(1, k * 0.8), aliR = 350 * k, cohR = 650 * k;
            for (let j = s0; j < e0; j++) {
              if (j === i) continue;
              const o = particles[j];
              const dx = pt.pos.x - o.pos.x, dy = pt.pos.y - o.pos.y, dz = pt.pos.z - o.pos.z;
              const d = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.001;
              if (d < sepR) { const w = 1/(d*d); sep.x += dx*w*800; sep.y += dy*w*800; sep.z += dz*w*800; nSep++; }
              if (d < aliR) { ali.x += o.vel.x; ali.y += o.vel.y; ali.z += o.vel.z; nAli++; }
              if (d < cohR) { coh.x += o.pos.x; coh.y += o.pos.y; coh.z += o.pos.z; nCoh++; }
            }
            const force = boidGet();
            if (nSep > 0) force.add(sep.multiplyScalar(1.8));
            if (nAli > 0) { ali.divideScalar(nAli); force.add(t1.copy(ali).sub(pt.vel).multiplyScalar(0.9)); }
            if (nCoh > 0) { coh.divideScalar(nCoh); force.add(t1.copy(coh).sub(pt.pos).multiplyScalar(0.03)); }
            const toC = t1.copy(center).sub(pt.pos);
            force.add(t2.copy(toC).normalize().multiplyScalar(Math.min(toC.length() * 0.035, 95)));
            const bx = 1050, by = 720, bz = 560; // 固定画面边界：剑心不出取景框
            if (Math.abs(pt.pos.x) > bx) force.x -= Math.sign(pt.pos.x) * 90;
            if (Math.abs(pt.pos.y) > by) force.y -= Math.sign(pt.pos.y) * 90;
            if (Math.abs(pt.pos.z) > bz) force.z -= Math.sign(pt.pos.z) * 60;
            if (force.lengthSq() > 8100) force.normalize().multiplyScalar(90);
            pt.acc.copy(force);
            boidPut(sep); boidPut(ali); boidPut(coh); boidPut(force); boidPut(center);

            pt.vel.addScaledVector(pt.acc, 0.016 * p.animSpeed);
            const spd = pt.vel.length();
            if (spd > 110) pt.vel.multiplyScalar(110 / spd);
            else if (spd < VEL_MIN && spd > 0.01) pt.vel.multiplyScalar(VEL_MIN / spd);
            pt.vel.multiplyScalar(0.978);
            pt.pos.add(pt.vel);
            break;
          }

          // ── 千丝绞杀：金丝织茧，高速缠绕层层收紧 ──
          case FormationState.THOUSAND_SILK: {
            const tighten = 1.0 + 1.8 * Math.exp(-formationTime * 2.2);
            const squeeze = 1.0 + 0.10 * Math.sin(formationTime * 4.0);
            const R = (170 + sc * 9 + 90 * fract(seed * 3.7)) * tighten * squeeze;
            const spins = time * 2.6 + seed * TAU;
            const band = Math.floor(ratio * 5);
            t1.set(
              cx + Math.cos(spins + band * 1.3) * R * (1 + band * 0.22),
              cy + Math.sin(spins * 1.3 + band * 0.9) * R * 0.85 * (1 + band * 0.18),
              cz + Math.sin(spins * 0.7 + seed * 6.0) * R * 0.9,
            );
            break;
          }

          // ── 青元剑芒：龙脊一线（v1.0 龙形链式跟随 + 速度预测） ──
          case FormationState.SWORD_BEAM: {
            const t2r = (i + 0.5) / liveCount;
            const L = 560 + sc * 22 + liveCount * 1.2;
            const perpX = -dirY, perpY = dirX;
            const wob = Math.sin(t2r * 20.0 - time * 9.0 + seed * 3.0);
            const width = (5 + sc * 0.7) * Math.sin(t2r * Math.PI) * (0.4 + fract(seed * 5.1) * 0.6);
            t1.set(
              cx - dirX * t2r * L + perpX * wob * width,
              cy - dirY * t2r * L + perpY * wob * width,
              cz + Math.sin(t2r * 24.0 - time * 6.0 + seed * 6.0) * 26,
            );
            break;
          }

          // ── 剑影分光术：一实四虚五道剑影 ──
          case FormationState.SWORD_SHADOW: {
            const lane = i % 5;
            const baseAngle = Math.PI / 2 + (lane - 2) * 0.30;
            const flow = fract(seed + time * 0.34 * (lane === 2 ? 1.0 : 0.72));
            const r = 130 + flow * (480 + sc * 26);
            const spread = (fract(seed * 3.3) - 0.5) * (50 + flow * 100);
            const pa = baseAngle + Math.PI / 2;
            t1.set(
              cx + Math.cos(baseAngle) * r + Math.cos(pa) * spread,
              cy + Math.sin(baseAngle) * r + Math.sin(pa) * spread,
              cz + (lane === 2 ? 110 : (lane - 2) * 85) + Math.sin(flow * 9.0 + lane) * 40,
            );
            targetAlpha = lane === 2 ? 1.0 : 0.32;
            break;
          }

          // ── 青元剑盾：剑光成栅 ──
          case FormationState.SWORD_SHIELD: {
            const gap = 26 + sc * 4.6; // 栅距随剑体走：剑大栅疏，剑小栅密
            const cols = Math.max(3, Math.ceil(Math.sqrt(liveCount * 1.7)));
            const row = Math.floor(i / cols), col = i % cols;
            const rows = Math.ceil(liveCount / cols);
            t1.set(
              cx + (col - (cols - 1) / 2) * gap + Math.sin(time * 2.2 + row * 0.6) * 4,
              cy + ((rows - 1) / 2 - row) * gap + Math.sin(time * 2.0 + col * 0.5) * 8,
              cz + 90 + Math.sin(row * 0.8 + col * 0.4) * 24,
            );
            orientMode = 'vertical';
            break;
          }

          // ── 通天剑阵：紫金剑柱 + 剑雨 + 紫雷 ──
          case FormationState.TONGTIAN_ARRAY: {
            const pillarX = (pp: number) => cx + (pp - 2) * (150 + sc * 13);
            if (ratio < 0.62) {
              const pp = Math.floor((ratio / 0.62) * 5);
              t1.set(
                pillarX(pp) + Math.sin(time * 3.0 + seed * 40.0) * 6,
                cy - 700 + fract(seed * 9.7) * 1400 + Math.sin(time * 4.0 + seed * 20.0) * 5,
                cz + 120 + (fract(seed * 6.7) - 0.5) * 60,
              );
              orientMode = 'vertical';
            } else if (ratio < 0.90) {
              const pp = Math.floor(((ratio - 0.62) / 0.28) * 5);
              const fall = fract(seed * 5.3 + time * (0.35 + fract(seed * 2.1) * 0.3));
              t1.set(
                pillarX(pp) + Math.sin(time * 2.0 + seed * 30.0) * 12,
                cy + 800 - fall * 1600,
                cz + 120 + (fract(seed * 8.1) - 0.5) * 50,
              );
            } else {
              const pp = Math.floor(fract(seed * 4.3) * 5);
              const bt = Math.floor(time * 8.0) + Math.floor(seed * 97.0);
              t1.set(
                pillarX(pp) + (fract(bt * 0.123 + seed * 7.0) - 0.5) * 80,
                cy + (fract(bt * 0.317 + seed * 3.0) - 0.5) * 1500,
                cz + 180,
              );
            }
            break;
          }

          // ── 大庚剑阵：万剑齐发放射剑球（真剑比例：半径按剑长放大） ──
          case FormationState.DAGENG_ARRAY: {
            const converge = 1.0 + 1.6 * Math.exp(-formationTime * 2.6);
            const R = (520 + sc * 16 + 60 * Math.sin(formationTime * 1.8)) * converge;
            fibDir(i, liveCount, fibTmp);
            const swirl = time * 0.35 + seed * 0.15;
            const cs = Math.cos(swirl), sn = Math.sin(swirl);
            const fx = fibTmp.x * cs - fibTmp.z * sn;
            const fz = fibTmp.x * sn + fibTmp.z * cs;
            const shell = 0.82 + 0.33 * fract(seed * 2.7);
            const breathe = 1.0 + Math.sin(time * 2.2 + seed * 20.0) * 0.035;
            t1.set(
              cx + fx * R * shell * breathe,
              cy + fibTmp.y * R * shell * breathe,
              cz + fz * R * shell * breathe,
            );
            orientMode = 'radial';
            break;
          }

          default:
            t1.set(cx, cy, cz);
        }

        // ── 非_boids 物理：非线性 PD + 速度预测 + 有机摆动（v1.0） ──
        // （IDLE 小群走 Boids 自积分；IDLE 大群参数化目标也要 PD 跟随）
        if (liveFormation !== FormationState.IDLE || liveCount > BOIDS_MAX) {
          t1.z += zPush;
          const frontRatio = ratio;
          const predict = Math.max(0, 0.5 - frontRatio * 0.5) * 0.15;
          t2.set(t1.x + cursorVx * predict, t1.y + cursorVy * predict, t1.z);

          t3.copy(t2).sub(pt.pos);
          const dist = t3.length();
          const spring = Math.min(dist * dist * 0.001 + dist * PD_KP * p.animSpeed, PD_MAX_FORCE);
          t3.normalize().multiplyScalar(spring);
          t4.copy(pt.vel).multiplyScalar(PD_KD);
          t3.sub(t4);
          // 有机正弦摆动（游动感）
          const waveAmp = 8.0 + (1 - frontRatio) * 12.0;
          const waveF = time * 5.0 + pt.offset * 2.5;
          t3.x += Math.sin(waveF) * waveAmp * 0.3;
          t3.y += Math.cos(waveF * 0.7) * waveAmp * 0.3;
          t3.z += Math.sin(waveF * 0.5 + 1.0) * waveAmp * 0.2;

          pt.vel.addScaledVector(t3, 0.016 * p.animSpeed);
          const spd = pt.vel.length();
          const fr = Math.max(BASE_FRICTION - spd * 0.00008, 0.88);
          pt.vel.multiplyScalar(fr);
          if (spd > PD_VEL_MAX) pt.vel.multiplyScalar(PD_VEL_MAX / spd);
          else if (spd < VEL_MIN && spd > 0.01) pt.vel.multiplyScalar(VEL_MIN / spd);
          pt.pos.add(pt.vel);
        }

        // ── 剑刃朝向（真实 3D 四元数） ──
        const spd2 = pt.vel.length();
        if (orientMode === 'vertical') {
          pt.quat.setFromAxisAngle(UP, Math.sin(time * 0.8) * 0.06);
        } else if (orientMode === 'radial') {
          t2.copy(pt.pos).sub(t3.set(cx, cy, cz)).normalize();
          if (t2.lengthSq() < 0.5) t2.set(0, 1, 0);
          pt.quat.setFromUnitVectors(UP, t2);
        } else if (spd2 > 2) {
          t2.copy(pt.vel).normalize();
          pt.quat.setFromUnitVectors(UP, t2);
        } // 低速 velocity 模式：保持上一朝向

        scaleV.setScalar(p.swordScale);
        matrix.compose(pt.pos, pt.quat, scaleV);
        swordMesh.setMatrixAt(i, matrix);
        attrVel.setXYZ(i, pt.vel.x, pt.vel.y, pt.vel.z);

        // 虚实透明度平滑过渡
        // 密度亮度补偿：加法混合下剑越多/越大叠加越白——单剑亮度按数量与
        // 剑体大小双重衰减，保证集群中心也能看清剑身轮廓
        targetAlpha *= Math.max(0.26, Math.min(1, 40 / liveCount)) * Math.max(0.55, Math.min(1, 15 / p.swordScale));
        alphaArr[i] += (targetAlpha - alphaArr[i]) * 0.1;

        swordPosBuf[i*3] = pt.pos.x; swordPosBuf[i*3+1] = pt.pos.y; swordPosBuf[i*3+2] = pt.pos.z;
      }

      prevCount = liveCount;
      swordMesh.instanceMatrix.needsUpdate = true;
      attrVel.needsUpdate = true;
      attrAlpha.needsUpdate = true;

      trailSystem.update(swordPosBuf, liveCount, dt);
      composer.render();
      rafId = requestAnimationFrame(loop);
    };
    loop();

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      try {
        renderer.dispose(); composer.dispose();
        geom.dispose(); material.dispose();
        bgGeom.dispose(); bgMat.dispose();
        starfield.geometry.dispose(); (starfield.material as THREE.Material).dispose();
        trailSystem.points.geometry.dispose(); (trailSystem.points.material as THREE.Material).dispose();
        if (container && renderer.domElement) container.removeChild(renderer.domElement);
      } catch { /* noop */ }
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default SwordArray3D;

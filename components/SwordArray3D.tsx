/**
 * SwordArray3D — 3D 剑阵渲染核心
 * @version 3.0 视觉重制（对标「万剑归宗」参考效果）
 * @description
 *   v3.0 渲染架构：辉光剑影 billboard
 *   - 每把飞剑 = 1 个实例化四边形（2 三角形），片元着色器程序化绘制
 *     「剑身 + 护手 + 剑柄 + 辉光」的发光剑形，绿底金斑（青竹蜂云剑）
 *   - 上限 512 把（v2.0 为 200），billboard 成本极低，数量拉满仍满帧
 *   - 屏幕空间朝向：剑刃指向运动方向 / 径向 / 切向（按阵式），静止时保持
 *   - 速度拉伸：高速时剑身沿运动方向拉长成流光（剑河/剑群拖尾感）
 *   - 深蓝紫渐变星穹背景 + 星野，替代 v2.0 纯黑背景
 *   - Bloom 随剑数自适应，防止高数量过曝
 *
 *   七种阵式空间行为（v3.0）：
 *   - IDLE 剑意感知：群剑在大体积星域自由游弋
 *   - FIST 剑丸归元：斐波那契球漩涡，剑刃切向，凝为旋转剑丸
 *   - ONE_FINGER 青元剑河：群剑化河，蜿蜒流淌，龙头追手，流光拖尾
 *   - TWO_FINGER 巨剑术：万剑归一，凝为一柄缓缓摇曳的巨剑轮廓
 *   - THREE_FINGER 剑影分光术：一实三虚四道剑流，扇形循环喷射
 *   - FOUR_FINGER 庚金盾幕：三层同心剑环反向旋转
 *   - FIVE_FINGER 大庚剑阵（万剑归宗）：放射状中空剑球，缓慢自转
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FormationState, SCALE_MIN, SCALE_MAX } from '../types';

// ─── Props ────────────────────────────────────────
interface SwordArray3DProps {
  formation: FormationState;
  cursorX: number;       // 0~1，已镜像
  cursorY: number;       // 0~1
  cursorActive: boolean;
  swordScale: number;    // 5~30
  swordCount: number;    // 32~512
  animSpeed: number;     // 0.25~1.75
}

// ─── 常量 ─────────────────────────────────────────
const MAX_SWORDS      = 512;        // 实例化 billboard 容量（v3.0：512）
const PD_KP_BASE      = 0.16;       // PD 弹簧基准
const PD_MAX_FORCE    = 300;        // PD 弹簧力上限
const PD_DAMPING      = 0.62;       // PD 阻尼
const PD_VEL_MAX      = 220;        // 速度上限
const PD_VEL_MIN      = 10;         // 速度下限
const PD_VEL_DECAY    = 0.92;       // 每帧速度衰减
const WORLD_W         = 2800;       // 屏幕宽映射
const WORLD_H         = 2000;       // 屏幕高映射
const BLOOM_BASE      = 0.62;       // Bloom 基准强度（过强会洗白剑群）
const BLOOM_PULSE     = 0.10;       // Bloom 动态脉冲幅度
const STAR_COUNT      = 1600;       // 星空粒子数
const TAU             = Math.PI * 2;
const GOLDEN          = 2.39996323; // 黄金角（斐波那契球分布）

// ─── 剑色方案（按阵式：A 暗基色 → B 亮色，高饱和防洗白，金斑由种子触发） ──
const FORMATION_COLORS: Record<FormationState, number[]> = {
  [FormationState.IDLE]:         [0.02, 0.38, 0.16,  0.30, 1.00, 0.45],
  [FormationState.FIST]:         [0.06, 0.45, 0.18,  0.50, 1.00, 0.40],
  [FormationState.ONE_FINGER]:   [0.02, 0.42, 0.15,  0.35, 1.00, 0.50],
  [FormationState.TWO_FINGER]:   [0.02, 0.35, 0.24,  0.20, 0.90, 0.70],
  [FormationState.THREE_FINGER]: [0.03, 0.40, 0.14,  0.40, 1.00, 0.35],
  [FormationState.FOUR_FINGER]:  [0.08, 0.42, 0.12,  0.55, 1.00, 0.30],
  [FormationState.FIVE_FINGER]:  [0.03, 0.36, 0.13,  0.30, 0.95, 0.30],
};

// ─── 剑的屏幕空间朝向模式 ─────────────────────────
const enum AngleMode { VELOCITY, RADIAL, TANGENT, FIXED, FLOW }
const FORMATION_ANGLE_MODE: Record<FormationState, AngleMode> = {
  [FormationState.IDLE]:         AngleMode.VELOCITY,
  [FormationState.FIST]:         AngleMode.TANGENT,
  [FormationState.ONE_FINGER]:   AngleMode.FLOW,
  [FormationState.TWO_FINGER]:   AngleMode.FIXED,
  [FormationState.THREE_FINGER]: AngleMode.RADIAL,
  [FormationState.FOUR_FINGER]:  AngleMode.TANGENT,
  [FormationState.FIVE_FINGER]:  AngleMode.RADIAL,
};

// ─── Shader：辉光剑影 billboard 顶点 ──────────────
const swordVertexShader = /* glsl */ `
  attribute vec3  aPos;      // 实例世界坐标（每帧更新）
  attribute float aAngle;    // 屏幕空间刃向角
  attribute float aStretch;  // 速度拉伸（1=原长）
  attribute float aAlpha;    // 每实例透明度（虚实剑影）
  attribute float aSeed;     // 每实例种子

  uniform float uSize;

  varying vec2  vUv;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vUv = position.xy;                 // 四边形角点 -0.5~0.5
    vAlpha = aAlpha;
    vSeed = fract(aSeed * 7.13);

    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    // 屏幕空间 billboard：沿刃向（局部 +y）旋转 + 拉伸
    float c = cos(aAngle), s = sin(aAngle);
    vec2 corner = vec2(position.x, position.y * aStretch);
    vec2 rot = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    mv.xy += rot * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

// ─── Shader：辉光剑影 片元（程序化剑形 SDF + 辉光） ──
const swordFragmentShader = /* glsl */ `
  varying vec2  vUv;
  varying float vAlpha;
  varying float vSeed;

  uniform float uTime;
  uniform vec3  uColA;
  uniform vec3  uColB;
  uniform float uFlash;

  // 线段距离函数
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 uv = vUv;

    // 剑身（0.04~0.62，向剑尖收窄；占四边形比例更大，剑感更强）
    float dBlade = sdSeg(uv, vec2(0.0, 0.04), vec2(0.0, 0.62));
    float bt = clamp((uv.y - 0.04) / 0.58, 0.0, 1.0);
    float wBlade = mix(0.048, 0.012, bt);
    float blade = exp(-pow(dBlade / wBlade, 2.0) * 2.0);
    // 剑刃亮芯
    float core = exp(-pow(dBlade / (wBlade * 0.28), 2.0) * 2.0) * step(uv.y, 0.62) * step(0.02, uv.y);
    // 剑尖辉光
    float tip = exp(-pow(length(uv - vec2(0.0, 0.62)) * 24.0, 2.0));
    // 护手（金色横杆）
    float dGuard = sdSeg(uv, vec2(-0.15, 0.03), vec2(0.15, 0.03));
    float guard = exp(-pow(dGuard / 0.020, 2.0) * 2.0);
    // 剑柄
    float dHilt = sdSeg(uv, vec2(0.0, -0.30), vec2(0.0, 0.01));
    float hilt = exp(-pow(dHilt / 0.016, 2.0) * 2.0);

    float body = max(blade, max(guard * 0.6, hilt * 0.5));
    if (body < 0.004) { gl_FragColor = vec4(0.0); return; }

    vec3 green = mix(uColA, uColB, bt * 0.55 + vSeed * 0.45);
    vec3 gold  = vec3(1.0, 0.78, 0.30);

    // 金斑剑：约 1/5 的剑呈金色（青竹蜂云剑的金雷弧意象）
    float isGold = step(0.80, vSeed);
    vec3 col = mix(green, gold * 0.9, isGold) * body;
    col += vec3(1.0, 0.80, 0.35) * guard * 0.45;                          // 护手描金
    col += mix(green, vec3(0.9, 1.0, 0.95), 0.35) * core * (1.0 - isGold * 0.5); // 剑刃亮芯（保绿不过白）
    col += vec3(0.75, 1.0, 0.80) * tip * (0.30 + 0.25 * sin(uTime * 6.0 + vSeed * 40.0)); // 剑尖翠光

    // 阵式切换白闪
    col += vec3(1.0) * uFlash * 0.30;

    float alpha = clamp(body * 1.0, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ─── Shader：星穹背景（深蓝紫渐变 + 双辉光 + 抖动去色带） ──
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
    // 垂直渐变：底部微亮地平 → 中层深蓝 → 顶部近黑（压暗，突出剑群辉光）
    vec3 top = vec3(0.004, 0.006, 0.022);
    vec3 mid = vec3(0.014, 0.018, 0.055);
    vec3 bot = vec3(0.028, 0.042, 0.105);
    vec3 col = mix(bot, mid, smoothstep(-1.0, 0.05, p.y));
    col = mix(col, top, smoothstep(0.05, 1.0, p.y));
    // 底部中央：青翠辉光（剑气之源）
    float d1 = length((p - vec2(0.0, -1.2)) * vec2(1.0, 0.55));
    col += vec3(0.05, 0.34, 0.20) * exp(-d1 * 2.3) * 0.35;
    // 右上：紫金辉光
    float d2 = length((p - vec2(0.78, 0.62)) * vec2(0.85, 1.0));
    col += vec3(0.20, 0.10, 0.36) * exp(-d2 * 1.8) * 0.30;
    // 抖动去色带
    col += (fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
    // 暗角
    col *= 1.0 - 0.38 * dot(p * 0.68, p * 0.68);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── 星空 ─────────────────────────────────────────
function createStarfield(count: number): any {
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 6000 + Math.random() * 8000;
    positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    positions[i * 3 + 2] = Math.cos(phi) * r - 2000;
    // 72% 银白 + 16% 翠绿 + 12% 金色
    const c = Math.random();
    if (c < 0.16)      { colors[i*3]=0.25; colors[i*3+1]=0.95; colors[i*3+2]=0.55; }
    else if (c < 0.28) { colors[i*3]=1.0;  colors[i*3+1]=0.85; colors[i*3+2]=0.45; }
    else               { colors[i*3]=0.75; colors[i*3+1]=0.80; colors[i*3+2]=0.88; }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat  = new THREE.PointsMaterial({
    size: 2.2, vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.65,
  });
  return new THREE.Points(geom, mat);
}

// ─── 飞剑粒子状态 ─────────────────────────────────
interface SwordParticle {
  pos: any;
  vel: any;
  offset: number;
}

// ─── 工具：黄金角斐波那契球方向 ───────────────────
const fibDir = (i: number, count: number, out: any) => {
  const y = 1 - (2 * (i + 0.5)) / count;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN;
  out.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
  return out;
};

const fract = (x: number) => x - Math.floor(x);

// ─── 组件 ─────────────────────────────────────────
const SwordArray3D: React.FC<SwordArray3DProps> = ({
  formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // ★ props → ref 实时同步（避免 useEffect 闭包陷阱）
  const propsRef = useRef({ formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed });
  useEffect(() => {
    propsRef.current = { formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed };
  }, [formation, cursorX, cursorY, cursorActive, swordScale, swordCount, animSpeed]);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width  = container.clientWidth;
    const height = container.clientHeight;

    // ── Scene / Camera / Renderer ────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 1, 20000);
    camera.position.set(0, 0, 2600);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); // 静态相机，手动预计算供 project() 用

    const renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // ── Composer + Bloom ────────────────────────
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_BASE, 0.55, 0.42);
    composer.addPass(bloomPass);

    // ── 星穹背景 ─────────────────────────────────
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

    // ── 星空 ─────────────────────────────────────
    const starfield = createStarfield(STAR_COUNT);
    scene.add(starfield);

    // ── 剑阵 InstancedBufferGeometry（billboard 四边形） ──
    const baseQuad = new THREE.PlaneGeometry(1, 1);
    const geom = new THREE.InstancedBufferGeometry();
    geom.index = baseQuad.index;
    geom.setAttribute('position', baseQuad.getAttribute('position'));

    const posArr     = new Float32Array(MAX_SWORDS * 3);
    const angleArr   = new Float32Array(MAX_SWORDS);
    const stretchArr = new Float32Array(MAX_SWORDS);
    const alphaArr   = new Float32Array(MAX_SWORDS);
    const seedArr    = new Float32Array(MAX_SWORDS);
    for (let i = 0; i < MAX_SWORDS; i++) {
      seedArr[i]  = fract(i * 0.618033987);
      alphaArr[i] = 1;
      angleArr[i] = Math.PI / 2;
      stretchArr[i] = 1;
    }
    const attrPos = new THREE.InstancedBufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage);
    const attrAngle = new THREE.InstancedBufferAttribute(angleArr, 1).setUsage(THREE.DynamicDrawUsage);
    const attrStretch = new THREE.InstancedBufferAttribute(stretchArr, 1).setUsage(THREE.DynamicDrawUsage);
    const attrAlpha = new THREE.InstancedBufferAttribute(alphaArr, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aPos', attrPos);
    geom.setAttribute('aAngle', attrAngle);
    geom.setAttribute('aStretch', attrStretch);
    geom.setAttribute('aAlpha', attrAlpha);
    geom.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedArr, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader:   swordVertexShader,
      fragmentShader: swordFragmentShader,
      uniforms: {
        uTime:  { value: 0 },
        uSize:  { value: 36 },
        uColA:  { value: new THREE.Color(0.05, 0.5, 0.28) },
        uColB:  { value: new THREE.Color(0.45, 1.0, 0.62) },
        uFlash: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const swordMesh = new THREE.Mesh(geom, material);
    swordMesh.frustumCulled = false;
    scene.add(swordMesh);

    // ── 粒子状态池 ───────────────────────────────
    const particles: SwordParticle[] = new Array(MAX_SWORDS);
    for (let i = 0; i < MAX_SWORDS; i++) {
      particles[i] = {
        pos:    new THREE.Vector3((Math.random() - 0.5) * 4000, (Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 1600 - 400),
        vel:    new THREE.Vector3(0, 0, 0),
        offset: fract(i * 0.754877666) * TAU,
      };
    }

    // ── 屏幕投影缓存（速度方向 / 拉伸计算） ──────
    const prevScreen = new Float32Array(MAX_SWORDS * 2).fill(Number.NaN);
    const prevStretch = new Float32Array(MAX_SWORDS).fill(1);
    let prevCount = 0;

    // ── 复用对象（零分配） ───────────────────────
    const tmpVec1 = new THREE.Vector3();
    const tmpVec2 = new THREE.Vector3();
    const tmpVec3 = new THREE.Vector3();
    const tmpVec4 = new THREE.Vector3();
    const fibTmp  = new THREE.Vector3();
    const centerNdc = new THREE.Vector2();
    const colA = new THREE.Color();
    const colB = new THREE.Color();

    // ── 渲染循环 ────────────────────────────────
    let time = 0;
    let formationTime = 0;
    let prevFormation: FormationState | null = null;
    let smoothCx = 0, smoothCy = 0;
    let prevCx = 0, prevCy = 0;

    let rafId = 0;
    let running = true;

    // 最短弧角度插值
    const blendAngle = (a: number, b: number, t: number) => {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return a + d * t;
    };

    const loop = () => {
      if (!running) return;
      const p = propsRef.current;
      const liveFormation = p.formation;
      const liveCursor    = p.cursorActive;
      const liveScale     = p.swordScale;
      const liveCount     = Math.max(1, Math.min(MAX_SWORDS, Math.floor(p.swordCount)));
      const dt = 0.016 * p.animSpeed;
      time += dt;

      // 阵式切换
      if (liveFormation !== prevFormation) {
        formationTime = 0;
        prevFormation = liveFormation;
        const colors = FORMATION_COLORS[liveFormation];
        colA.setRGB(colors[0], colors[1], colors[2]);
        colB.setRGB(colors[3], colors[4], colors[5]);
        (material.uniforms.uColA.value as THREE.Color).copy(colA);
        (material.uniforms.uColB.value as THREE.Color).copy(colB);
        prevScreen.fill(Number.NaN); // 切阵后速度方向重新积累
      }
      formationTime += dt;

      // Shader uniforms
      material.uniforms.uTime.value = time;
      material.uniforms.uSize.value = liveScale * 3.2;
      material.uniforms.uFlash.value = Math.max(0, 1 - formationTime * 1.6);

      // Bloom：随剑数自适应 + 呼吸脉冲（防止高数量过曝）
      const bloomPulse = 1.0 + Math.sin(time * 2.0) * BLOOM_PULSE;
      bloomPass.strength = BLOOM_BASE * bloomPulse * (1.0 - 0.35 * (liveCount / MAX_SWORDS));

      // 星空缓转
      starfield.rotation.y += dt * 0.02;
      starfield.rotation.x += dt * 0.005;

      // 光标平滑（0~1 → 世界坐标）
      const rawCx = (p.cursorX - 0.5) * WORLD_W;
      const rawCy = -(p.cursorY - 0.5) * WORLD_H;
      const alpha = liveCursor ? 0.30 : 0.05;
      smoothCx = smoothCx * (1 - alpha) + rawCx * alpha;
      smoothCy = smoothCy * (1 - alpha) + rawCy * alpha;
      const cursorVx = (smoothCx - prevCx) * 60;
      const cursorVy = (smoothCy - prevCy) * 60;
      prevCx = smoothCx; prevCy = smoothCy;
      const cursorSpeed = Math.hypot(cursorVx, cursorVy) + 0.01;
      // 光标运动方向（归一化）
      tmpVec1.set(cursorVx / cursorSpeed, cursorVy / cursorSpeed, 0);
      if (cursorSpeed < 2.5) tmpVec1.set(1, 0, 0); // 静止时默认向右

      // 剑群中心
      const cx = smoothCx, cy = smoothCy, cz = -120;
      // 中心投影到屏幕（径向/切向朝向用）
      centerNdc.set(cx, cy);
      tmpVec3.set(cx, cy, cz).project(camera);
      centerNdc.set(tmpVec3.x, tmpVec3.y * (width / height));

      // 透视推近：剑越大越靠近摄像头（v3.0 减弱，防止巨大化）
      const zPush = (liveScale - SCALE_MIN) * 10;

      // 巨剑术：巨剑轴摇曳角
      const giantRot = Math.sin(time * 0.4) * 0.15;
      const giantCos = Math.cos(giantRot), giantSin = Math.sin(giantRot);

      // 阵式过渡混合系数（0→1）
      const modeBlend = Math.min(1, formationTime * 1.4);
      const angleMode = FORMATION_ANGLE_MODE[liveFormation];

      geom.instanceCount = liveCount;

      for (let i = 0; i < liveCount; i++) {
        const pt = particles[i];
        const seed = seedArr[i];
        const ratio = i / liveCount;

        // 数量增加时：新剑从远处游入（而非原地闪现）
        if (i >= prevCount) {
          pt.pos.set((Math.random() - 0.5) * 4200, (Math.random() - 0.5) * 3200, (Math.random() - 0.5) * 1800 - 400);
          pt.vel.set(0, 0, 0);
        }

        // ── 目标位置 ──────────────────────────
        let targetAlpha = 1;
        switch (liveFormation) {
          // 剑意感知：大体积星域自由游弋
          case FormationState.IDLE: {
            const R = 650 + Math.sqrt(liveCount) * 55;
            const a = time * (0.22 + seed * 0.3) + seed * TAU + pt.offset;
            const r = R * (0.35 + 0.65 * fract(seed * 7.31));
            tmpVec2.set(
              cx + Math.cos(a) * r,
              cy + Math.sin(a * 0.9 + seed * 5.0) * r * 0.72,
              cz + Math.sin(a * 0.7 + seed * 3.0) * 280,
            );
            break;
          }
          // 剑丸归元：斐波那契球漩涡
          case FormationState.FIST: {
            const R = (210 + 60 * Math.sin(formationTime * 2.0)) * (0.75 + 0.5 * fract(seed * 3.7));
            fibDir(i, liveCount, fibTmp);
            const swirl = time * 2.2 + seed * 0.6;
            const cs = Math.cos(swirl), sn = Math.sin(swirl);
            const fx = fibTmp.x * cs - fibTmp.z * sn;
            const fz = fibTmp.x * sn + fibTmp.z * cs;
            tmpVec2.set(cx + fx * R, cy + fibTmp.y * R * 0.9, cz + fz * R);
            break;
          }
          // 青元剑河：蜿蜒流动的剑河，龙头追手
          case FormationState.ONE_FINGER: {
            const t = (i + 0.5) / liveCount;
            const L = 550 + liveCount * 2.6;
            const dx = tmpVec1.x, dy = tmpVec1.y;
            const perpX = -dy, perpY = dx;
            const wob = Math.sin(t * 12.0 - time * 5.0 + seed * 3.0);
            const width = (26 + 60 * Math.sin(t * Math.PI)) * (0.35 + fract(seed * 5.1) * 0.9);
            tmpVec2.set(
              cx - dx * t * L + perpX * wob * width,
              cy - dy * t * L + perpY * wob * width,
              cz + Math.sin(t * 9.0 - time * 4.0 + seed * 6.0) * 90,
            );
            break;
          }
          // 巨剑术：万剑凝为一柄巨剑轮廓（剑身双缘密布、护手横杆、剑柄剑首）
          case FormationState.TWO_FINGER: {
            const baseY = cy - 300;
            let lx: number, ly: number; // 巨剑局部坐标（ly 向上为正）
            const u = fract(seed * 11.7);
            if (u < 0.60) {          // 剑身
              const v = fract(seed * 3.7);
              const halfW = (1 - v * 0.90) * 44 + 8;
              if (fract(seed * 9.1) < 0.55) {
                // 轮廓缘：沿左右刃口分布
                const sideSign = fract(seed * 5.3) < 0.5 ? -1 : 1;
                lx = sideSign * halfW * (0.85 + fract(seed * 7.7) * 0.15);
              } else {
                lx = (fract(seed * 5.3) - 0.5) * 1.3 * halfW;
              }
              ly = 40 + v * 940 + Math.sin(time * 2.0 + v * 18.0) * 9;
            } else if (u < 0.80) {   // 护手（宽横杆）
              ly = 28 + fract(seed * 2.9) * 24 + (fract(seed * 6.1) - 0.5) * 10;
              lx = (fract(seed * 5.3) - 0.5) * 2 * 240;
            } else if (u < 0.95) {   // 剑柄（细双缘）
              const sideSign = fract(seed * 4.1) < 0.5 ? -1 : 1;
              lx = sideSign * (13 + fract(seed * 2.2) * 8);
              ly = -165 + fract(seed * 3.1) * 180;
            } else {                 // 剑首
              lx = (fract(seed * 5.3) - 0.5) * 2 * 54;
              ly = -198 - fract(seed * 2.3) * 30;
            }
            tmpVec2.set(
              cx + lx * giantCos - ly * giantSin,
              baseY + lx * giantSin + ly * giantCos,
              cz + (fract(seed * 6.7) - 0.5) * 80,
            );
            break;
          }
          // 剑影分光术：一实三虚四道剑流，扇形循环
          case FormationState.THREE_FINGER: {
            const lane = i % 4;
            const baseAngle = Math.PI / 2 + (lane - 1.5) * 0.38; // 朝上扇形
            const flow = fract(seed + time * 0.32 * (lane === 0 ? 1.0 : 0.78));
            const r = 130 + flow * 1150;
            const spread = (fract(seed * 3.3) - 0.5) * (50 + flow * 100);
            const pa = baseAngle + Math.PI / 2;
            tmpVec2.set(
              cx + Math.cos(baseAngle) * r + Math.cos(pa) * spread,
              cy + Math.sin(baseAngle) * r + Math.sin(pa) * spread,
              cz + (lane === 0 ? 110 : -90 * lane) + Math.sin(flow * 9.0 + lane) * 40,
            );
            targetAlpha = lane === 0 ? 1.0 : 0.5;
            break;
          }
          // 庚金盾幕：三层同心剑环反向旋转
          case FormationState.FOUR_FINGER: {
            const layer = i % 3;
            const k = Math.floor(i / 3);
            const layerCount = Math.max(1, Math.ceil(liveCount / 3));
            const baseR = [340, 600, 860][layer];
            const r = baseR + (fract(seed * 4.1) - 0.5) * 90;
            const dir = layer === 1 ? -1 : 1;
            const a = (k / layerCount) * TAU + time * (1.5 - layer * 0.45) * dir + seed * 0.5;
            tmpVec2.set(
              cx + Math.cos(a) * r,
              cy + Math.sin(a) * r * 0.74,
              cz + Math.sin(k * 0.7 + time * 1.2 + layer) * 80,
            );
            break;
          }
          // 大庚剑阵（万剑归宗）：放射状中空剑球
          case FormationState.FIVE_FINGER: {
            const converge = 1.0 + 1.6 * Math.exp(-formationTime * 2.6); // 切阵时从远处收拢
            const R = (300 + 60 * Math.sin(formationTime * 1.8)) * converge;
            fibDir(i, liveCount, fibTmp);
            const swirl = time * 0.35 + seed * 0.15;
            const cs = Math.cos(swirl), sn = Math.sin(swirl);
            const fx = fibTmp.x * cs - fibTmp.z * sn;
            const fz = fibTmp.x * sn + fibTmp.z * cs;
            const shell = 0.88 + 0.30 * fract(seed * 2.7);
            const breathe = 1.0 + Math.sin(time * 2.2 + seed * 20.0) * 0.035;
            tmpVec2.set(
              cx + fx * R * shell * breathe,
              cy + fibTmp.y * R * shell * breathe,
              cz + fz * R * shell * breathe,
            );
            break;
          }
          default:
            tmpVec2.set(cx, cy, cz);
        }
        targetAlpha *= 0.92 + seed * 0.08;
        alphaArr[i] += (targetAlpha - alphaArr[i]) * 0.1;

        // 透视推近
        const tx = tmpVec2.x, ty = tmpVec2.y, tz = tmpVec2.z + zPush;

        // ── PD 控制器 ────────────────────────────
        const ex = tx - pt.pos.x, ey = ty - pt.pos.y, ez = tz - pt.pos.z;
        const dist = Math.hypot(ex, ey, ez);
        const force = Math.min(dist * dist * 0.001 + dist * PD_KP_BASE * p.animSpeed, PD_MAX_FORCE);
        const invD = 1 / Math.max(dist, 0.001);
        pt.vel.x = (pt.vel.x + (ex * invD * force - pt.vel.x * PD_DAMPING) * 0.016) * PD_VEL_DECAY;
        pt.vel.y = (pt.vel.y + (ey * invD * force - pt.vel.y * PD_DAMPING) * 0.016) * PD_VEL_DECAY;
        pt.vel.z = (pt.vel.z + (ez * invD * force - pt.vel.z * PD_DAMPING) * 0.016) * PD_VEL_DECAY;

        // 速度限幅
        const sp = Math.hypot(pt.vel.x, pt.vel.y, pt.vel.z);
        if (sp > PD_VEL_MAX) {
          const k = PD_VEL_MAX / sp;
          pt.vel.x *= k; pt.vel.y *= k; pt.vel.z *= k;
        } else if (sp < PD_VEL_MIN && sp > 0.01) {
          const k = PD_VEL_MIN / sp;
          pt.vel.x *= k; pt.vel.y *= k; pt.vel.z *= k;
        }

        pt.pos.x += pt.vel.x;
        pt.pos.y += pt.vel.y;
        pt.pos.z += pt.vel.z;

        // ── 屏幕投影：速度方向 / 拉伸 ─────────────
        tmpVec4.copy(pt.pos).project(camera);
        const sx = tmpVec4.x, sy = tmpVec4.y * (width / height);
        const psIdx = i * 2;
        let screenSpeed = 0;
        let velAngle = angleArr[i];
        if (!Number.isNaN(prevScreen[psIdx])) {
          const sdx = sx - prevScreen[psIdx];
          const sdy = sy - prevScreen[psIdx + 1];
          screenSpeed = Math.hypot(sdx, sdy);
          if (screenSpeed > 0.0015) {
            velAngle = Math.atan2(sdy, sdx) + Math.PI / 2; // 剑刃指向运动方向
          }
        }
        prevScreen[psIdx] = sx;
        prevScreen[psIdx + 1] = sy;

        // ── 屏幕空间朝向（按阵式模式） ─────────────
        let targetAngle = velAngle;
        if (angleMode === AngleMode.RADIAL) {
          const rdx = sx - centerNdc.x, rdy = sy - centerNdc.y;
          if (Math.hypot(rdx, rdy) > 0.002) targetAngle = Math.atan2(rdy, rdx) + Math.PI / 2;
        } else if (angleMode === AngleMode.TANGENT) {
          const rdx = sx - centerNdc.x, rdy = sy - centerNdc.y;
          if (Math.hypot(rdx, rdy) > 0.002) targetAngle = Math.atan2(rdy, rdx); // 切向 = 径向 + 90°
        } else if (angleMode === AngleMode.FIXED) {
          targetAngle = giantRot + Math.PI / 2;
        } else if (angleMode === AngleMode.FLOW) {
          targetAngle = Math.atan2(tmpVec1.y, tmpVec1.x) + Math.PI / 2; // 剑刃沿剑河流向
        }
        targetAngle += Math.sin(time * 3.0 + seed * 40.0) * 0.06; // 有机微摆
        angleArr[i] = blendAngle(angleArr[i], targetAngle, modeBlend * 0.35 + 0.05);

        // ── 速度拉伸（流光拖尾） ──────────────────
        const targetStretch = 1.0 + Math.min(screenSpeed * 42.0, 2.4);
        prevStretch[i] += (targetStretch - prevStretch[i]) * 0.25;
        stretchArr[i] = prevStretch[i];

        // 写入实例属性
        posArr[i * 3] = pt.pos.x;
        posArr[i * 3 + 1] = pt.pos.y;
        posArr[i * 3 + 2] = pt.pos.z;
      }

      prevCount = liveCount;
      attrPos.needsUpdate = true;
      attrAngle.needsUpdate = true;
      attrStretch.needsUpdate = true;
      attrAlpha.needsUpdate = true;

      composer.render();
      rafId = requestAnimationFrame(loop);
    };
    loop();

    // ── Resize ───────────────────────────────────
    const onResize = () => {
      if (!container) return;
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
        geom.dispose(); baseQuad.dispose(); material.dispose();
        bgGeom.dispose(); bgMat.dispose();
      } catch { /* noop */ }
      starfield.geometry.dispose();
      (starfield.material as any).dispose();
      if (container && renderer.domElement) container.removeChild(renderer.domElement);
    };
  }, []);  // 一次性 mount，用 ref 控制参数

  return <div ref={mountRef} className="w-full h-full" />;
};

export default SwordArray3D;

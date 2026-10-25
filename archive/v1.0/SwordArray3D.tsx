import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FormationState } from '../types';

interface SwordArray3DProps {
  state: FormationState;
  targetPos: { x: number; y: number; vx: number; vy: number; active: boolean };
  swordScale: number;
  swordCount: number;
  animSpeed: number;
}

// ─── Formation uniforms ─────────────────────────────
// uFormation: 0=IDLE,1=POINT_STRIKE,2=DUAL_STREAM,3=TRIPLE_HELIX,
//              4=FAN_WAVE,5=SWARM,6=SHIELD_DISK,7=RETRACT
// uFormationTime: seconds since formation changed
// uEnergy: 0..1 bloom energy pulse

// ─── GLSL Shaders ──────────────────────────────────
const swordVertexShader = /* glsl */ `
  attribute vec3 instanceVelocity;
  varying float vVel;
  varying vec2 vUv;
  varying float vFresnel;
  varying float vHeight;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vFormation;

  void main() {
    float speed = length(instanceVelocity);
    vVel = speed;
    vUv = uv;
    vHeight = position.y;
    vFormation = float(gl_InstanceID) / 200.0; // approximate formation blend
    
    vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
    vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
    vec3 viewDir = normalize(cameraPosition - instancePosition.xyz);
    vFresnel = pow(1.0 - abs(dot(worldNormal, viewDir)), 2.5);
    vWorldPos = instancePosition.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
  }
`;

const swordFragmentShader = /* glsl */ `
  varying float vVel;
  varying vec2 vUv;
  varying float vFresnel;
  varying float vHeight;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uFormation;
  uniform float uFormationTime;

  // ─── Color Palettes per Formation ─────────────────
  // 全部以绿色为基色，不同阵式略有差异，金色光效在 main() 中统一点缀

  vec3 palette(float formation, float t) {
    vec3 c;
    if (formation < 1.5) {
      // IDLE: 翠绿
      c = mix(vec3(0.0,0.3,0.12), vec3(0.15,0.65,0.3), t);
    } else if (formation < 2.5) {
      // POINT_STRIKE: 青绿
      c = mix(vec3(0.0,0.35,0.15), vec3(0.2,0.7,0.25), t);
    } else if (formation < 3.5) {
      // DUAL_STREAM: 碧绿
      c = mix(vec3(0.0,0.4,0.2), vec3(0.15,0.65,0.35), t);
    } else if (formation < 4.5) {
      // TRIPLE_HELIX: 墨绿
      c = mix(vec3(0.05,0.25,0.1), vec3(0.2,0.55,0.2), t);
    } else if (formation < 5.5) {
      // FAN_WAVE: 银绿
      c = mix(vec3(0.1,0.4,0.2), vec3(0.35,0.7,0.4), t);
    } else if (formation < 6.5) {
      // SWARM: 晶绿
      c = mix(vec3(0.05,0.35,0.15), vec3(0.25,0.65,0.3), t);
    } else if (formation < 7.5) {
      // SHIELD_DISK: 深绿
      c = mix(vec3(0.0,0.2,0.08), vec3(0.15,0.5,0.2), t);
    } else {
      // RETRACT: 暗绿
      c = mix(vec3(0.02,0.15,0.05), vec3(0.1,0.4,0.15), t);
    }
    return c;
  }

  // 金色光效（在 main() 内定义）
  vec3 gold;

  void main() {
    gold = vec3(1.0, 0.85, 0.4);
    float formation = uFormation;
    float fTime = uFormationTime;

    // Base color from palette (绿色基色)
    float heightNorm = clamp(vHeight / 26.0, 0.0, 1.0);
    vec3 baseColor = palette(formation, heightNorm);

    bool isBlade = vHeight > 0.15;
    bool isTip   = vHeight > 21.0;

    if (isBlade) {
      // Blade: 能量脉冲（金色点缀，低亮度）
      float pulse = sin(uTime * 4.0 + vHeight * 0.8) * 0.5 + 0.5;
      baseColor += gold * pulse * 0.12;

      // Tip glow（金色剑尖）
      if (isTip) {
        float tipGlow = 1.0 + sin(uTime * 12.0 + fTime * 3.0) * 0.5;
        baseColor += gold * tipGlow * 0.3;
      }
    } else {
      // Hilt: darker
      baseColor *= 0.6;
      // Guard ring highlight（金色护手环）
      float guardRing = smoothstep(-0.05, 0.0, vHeight) * smoothstep(0.15, 0.1, vHeight);
      baseColor += gold * guardRing * 0.25;
    }

    // Fresnel rim（金色边缘光）
    baseColor += gold * vFresnel * 0.8;

    // Speed glow（金色速度光）
    float speedGlow = clamp(vVel / 80.0, 0.0, 1.0);
    baseColor += gold * speedGlow * 0.2;

    // Formation transition flash（低亮度）
    float transitionFlash = smoothstep(0.0, 0.5, fTime) * smoothstep(1.5, 1.0, fTime);
    baseColor += vec3(1.0) * (1.0 - transitionFlash) * 0.15;

    float alpha = 0.82 + vFresnel * 0.1;
    gl_FragColor = vec4(baseColor, alpha);
  }
`;

// ─── Vector3 Pool ───────────────────────────────────
class Vec3Pool {
  private pool: THREE.Vector3[] = [];
  private idx = 0;

  get(): THREE.Vector3 {
    if (this.idx < this.pool.length) return this.pool[this.idx++];
    const v = new THREE.Vector3();
    this.pool.push(v);
    this.idx++;
    return v;
  }

  reset() { this.idx = 0; }
}

// ─── Circular Buffer ────────────────────────────────
class CircularBuffer {
  private data: Float32Array;
  private head = 0;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.data = new Float32Array(size * 3);
  }

  push(x: number, y: number, z: number) {
    this.head = (this.head + 3) % (this.size * 3);
    this.data[this.head] = x;
    this.data[this.head + 1] = y;
    this.data[this.head + 2] = z;
  }

  get3(idx: number, out: THREE.Vector3): THREE.Vector3 {
    const logicalHead = this.head / 3;
    const i = ((logicalHead - idx) % this.size + this.size) % this.size;
    const offset = i * 3;
    return out.set(this.data[offset], this.data[offset + 1], this.data[offset + 2]);
  }
}

// ─── Starfield ──────────────────────────────────────
function createStarfield(count: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 6000 + Math.random() * 8000;
    positions[i * 3]     = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    positions[i * 3 + 2] = Math.cos(phi) * r - 2000;

    const c = Math.random();
    if (c < 0.15) { colors[i*3]=0.2; colors[i*3+1]=0.9; colors[i*3+2]=0.5; }
    else if (c < 0.25) { colors[i*3]=1.0; colors[i*3+1]=0.8; colors[i*3+2]=0.3; }
    else { colors[i*3]=0.7+Math.random()*0.3; colors[i*3+1]=0.7+Math.random()*0.3; colors[i*3+2]=0.8+Math.random()*0.2; }
    sizes[i] = 0.5 + Math.random() * 2.5;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({ size: 2.5, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
  return new THREE.Points(geo, mat);
}

// ─── Energy Burst Particle System ───────────────────
interface EnergyBurst {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  size: number;
}

function createEnergyBursts(): {
  points: THREE.Points;
  update: (formation: FormationState, handX: number, handY: number, time: number, dt: number) => void;
  trigger: (pos: THREE.Vector3, formation: FormationState) => void;
} {
  const MAX_BURSTS = 300;
  const positions = new Float32Array(MAX_BURSTS * 3);
  const colors = new Float32Array(MAX_BURSTS * 3);
  const sizes = new Float32Array(MAX_BURSTS);
  const bursts: EnergyBurst[] = [];

  for (let i = 0; i < MAX_BURSTS; i++) {
    positions[i*3] = 0; positions[i*3+1] = -10000; positions[i*3+2] = -10000;
    colors[i*3] = 1; colors[i*3+1] = 0.8; colors[i*3+2] = 0.3;
    sizes[i] = 0;
    bursts.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 0, color: new THREE.Color(), size: 0 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({ size: 6, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  const points = new THREE.Points(geo, mat);

  const formationColors: Record<string, THREE.Color> = {
    ['IDLE']:        new THREE.Color(0.08, 0.35, 0.18),
    ['POINT_STRIKE']: new THREE.Color(1.0, 0.3, 0.1),
    ['DUAL_STREAM']:  new THREE.Color(0.1, 0.6, 0.8),
    ['TRIPLE_HELIX']: new THREE.Color(1.0, 0.6, 0.1),
    ['FAN_WAVE']:     new THREE.Color(0.5, 0.3, 0.9),
    ['SWARM']:        new THREE.Color(0.8, 0.85, 0.9),
    ['SHIELD_DISK']:  new THREE.Color(0.2, 0.5, 1.0),
    ['RETRACT']:      new THREE.Color(0.6, 0.4, 0.1),
  };

  const trigger = (pos: THREE.Vector3, formation: FormationState) => {
    const color = formationColors[formation] || formationColors[FormationState.IDLE];
    for (let i = 0; i < 30; i++) {
      const idx = bursts.findIndex(b => b.life <= 0);
      if (idx < 0) continue;
      const b = bursts[idx];
      b.pos.copy(pos);
      const speed = 50 + Math.random() * 200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      b.vel.set(Math.sin(phi)*Math.cos(theta)*speed, Math.sin(phi)*Math.sin(theta)*speed, Math.cos(phi)*speed);
      b.life = 0.5 + Math.random() * 1.0;
      b.maxLife = b.life;
      b.color.copy(color);
      b.size = 3 + Math.random() * 5;
    }
  };

  const update = (_formation: FormationState, _handX: number, _handY: number, _time: number, dt: number) => {
    for (let i = 0; i < MAX_BURSTS; i++) {
      const b = bursts[i];
      if (b.life <= 0) { positions[i*3+1] = -10000; continue; }
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      b.vel.multiplyScalar(0.97);
      const t = 1 - b.life / b.maxLife;
      positions[i*3]   = b.pos.x;
      positions[i*3+1] = b.pos.y;
      positions[i*3+2] = b.pos.z;
      colors[i*3]   = b.color.r * (1 - t);
      colors[i*3+1] = b.color.g * (1 - t);
      colors[i*3+2] = b.color.b * (1 - t);
      sizes[i] = b.size * (1 - t);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  };

  return { points, update, trigger };
}

// ─── Trail Particles ────────────────────────────────
function createTrailParticles(maxSwords: number): {
  points: THREE.Points;
  positions: Float32Array;
  update: (swordPositions: Float32Array, count: number, dt: number, formation: string) => void;
} {
  const trailCount = maxSwords * 3;
  const positions = new Float32Array(trailCount * 3);
  const colors = new Float32Array(trailCount * 3);
  const life = new Float32Array(trailCount);
  const attachedSword = new Int16Array(trailCount);

  for (let i = 0; i < trailCount; i++) {
    positions[i*3] = 0; positions[i*3+1] = -10000; positions[i*3+2] = -10000;
    attachedSword[i] = i % maxSwords;
    life[i] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({ size: 3.5, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
  const points = new THREE.Points(geo, mat);

  const formationColorMap: Record<string, [number,number,number]> = {
    [FormationState.IDLE]:        [0.2, 0.95, 0.45],
    [FormationState.POINT_STRIKE]: [1.0, 0.4, 0.15],
    [FormationState.DUAL_STREAM]:  [0.1, 0.7, 0.9],
    [FormationState.TRIPLE_HELIX]: [1.0, 0.65, 0.1],
    [FormationState.FAN_WAVE]:    [0.55, 0.35, 0.95],
    [FormationState.SWARM]:       [0.85, 0.88, 0.95],
    [FormationState.SHIELD_DISK]: [0.25, 0.55, 1.0],
    [FormationState.RETRACT]:     [0.65, 0.45, 0.1],
  };

  let elapsed = 0;
  const update = (swordPositions: Float32Array, count: number, dt: number, formation: string) => {
    elapsed += dt;
    const [cr, cg, cb] = formationColorMap[formation] || [0.2, 0.95, 0.45];
    for (let i = 0; i < trailCount; i++) {
      const sIdx = attachedSword[i];
      if (sIdx >= count) { life[i] = 0; positions[i*3+1] = -10000; continue; }
      life[i] -= dt * 2.5;
      if (life[i] <= 0 && elapsed > 0.04) {
        positions[i*3]   = swordPositions[sIdx*3];
        positions[i*3+1] = swordPositions[sIdx*3+1];
        positions[i*3+2] = swordPositions[sIdx*3+2];
        life[i] = 0.3 + Math.random() * 0.5;
        elapsed = 0;
      } else if (life[i] > 0) {
        positions[i*3]   += (Math.random()-0.5) * 3;
        positions[i*3+1] += (Math.random()-0.5) * 3;
        positions[i*3+2] += (Math.random()-0.5) * 2;
        const t = life[i];
        colors[i*3]   = cr * t;
        colors[i*3+1] = cg * t;
        colors[i*3+2] = cb * t;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };
  return { points, positions, update };
}

// ─── Main Component ─────────────────────────────────
const MAX_SWORDS = 200;
const FORMATION_MAP: Record<FormationState, number> = {
  [FormationState.IDLE]:        0,
  [FormationState.POINT_STRIKE]: 1,
  [FormationState.DUAL_STREAM]:  2,
  [FormationState.TRIPLE_HELIX]: 3,
  [FormationState.FAN_WAVE]:     4,
  [FormationState.SWARM]:        5,
  [FormationState.SHIELD_DISK]:  6,
  [FormationState.RETRACT]:      7,
};

const SwordArray3D: React.FC<SwordArray3DProps> = ({ state, targetPos, swordScale, swordCount, animSpeed }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const animIdRef = useRef<number>(0);
  const prevFormationRef = useRef<FormationState>(FormationState.IDLE);
  const formationTimeRef = useRef<number>(0);

  const coreRef = useRef<{
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    instancedMesh: THREE.InstancedMesh;
    particles: { pos: THREE.Vector3; vel: THREE.Vector3; acc: THREE.Vector3; offset: number }[];
    material: THREE.ShaderMaterial;
    pathBuf: CircularBuffer;
    pool: Vec3Pool;
    starfield: THREE.Points;
    trailSystem: ReturnType<typeof createTrailParticles>;
    burstSystem: ReturnType<typeof createEnergyBursts>;
    bloomPass: UnrealBloomPass;
    swordPosBuf: Float32Array;
  } | null>(null);

  const paramsRef = useRef({ state, targetPos, swordScale, swordCount, animSpeed });
  useEffect(() => { paramsRef.current = { state, targetPos, swordScale, swordCount, animSpeed }; }, [state, targetPos, swordScale, swordCount, animSpeed]);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010409);
    const camera = new THREE.PerspectiveCamera(38, width / height, 1, 20000);
    camera.position.set(0, 0, 2600);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x010409, 1);
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    renderPass.clear = true;
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.4, 0.85);
    bloomPass.renderToScreen = true;
    composer.addPass(bloomPass);

    const starfield = createStarfield(2000);
    scene.add(starfield);

    const trailSystem = createTrailParticles(MAX_SWORDS);
    scene.add(trailSystem.points);

    const burstSystem = createEnergyBursts();
    scene.add(burstSystem.points);

    // ─── Sword Geometry (bamboo sword) ──────────────
    const swordShape = new THREE.Shape();
    swordShape.moveTo(-0.35, -7.0);
    swordShape.lineTo(0.35, -7.0);
    swordShape.lineTo(0.22, -1.2);
    swordShape.lineTo(-0.22, -1.2);
    swordShape.lineTo(-0.35, -7.0);
    const guardHole = new THREE.Path();
    swordShape.moveTo(-1.6, -1.2);
    swordShape.lineTo(1.6, -1.2);
    swordShape.lineTo(1.8, -0.5);
    swordShape.bezierCurveTo(1.2, -0.35, 0.8, 0.0, 0.35, 0.15);
    swordShape.lineTo(-0.35, 0.15);
    swordShape.bezierCurveTo(-0.8, 0.0, -1.2, -0.35, -1.8, -0.5);
    swordShape.lineTo(-1.6, -1.2);
    const bladeLen = 26.0;
    swordShape.moveTo(-0.25, 0.15);
    swordShape.lineTo(0.25, 0.15);
    swordShape.bezierCurveTo(0.25, 4.0, 0.22, 12.0, 0.06, bladeLen - 2.0);
    swordShape.lineTo(0.0, bladeLen + 1.5);
    swordShape.lineTo(-0.06, bladeLen - 2.0);
    swordShape.bezierCurveTo(-0.22, 12.0, -0.25, 4.0, -0.25, 0.15);

    const geom = new THREE.ExtrudeGeometry(swordShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 5 });

    const material = new THREE.ShaderMaterial({
      vertexShader: swordVertexShader,
      fragmentShader: swordFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uFormation: { value: 0 },
        uFormationTime: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const instancedMesh = new THREE.InstancedMesh(geom, material, MAX_SWORDS);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.frustumCulled = false;

    const vels = new Float32Array(MAX_SWORDS * 3);
    instancedMesh.geometry.setAttribute('instanceVelocity', new THREE.InstancedBufferAttribute(vels, 3));
    scene.add(instancedMesh);

    const particles = Array.from({ length: MAX_SWORDS }).map((_, i) => ({
      pos: new THREE.Vector3((Math.random()-0.5)*4000, (Math.random()-0.5)*4000, (Math.random()-0.5)*2000 - 2000),
      vel: new THREE.Vector3(0,0,0),
      acc: new THREE.Vector3(0,0,0),
      offset: (i / MAX_SWORDS) * Math.PI * 2,
    }));

    const pathBuf = new CircularBuffer(180);
    for (let i = 0; i < 180; i++) pathBuf.push(0, 0, 0);
    const pool = new Vec3Pool();
    const swordPosBuf = new Float32Array(MAX_SWORDS * 3);

    coreRef.current = { renderer, composer, scene, camera, instancedMesh, particles, material, pathBuf, pool, starfield, trailSystem, burstSystem, bloomPass, swordPosBuf };

    // ─── Render Loop ──────────────────────────────────
    let time = 0;
    const matrix = new THREE.Matrix4();
    let staticTargetX = 0, staticTargetY = 0;
    let prevTargetX = 0, prevTargetY = 0;
    let targetVelX = 0, targetVelY = 0;

    const loop = () => {
      if (!coreRef.current) return;
      const { renderer, composer, scene, camera, instancedMesh, particles, material, pathBuf, pool, starfield, trailSystem, burstSystem, bloomPass, swordPosBuf } = coreRef.current;
      const p = paramsRef.current;

      const dt = 0.016 * p.animSpeed;
      time += dt;

      // Formation change detection
      if (prevFormationRef.current !== p.state) {
        formationTimeRef.current = 0;
        prevFormationRef.current = p.state;
        // Trigger energy burst at hand position
        const hx = (p.targetPos.x - 0.5) * 2800;
        const hy = -(p.targetPos.y - 0.5) * 2000;
        burstSystem.trigger(new THREE.Vector3(hx, hy, 0), p.state);
      }
      formationTimeRef.current += dt;

      material.uniforms.uTime.value = time;
      material.uniforms.uFormation.value = FORMATION_MAP[p.state] || 0;
      material.uniforms.uFormationTime.value = formationTimeRef.current;

      starfield.rotation.y += dt * 0.02;
      starfield.rotation.x += dt * 0.005;

      // Dynamic bloom
      const bloomPulse = 1.0 + Math.sin(time * 2.0 + formationTimeRef.current * 3.0) * 0.25;
      bloomPass.strength = 0.6 * bloomPulse;

      // Smooth target
      const rawTx = (p.targetPos.x - 0.5) * 2800;
      const rawTy = -(p.targetPos.y - 0.5) * 2000;
      const smoothAlpha = 0.25;
      staticTargetX = staticTargetX * (1 - smoothAlpha) + rawTx * smoothAlpha;
      staticTargetY = staticTargetY * (1 - smoothAlpha) + rawTy * smoothAlpha;
      pathBuf.push(staticTargetX, staticTargetY, 0);
      targetVelX = (staticTargetX - prevTargetX) * 60;
      targetVelY = (staticTargetY - prevTargetY) * 60;
      prevTargetX = staticTargetX;
      prevTargetY = staticTargetY;

      pool.reset();
      const handPos = pool.get().set(staticTargetX, staticTargetY, 0);
      const handVel = pool.get().set(targetVelX, targetVelY, 0);
      const handSpeed = handVel.length() + 0.01;
      const handDir = pool.get().copy(handVel).divideScalar(handSpeed);

      for (let i = 0; i < MAX_SWORDS; i++) {
        const part = particles[i];

        if (i >= p.swordCount) {
          matrix.identity();
          matrix.makeScale(0.01, 0.01, 0.01);
          instancedMesh.setMatrixAt(i, matrix);
          const velAttr = instancedMesh.geometry.getAttribute('instanceVelocity') as THREE.InstancedBufferAttribute;
          velAttr.setXYZ(i, 0, 0, 0);
          swordPosBuf[i*3] = 0; swordPosBuf[i*3+1] = -10000; swordPosBuf[i*3+2] = -10000;
          continue;
        }

        const ratio = i / Math.max(p.swordCount, 1);
        let moveT: THREE.Vector3;

        switch (p.state) {
          // ─── ① 剑丸归元：螺旋收敛球 + 向前穿刺 ───
          case FormationState.POINT_STRIKE: {
            // Swords converge into a spiral sphere near hand, then strike forward
            const sphereR = 80 + Math.sin(formationTimeRef.current * 2.0) * 30;
            const spiralAngle = ratio * Math.PI * 6 + time * 3.0;
            const spiralPitch = ratio * Math.PI * 4;
            moveT = pool.get().set(
              handPos.x + Math.cos(spiralAngle) * Math.sin(spiralPitch) * sphereR,
              handPos.y + Math.cos(spiralPitch) * sphereR * 0.5,
              handPos.z + Math.sin(spiralAngle) * Math.sin(spiralPitch) * sphereR - 100
            );
            // Strike forward along hand velocity direction
            if (handSpeed > 5) {
              moveT.add(pool.get().copy(handDir).multiplyScalar(ratio * 400));
            }
            break;
          }

          // ─── ② 青元剑河：中华龙遨游，剑群成龙形曲线跟随手部 ───
          case FormationState.DUAL_STREAM: {
            // 将飞剑排列成一条"中华龙"曲线，龙头跟随手部位置
            const total = Math.max(p.swordCount, 1);
            const idx = i % total;
            const t = idx / total;           // 0=龙头 → 1=龙尾
            const dragonLength = 900;
            // 龙头位置 = 手部位置
            const head = handPos.clone();
            // 龙身延伸方向 = 手部运动方向（静止时默认向右）
            const bodyDir = handSpeed > 2
              ? handDir.clone()
              : pool.get().set(1, 0, 0);
            const bodyPerp = pool.get().set(-bodyDir.y, bodyDir.x, 0).normalize();
            // 龙身沿 bodyDir 反方向延伸
            const seg = pool.get().copy(head)
              .add(pool.get().copy(bodyDir).multiplyScalar(-t * dragonLength));
            // 龙身正弦波浪：左右摆动 + 上下翻腾
            const waveSide = Math.sin(t * Math.PI * 4 + time * 2.0) * 100;
            const waveUp   = Math.cos(t * Math.PI * 3 + time * 1.2) * 70;
            seg.add(pool.get().copy(bodyPerp).multiplyScalar(waveSide));
            seg.z += waveUp - 200;
            // 龙身粗细：龙头宽，龙尾窄
            const widthFactor = 1.0 - t * 0.65;
            const side = i % 2 === 0 ? 1 : -1;
            seg.add(pool.get().copy(bodyPerp).multiplyScalar(side * 40 * widthFactor));
            moveT = seg;
            break;
          }

          // ─── ③ 龙吟双流：三龙缠绕，有机龙形运动 ───
          case FormationState.TRIPLE_HELIX: {
            const helixIdx = i % 3;
            const subRatio = Math.floor(i / 3) / Math.max(Math.floor(p.swordCount / 3), 1);
            const angle = subRatio * Math.PI * 8 + time * 2.5 + helixIdx * Math.PI * 2 / 3;
            const r = 150 + subRatio * 400;
            // Organic dragon undulation
            const undulation = Math.sin(time * 1.5 + subRatio * 3.0) * 100;
            moveT = pool.get().set(
              handPos.x + Math.cos(angle) * r + undulation * Math.cos(helixIdx * 1.5),
              handPos.y + Math.sin(angle) * r * 0.6 + undulation * Math.sin(helixIdx),
              handPos.z + Math.cos(angle * 0.7 + helixIdx) * r * 0.3 - 200
            );
            break;
          }

          // ─── ④ 三才螺旋：三臂螺旋扇形 ───
          case FormationState.FAN_WAVE: {
            const armIdx = i % 3;
            const subRatio = Math.floor(i / 3) / Math.max(Math.floor(p.swordCount / 3), 1);
            const armAngle = (armIdx - 1) * 0.5 + subRatio * 1.2; // fan spread
            const r = 100 + subRatio * 700;
            const spiralWave = Math.sin(time * 2.0 + subRatio * 5.0) * 80;
            moveT = pool.get().set(
              handPos.x + Math.cos(armAngle) * r + spiralWave * Math.cos(time + armIdx),
              handPos.y + Math.sin(armAngle) * r * 0.7 + spiralWave * Math.sin(time + armIdx),
              handPos.z - 150 + Math.cos(subRatio * 3.0 + time) * 100
            );
            break;
          }

          // ─── ⑤ 庚金巨浪：浪潮翻涌 ───
          case FormationState.SWARM: {
            const wavePhase = ratio * Math.PI * 2 + time * 1.8;
            const waveAmp = 300 + Math.sin(time * 0.8 + ratio * 2.0) * 150;
            const swell = Math.sin(wavePhase) * waveAmp;
            const swellZ = Math.cos(wavePhase * 1.3 + time * 0.7) * waveAmp * 0.5;
            // Wave propagates along hand direction
            const waveDir = handSpeed > 2 ? handDir.clone() : pool.get().set(0, 1, 0);
            const perpDir = pool.get().set(-waveDir.y, waveDir.x, 0).normalize();
            const spreadX = (ratio - 0.5) * 2000;
            moveT = pool.get().copy(handPos)
              .add(pool.get().copy(waveDir).multiplyScalar(swell * 0.5))
              .add(pool.get().copy(perpDir).multiplyScalar(spreadX))
              .add(pool.get().set(0, swell * 0.3, swellZ - 200));
            break;
          }

          // ─── ⑥ 万剑随心：剑盘跟随，随心而动 ───
          case FormationState.SHIELD_DISK: {
            const angle = ratio * Math.PI * 2 + time * 0.8;
            const r = Math.sqrt(ratio) * 550;
            // Disk tilts toward hand movement
            const tiltX = handVel.y * 0.02;
            const tiltY = handVel.x * 0.02;
            moveT = pool.get().set(
              handPos.x + Math.cos(angle) * r,
              handPos.y + Math.sin(angle) * r,
              handPos.z - 100 + Math.sin(ratio * 4.0 + time * 1.5) * 30
            );
            break;
          }

          // ─── ⑦ 庚金盾幕：球形环绕，收放自如 ───
          case FormationState.RETRACT: {
            const orbitAngle = time * 2.0 + part.offset * 8;
            const orbitR = 120 + Math.sin(time * 1.2 + ratio * 2.0) * 80;
            // Contract toward hand when fist is detected
            const contractFactor = 0.3 + Math.sin(time * 0.8) * 0.2;
            moveT = pool.get().set(
              handPos.x + Math.cos(orbitAngle) * orbitR * contractFactor,
              handPos.y + Math.sin(orbitAngle) * orbitR * contractFactor,
              handPos.z + Math.cos(orbitAngle * 0.6) * orbitR * 0.4 * contractFactor - 150
            );
            break;
          }

          default: {
            // 剑意感知：在屏幕附近来回穿梭，不消失
            const boundaryX = 1400;
            const boundaryY = 900;
            const minZ = -100;   // 最近不远于屏幕 100
            const maxZ = 400;    // 最远不超过 400
            // 小幅有机运动：每把剑有独立的椭圆轨道
            const orbitAngle = time * 0.35 + part.offset * 2.0;
            const ox = Math.cos(orbitAngle) * (200 + Math.sin(part.offset) * 120);
            const oy = Math.sin(orbitAngle * 0.8) * (140 + Math.cos(part.offset * 1.3) * 80);
            const oz = -200 + Math.sin(orbitAngle * 0.5 + part.offset) * 120;
            moveT = pool.get().set(
              THREE.MathUtils.clamp(ox, -boundaryX, boundaryX),
              THREE.MathUtils.clamp(oy, -boundaryY, boundaryY),
              Math.max(minZ, Math.min(maxZ, oz))
            );
            break;
          }
        }

        // ── 剑越近越大：swordScale 越大 → 剑群越靠近摄像头
        const zPush = (p.swordScale - 5) * 18; // 5~30 → 0~450
        moveT.z += zPush;

        // ─── PD Controller (shared) ──────────────────
        const error = pool.get().copy(moveT).sub(part.pos);
        const dist = error.length();
        const kp = 0.16 * p.animSpeed;
        const springForce = Math.min(dist * dist * 0.001 + dist * kp, 260);
        error.normalize().multiplyScalar(springForce);
        const damping = pool.get().copy(part.vel).multiplyScalar(0.6);
        error.sub(damping);

        // Organic oscillation
        const frontRatio = i / Math.max(p.swordCount, 1);
        const waveAmp = 8.0 + (1 - frontRatio) * 12.0;
        const waveFreq = time * 5.0 + part.offset * 2.5;
        error.x += Math.sin(waveFreq) * waveAmp * 0.3;
        error.y += Math.cos(waveFreq * 0.7) * waveAmp * 0.3;
        error.z += Math.sin(waveFreq * 0.5 + 1.0) * waveAmp * 0.2;

        part.acc.copy(error);
        part.vel.add(pool.get().copy(part.acc).multiplyScalar(0.016 * p.animSpeed));
        const speed = part.vel.length();
        if (speed > 180) part.vel.normalize().multiplyScalar(180);
        if (speed < 12 && speed > 0.01) part.vel.normalize().multiplyScalar(15);
        part.vel.multiplyScalar(0.92);
        part.pos.add(part.vel);

        swordPosBuf[i*3] = part.pos.x;
        swordPosBuf[i*3+1] = part.pos.y;
        swordPosBuf[i*3+2] = part.pos.z;

        if (part.vel.lengthSq() > 0.02) {
          const velDir = pool.get().copy(part.vel).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), velDir);
          matrix.compose(part.pos, quat, new THREE.Vector3(p.swordScale, p.swordScale, p.swordScale));
        } else {
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
          matrix.compose(part.pos, quat, new THREE.Vector3(p.swordScale, p.swordScale, p.swordScale));
        }
        instancedMesh.setMatrixAt(i, matrix);
        const velAttr = instancedMesh.geometry.getAttribute('instanceVelocity') as THREE.InstancedBufferAttribute;
        velAttr.setXYZ(i, part.vel.x, part.vel.y, part.vel.z);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      (instancedMesh.geometry.getAttribute('instanceVelocity') as THREE.InstancedBufferAttribute).needsUpdate = true;

      trailSystem.update(swordPosBuf, p.swordCount, dt, p.state);
      burstSystem.update(p.state, staticTargetX, staticTargetY, time, dt);

      composer.render();
      animIdRef.current = requestAnimationFrame(loop);
    };

    loop();

    const onResize = () => {
      if (!container || !coreRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      coreRef.current.camera.aspect = w / h;
      coreRef.current.camera.updateProjectionMatrix();
      coreRef.current.renderer.setSize(w, h);
      coreRef.current.composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animIdRef.current);
      renderer.dispose();
      composer.dispose();
      geom.dispose();
      material.dispose();
      coreRef.current = null;
      if (container && renderer.domElement) container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default SwordArray3D;

/** 手部判定共享模块——MediaPipe 版与 TF.js 版追踪器共用（v7 伸直度比值法） */
export type WLM = { x: number; y: number; z: number };

const dist3 = (a: WLM, b: WLM) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleAt = (a: WLM, b: WLM, c: WLM) => {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = a.z - b.z;
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = c.z - b.z;
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z);
  return Math.acos(Math.min(1, Math.max(-1, dot / (m || 1e-9)))) * 180 / Math.PI;
};

// ─── 手指伸直度（核心特征）：tip→MCP 距离 ÷ 骨链总长 ──
// 伸直 ≈ 0.95+，全弯 ≈ 0.25~0.5；旋转/朝向/倾斜全无关（3D 世界坐标）。
// 关节角法已被真实数据否定（手朝镜头倾时投影角掉到 120°，收拢拇指反达 150°+）
const FINGER_IDS: number[][] = [
  [5, 6, 7, 8],    // 食指（MCP..TIP）
  [9, 10, 11, 12], // 中指
  [13, 14, 15, 16],// 无名指
  [17, 18, 19, 20],// 小指
];
function fingerMetrics(world: WLM[]): { ratios: number[]; thumbRatio: number; thumbSep: number; thumbIdx: number; spreadIdx: number; angles: number[] } {
  const ratios = FINGER_IDS.map((ids) => {
    let len = 0;
    for (let k = 0; k < 3; k++) len += dist3(world[ids[k]], world[ids[k + 1]]);
    return dist3(world[ids[3]], world[ids[0]]) / (len + 1e-6);
  });
  // 拇指链 1-2-3-4
  const tl = dist3(world[1], world[2]) + dist3(world[2], world[3]) + dist3(world[3], world[4]);
  const thumbRatio = dist3(world[4], world[2]) / (tl + 1e-6);
  // 拇指分离度：拇指尖 ↔ 食指根，按掌长（腕→中指根）归一
  const palmSpan = dist3(world[0], world[9]) + 1e-6;
  const thumbSep = dist3(world[4], world[5]) / palmSpan;
  // 拇指-食指夹角（4/5 判别主特征，标定自 2026-10-26 用户真实数据 386 帧）：
  // 张开手掌 ≈14~44°（拇指与手指平行）；四指伸+拇指收拢 ≈49~106°（垂直/相对）。
  // 旋转不变（同一只手上两方向的夹角），阈值 40 开 / 55 关（滞回吸收过渡帧）
  const angV = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const m = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
    return Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (m || 1e-9)))) * 180 / Math.PI;
  };
  const spreadIdx = angV(
    world[8].x - world[5].x, world[8].y - world[5].y, world[8].z - world[5].z,
    world[20].x - world[17].x, world[20].y - world[17].y, world[20].z - world[17].z,
  );
  const thumbIdx = angV(
    world[4].x - world[2].x, world[4].y - world[2].y, world[4].z - world[2].z,
    world[8].x - world[5].x, world[8].y - world[5].y, world[8].z - world[5].z,
  );
  // 角度保留仅供日志对照
  const chains: [number, number, number][] = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  const angles = chains.map(([mcp, pip, tip]) => angleAt(world[mcp], world[pip], world[tip]));
  return { ratios, thumbRatio, thumbSep, thumbIdx, spreadIdx, angles };
}

// 阈值（每指独立，标定自用户 2026-10-26 真实手部数据日志；滞回：ext_on / ext_off）
const RATIO_EXT = [0, 0.67, 0.63, 0.73, 0.70];   // 四指伸直阈值（食/中/无/小；无/小指并拢挤压微弯，开阈值放宽 0.03）
const RATIO_CURL = [0, 0.52, 0.48, 0.61, 0.58];  // 四指弯曲阈值
// 拇指：分离度实测重叠（收拢 0.44~0.68 vs 张开 0.44~0.69）已弃用；
// 改用指向角（MCP→TIP 偏离正上的角度，0=正上/180=正下）：
// 张开手掌拇指朝上（小角度），收拢在拳边朝下（大角度）。阈值待实测分布后校准
// 4/5 判别（终版）：食指-小指张角（并拢 vs 张开，与拇指无关，双手通用）
// 标定自 2026-10-26 用户右手实测 186 帧：四指并拢 med16°/p90 19°，五指张开 med41°
// 中间 20°~28° 为空带；张开段低值帧仅为入镜过渡，时序投票可吸收
const SPREAD_ON = 28, SPREAD_OFF = 20;

const GESTURE_STABLE_FRAMES = 5;   // ~200ms @24fps
const SMOOTH_POS = 0.35, SMOOTH_DIST = 0.20;
const SCALE_SMOOTH = 0.30, SPEED_SMOOTH = 0.40;
const PALM_CM = 9.0;    // 手腕横纹→中指根典型掌长
const VFOV_DEG = 52;    // 典型网络摄像头垂直视场角
const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],
  [13,14],[14,15],[15,16],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],[0,17],
];

// ─── 单手状态机：五指滞回 + 手指数时序投票 + 掌心/测距平滑 ──
class HandState {
  private ext = [false, false, false, false, false]; // 拇..小（滞回态）
  private candCount = -1;
  private candFrames = 0;
  private stableCount = -1;
  private sx = 0.5; private sy = 0.5;
  private sd = 0.5;
  private seen = false;
  private normSm: WLM[] = [];
  // 量程锚点（标定会话注入：'dageng-range' {min,max} cm）；
  // 无锚点时退回自适应跟踪（记住本手可达极值，拉伸为满档 0~1，无盲区）
  anchor: { min: number; max: number } | null = null;
  private minCm = 0; private maxCm = 0; private cal = false;

  /** 输入五指伸直度+拇指分离度+landmarks，输出稳定手指数/掌心/距离(cm) */
  update(m: { ratios: number[]; thumbRatio: number; thumbSep: number; thumbIdx: number; spreadIdx: number; angles: number[] }, norm: WLM[], nowMs: number): {
    count: number; x: number; y: number; distance: number; distCm: number; normSm: WLM[];
  } {
    // 五指滞回判定：四指各用独立阈值；拇指用指向角、且只在四指全伸时计 1
    for (let f = 0; f < 4; f++) {
      const r = m.ratios[f];
      if (!this.ext[f + 1] && r > RATIO_EXT[f + 1]) this.ext[f + 1] = true;
      else if (this.ext[f + 1] && r < RATIO_CURL[f + 1]) this.ext[f + 1] = false;
    }
    const fourCount = this.ext.reduce((n, e, i) => n + (i > 0 && e ? 1 : 0), 0);
    if (!this.ext[0] && fourCount === 4 && m.spreadIdx > SPREAD_ON) this.ext[0] = true;
    else if (this.ext[0] && m.spreadIdx < SPREAD_OFF) this.ext[0] = false;
    const rawCount = this.ext.reduce((n, e) => n + (e ? 1 : 0), 0);

    // 手指数时序投票
    if (rawCount === this.candCount) this.candFrames++;
    else { this.candCount = rawCount; this.candFrames = 1; }
    if (this.candFrames >= GESTURE_STABLE_FRAMES || this.stableCount === -1) {
      this.stableCount = rawCount;
    }

    // 关键点 EMA 平滑（骨骼绘制与掌心共用）
    const a = 0.45;
    if (this.normSm.length === 0) this.normSm = norm.map((p: WLM) => ({ x: p.x, y: p.y, z: p.z }));
    else for (let kk = 0; kk < 21; kk++) {
      const s = this.normSm[kk], n = norm[kk];
      s.x += (n.x - s.x) * a; s.y += (n.y - s.y) * a; s.z += (n.z - s.z) * a;
    }
    const nm = this.normSm;

    // 掌心 = 中指根(9)
    const k = this.seen ? SMOOTH_POS : 1.0;
    this.sx += (nm[9].x - this.sx) * k;
    this.sy += (nm[9].y - this.sy) * k;

    // 几何测距：三根掌骨均值（4:3 拉正）→ 真实 cm → 0~1
    const ax = 4 / 3;
    const spanPx = (
      Math.hypot((norm[0].x - norm[5].x) * ax, norm[0].y - norm[5].y) +
      Math.hypot((norm[0].x - norm[9].x) * ax, norm[0].y - norm[9].y) +
      Math.hypot((norm[0].x - norm[17].x) * ax, norm[0].y - norm[17].y)
    ) / 3;
    const distCm = PALM_CM / (2 * Math.max(spanPx, 1e-4) * Math.tan((VFOV_DEG * Math.PI / 180) / 2));
    // 量程：优先用标定锚点（localStorage 'dageng-range'，由标定会话写入，
    // 锚定"手部可达空间 ↔ 数值区间"的绑定）；无锚点时退回自适应跟踪（兜底）
    let lo: number, hi: number;
    const anchor = this.anchor;
    if (anchor) {
      const m = (anchor.max - anchor.min) * 0.15;
      lo = anchor.min - m; hi = anchor.max + m;
    } else {
      if (!this.cal) { this.minCm = distCm; this.maxCm = distCm; this.cal = true; }
      else {
        if (distCm < this.minCm) this.minCm = distCm;
        else this.minCm += (distCm - this.minCm) * 0.004;
        if (distCm > this.maxCm) this.maxCm = distCm;
        else this.maxCm += (distCm - this.maxCm) * 0.004;
      }
      const range = Math.max(15, this.maxCm - this.minCm);
      lo = this.minCm - range * 0.08; hi = this.maxCm + range * 0.08;
    }
    const d01 = Math.max(0, Math.min(1, (hi - distCm) / (hi - lo)));
    this.sd += (d01 - this.sd) * (this.seen ? SMOOTH_DIST : 1.0);

    this.seen = true;
    return {
      count: this.stableCount,
      x: this.sx, y: this.sy, distance: this.sd, distCm,
      normSm: nm,
    };
  }
}


export { dist3, fingerMetrics, HandState, RATIO_EXT, RATIO_CURL, SPREAD_ON, SPREAD_OFF, HAND_CONNECTIONS };

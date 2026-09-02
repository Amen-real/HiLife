// utils/bodymap.js
// 人体肌肉解剖图：用微信 <canvas type="2d"> 绘制真实解剖路径（react-native-body-highlighter 数据）。
// 为什么不走 <image src="data:image/svg+xml">：微信 <image> 不渲染 SVG data-URI（项目已踩坑），
// 而 canvas 2d 既能保真还原解剖轮廓，又能按动作动态给对应肌群上荧光绿，无需联网、不占主包图片资源。
//
// 坐标系：front viewBox "0 0 724 1448"，back viewBox "724 0 724 1448"（back 路径 x 整体 +724）。
// 绘制时 back 先 translate(-724,0) 把坐标归一到 [0,724]。

const D = require('./bodymap-data.js');

const VBW = 724, VBH = 1448;

// 真实 slug 词表（与数据集一致）
const FRONT_SLUGS = new Set(D.FRONT.map(p => p.slug));
const BACK_SLUGS = new Set(D.BACK.map(p => p.slug));

// 英文 / 中文 target 字段 -> 真实 slug（FreeExerciseDB 风格 -> 该库 slug）
const SLUG = {
  pectorals: 'chest', chest: 'chest',
  deltoids: 'deltoids', shoulders: 'deltoids', deltoid: 'deltoids', 'shoulder': 'deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  abs: 'abs', abdominals: 'abs', abdominal: 'abs', core: 'abs', 'core/abs': 'abs',
  obliques: 'obliques', oblique: 'obliques',
  quadriceps: 'quadriceps', quad: 'quadriceps', quads: 'quadriceps',
  hamstrings: 'hamstring', 'biceps femoris': 'hamstring', hamstring: 'hamstring',
  glutes: 'gluteal', gluteus: 'gluteal', glute: 'gluteal',
  calves: 'calves', calf: 'calves', soleus: 'calves',
  lats: 'upper-back', latissimus: 'upper-back', lat: 'upper-back',
  traps: 'trapezius', trapezius: 'trapezius',
  'lower back': 'lower-back', lowerback: 'lower-back', 'erector spinae': 'lower-back',
  forearms: 'forearm', forearm: 'forearm',
  neck: 'neck', tibialis: 'tibialis', adductors: 'adductors',
  knees: 'knees', ankles: 'ankles', feet: 'feet', hands: 'hands', head: 'head', hair: 'hair'
};

// 中文肌群名 -> 真实 slug（与 exercises 数据集的中文命名对齐）
const CN_SLOT = {
  '胸大肌': 'chest', '三角肌': 'deltoids', '三角肌前束': 'deltoids', '肱三头肌': 'triceps',
  '背阔肌': 'upper-back', '斜方肌': 'trapezius', '菱形肌': 'trapezius', '肱二头肌': 'biceps', '肱肌': 'biceps',
  '股四头肌': 'quadriceps', '臀大肌': 'gluteal', '腘绳肌': 'hamstring', '小腿肌群': 'calves',
  '腹直肌': 'abs', '腹外斜肌': 'obliques', '竖脊肌': 'lower-back'
};

// 真实 slug -> 中文显示名
const SLUG_TO_CN = {
  chest: '胸大肌', deltoids: '三角肌', biceps: '肱二头肌', triceps: '肱三头肌',
  abs: '腹直肌', obliques: '腹外斜肌', forearm: '前臂', trapezius: '斜方肌',
  neck: '颈部', head: '头部', hair: '头发', gluteal: '臀大肌', quadriceps: '股四头肌',
  adductors: '内收肌', hamstring: '腘绳肌', calves: '小腿肌群', tibialis: '胫骨前肌',
  ankles: '踝部', knees: '膝部', feet: '足部', hands: '手部',
  'lower-back': '下背', 'upper-back': '上背'
};

// 分类兜底（无 target 数据时），使用真实 slug
const MUSCLE_BY_CAT = {
  '胸部': { front: ['chest', 'deltoids', 'triceps'], back: [] },
  '背部': { front: [], back: ['upper-back', 'trapezius', 'lower-back', 'biceps'] },
  '肩膀': { front: ['deltoids', 'trapezius'], back: [] },
  '腿部': { front: ['quadriceps', 'gluteal', 'adductors'], back: ['hamstring', 'calves'] },
  '手臂': { front: ['biceps', 'triceps'], back: [] },
  '核心': { front: ['abs', 'obliques'], back: ['lower-back', 'gluteal'] }
};

// 从动作对象收集需要高亮的 slug 集合
function collectSlugs(act) {
  const s = new Set();
  const add = (name) => {
    if (!name) return;
    const k = (name + '').toLowerCase();
    if (SLUG[k]) s.add(SLUG[k]);
    else if (CN_SLOT[name]) s.add(CN_SLOT[name]);
  };
  add(act.target);
  add(act.muscle_group);
  (act.secondary_muscles || []).forEach(add);
  const mc = MUSCLE_BY_CAT[act.category];
  if (mc) {
    [].concat(mc.front || [], mc.back || []).forEach((slug) => s.add(slug));
  }
  return s;
}

function primarySlugOf(act) {
  const t = (act.target || '').toLowerCase();
  if (SLUG[t]) return SLUG[t];
  const g = (act.muscle_group || '').toLowerCase();
  if (SLUG[g]) return SLUG[g];
  return null;
}

// 中文 / 英文 target -> 中文显示名（用于标签）
function targetCn(act) {
  const ps = primarySlugOf(act);
  if (ps) return SLUG_TO_CN[ps] || ps;
  if (act.target && CN_SLOT[act.target]) return act.target;
  return act.target || '';
}

function dedupe(arr) {
  const seen = new Set(); const out = [];
  for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

// 将 slug 集合按前/后视图拆分并转中文标签；primary 标记主练肌群
function buildMuscles(act) {
  const slugSet = collectSlugs(act);
  const primary = primarySlugOf(act);
  const primaryCn = primary ? (SLUG_TO_CN[primary] || primary) : null;
  const front = [], back = [];
  slugSet.forEach((slug) => {
    const cn = SLUG_TO_CN[slug] || slug;
    const inF = FRONT_SLUGS.has(slug), inB = BACK_SLUGS.has(slug);
    if (inF) front.push(cn);
    if (inB) back.push(cn);
    if (!inF && !inB) front.push(cn); // 兜底
  });
  const mark = (list) => dedupe(list).map(name => ({ name, primary: name === primaryCn }));
  return { front: mark(front), back: mark(back) };
}

// ===================== SVG path -> canvas 2d =====================
// 支持 M m L l H h V v C c S s Q q T t A a Z z（含相对坐标、弧线转贝塞尔）。
function arcToBezier(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  // 退化情况：半径非正或起止重合 -> 直接直线
  if (rx <= 0 || ry <= 0 || (x1 === x2 && y1 === y2)) return [[x2, y2, x2, y2, x2, y2]];
  const curves = [];
  const phi = phiDeg * Math.PI / 180;
  const sinp = Math.sin(phi), cosp = Math.cos(phi);
  let dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy;
  const y1p = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  let rx2 = rx * rx, ry2 = ry * ry;
  const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const lambda = (x1p2 / rx2) + (y1p2 / ry2);
  if (lambda > 1) { const sq = Math.sqrt(lambda); rx *= sq; ry *= sq; rx2 = rx * rx; ry2 = ry * ry; }
  let denom = rx2 * y1p2 + ry2 * x1p2;
  let co;
  if (denom <= 1e-9) co = 0; // 避免除零
  else co = Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denom));
  const sign = (large === sweep) ? -1 : 1;
  const cxp = sign * co * (rx * y1p / ry);
  const cyp = -sign * co * (ry * x1p / rx);
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  function ang(ux, uy, vx, vy) {
    const a = ux * vx + uy * vy;
    const b = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let r = (b === 0) ? 0 : Math.acos(Math.max(-1, Math.min(1, a / b)));
    return (ux * vy - uy * vx) < 0 ? -r : r;
  }
  let th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && dth > 0) dth -= 2 * Math.PI;
  if (sweep === 1 && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const step = dth / n;
  let t = th1;
  for (let s = 0; s < n; s++) {
    const t1 = t, t2 = t + step;
    const sin1 = Math.sin(t1), cos1 = Math.cos(t1), sin2 = Math.sin(t2), cos2 = Math.cos(t2);
    const e1x = rx * cos1, e1y = ry * sin1, e2x = rx * cos2, e2y = ry * sin2;
    const dX1 = -rx * sin1, dY1 = ry * cos1;
    const dX2 = -rx * sin2, dY2 = ry * cos2;
    const k = (4 / 3) * Math.tan(step / 4);
    const cp1x = e1x + k * dX1, cp1y = e1y + k * dY1;
    const cp2x = e2x - k * dX2, cp2y = e2y - k * dY2;
    // 变换回用户坐标
    const X1 = cosp * e1x - sinp * e1y + cx, Y1 = sinp * e1x + cosp * e1y + cy;
    const U1x = cosp * cp1x - sinp * cp1y + cx, U1y = sinp * cp1x + cosp * cp1y + cy;
    const U2x = cosp * cp2x - sinp * cp2y + cx, U2y = sinp * cp2x + cosp * cp2y + cy;
    const X2 = cosp * e2x - sinp * e2y + cx, Y2 = sinp * e2x + cosp * e2y + cy;
    // 任一坐标非有限 -> 整段退回直线
    if (![U1x, U1y, U2x, U2y, X2, Y2].every(Number.isFinite)) {
      return [[x2, y2, x2, y2, x2, y2]];
    }
    curves.push([U1x, U1y, U2x, U2y, X2, Y2]);
    t = t2;
  }
  return curves;
}

function parsePath(ctx, d) {
  let pi = 0;
  const len = d.length;
  function skip() {
    while (pi < len && (d[pi] === ' ' || d[pi] === ',' || d[pi] === '\t' || d[pi] === '\n' || d[pi] === '\r')) pi++;
  }
  const numRe = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
  function readNum() {
    skip();
    const m = numRe.exec(d.slice(pi));
    if (!m) return NaN;
    pi += m[0].length;
    return parseFloat(m[0]);
  }
  // 弧线标志位（large-arc / sweep）为单个 0/1，可能与后续坐标紧接（如 "012.89"），
  // 必须按单字符读取，不能用通用数字分词器。
  function readFlag() {
    skip();
    if (pi < len && (d[pi] === '0' || d[pi] === '1')) { const f = d[pi]; pi++; return parseInt(f, 10); }
    return 0;
  }

  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lcx = 0, lcy = 0, lastCurve = '';
  let cmd = '';

  while (pi < len) {
    skip();
    if (pi >= len) break;
    const c = d[pi];
    if (/[a-zA-Z]/.test(c)) { cmd = c; pi++; }
    else if (!cmd) { pi++; continue; }
    const abs = cmd === cmd.toUpperCase();
    const lc = cmd.toLowerCase();

    if (lc === 'z') { ctx.closePath(); cx = sx; cy = sy; cmd = ''; continue; }

    if (lc === 'm') {
      let x = readNum(), y = readNum();
      if (!abs) { x += cx; y += cy; }
      ctx.moveTo(x, y);
      sx = x; sy = y; cx = x; cy = y;
      cmd = abs ? 'L' : 'l'; // 后续成对坐标按隐式 L 处理
      continue;
    }
    if (lc === 'l') {
      let x = readNum(), y = readNum();
      if (!abs) { x += cx; y += cy; }
      ctx.lineTo(x, y); cx = x; cy = y; lastCurve = ''; continue;
    }
    if (lc === 'h') {
      let x = readNum(); if (!abs) x += cx;
      ctx.lineTo(x, cy); cx = x; lastCurve = ''; continue;
    }
    if (lc === 'v') {
      let y = readNum(); if (!abs) y += cy;
      ctx.lineTo(cx, y); cy = y; lastCurve = ''; continue;
    }
    if (lc === 'c') {
      let x1 = readNum(), y1 = readNum(), x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      if (!abs) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
      ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
      lcx = x2; lcy = y2; lastCurve = 'C'; cx = x; cy = y; continue;
    }
    if (lc === 's') {
      let x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      if (!abs) { x2 += cx; y2 += cy; x += cx; y += cy; }
      let x1, y1;
      if (lastCurve === 'C' || lastCurve === 'S') { x1 = 2 * cx - lcx; y1 = 2 * cy - lcy; }
      else { x1 = cx; y1 = cy; }
      ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
      lcx = x2; lcy = y2; lastCurve = 'S'; cx = x; cy = y; continue;
    }
    if (lc === 'q') {
      let x1 = readNum(), y1 = readNum(), x = readNum(), y = readNum();
      if (!abs) { x1 += cx; y1 += cy; x += cx; y += cy; }
      ctx.quadraticCurveTo(x1, y1, x, y);
      lcx = x1; lcy = y1; lastCurve = 'Q'; cx = x; cy = y; continue;
    }
    if (lc === 't') {
      let x = readNum(), y = readNum();
      if (!abs) { x += cx; y += cy; }
      let x1, y1;
      if (lastCurve === 'Q' || lastCurve === 'T') { x1 = 2 * cx - lcx; y1 = 2 * cy - lcy; }
      else { x1 = cx; y1 = cy; }
      ctx.quadraticCurveTo(x1, y1, x, y);
      lcx = x1; lcy = y1; lastCurve = 'T'; cx = x; cy = y; continue;
    }
    if (lc === 'a') {
      let rx = readNum(), ry = readNum(), rot = readNum();
      const laf = readFlag(), sf = readFlag();
      let x = readNum(), y = readNum();
      if (!abs) { x += cx; y += cy; }
      if (![rx, ry, x, y].every(Number.isFinite)) { ctx.lineTo(x, y); cx = x; cy = y; lastCurve = ''; continue; }
      const curves = arcToBezier(cx, cy, rx, ry, rot, laf, sf, x, y);
      for (const c of curves) ctx.bezierCurveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
      cx = x; cy = y; lastCurve = ''; continue;
    }
    // 未知命令：跳过一个字符
    pi++;
  }
}

// ===================== 绘制 =====================
// canvas: WeChat canvas 2d node；ctx: canvas.getContext('2d')
// slugSet: Set<slug>（需要高亮的肌群）；opts 可选配色
function drawBody(canvas, ctx, side, slugSet, opts) {
  opts = opts || {};
  const data = side === 'back' ? D.BACK : D.FRONT;
  const outline = side === 'back' ? D.OUTLINE_BACK : D.OUTLINE_FRONT;
  const cw = canvas.width, ch = canvas.height;
  if (!cw || !ch) return;
  ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  const scale = Math.min(cw / VBW, ch / VBH);
  const ox = (cw - VBW * scale) / 2;
  const oy = (ch - VBH * scale) / 2;
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  if (side === 'back') ctx.translate(-724, 0);

  // 人体轮廓（浅色填充，作为干净的身体边界）
  ctx.beginPath();
  parsePath(ctx, outline);
  ctx.fillStyle = opts.outlineFill || '#F1F3F5';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.outlineStroke || '#C9CFD6';
  ctx.stroke();

  // 肌群：未激活浅灰，激活荧光绿
  const base = opts.base || '#E2E6EA';
  const baseStroke = opts.baseStroke || '#D2D8DF';
  const on = opts.on || '#C8FF00';
  const onStroke = opts.onStroke || '#7CB800';
  for (const part of data) {
    const active = slugSet && slugSet.has(part.slug);
    ctx.fillStyle = active ? on : base;
    ctx.strokeStyle = active ? onStroke : baseStroke;
    ctx.lineWidth = 2;
    const sides = []
      .concat(part.path.common || [])
      .concat(part.path.left || [])
      .concat(part.path.right || []);
    for (const d of sides) {
      ctx.beginPath();
      parsePath(ctx, d);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

module.exports = {
  FRONT_SLUGS, BACK_SLUGS, SLUG, CN_SLOT, SLUG_TO_CN, MUSCLE_BY_CAT,
  collectSlugs, primarySlugOf, targetCn, buildMuscles, drawBody
};

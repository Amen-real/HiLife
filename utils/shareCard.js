// utils/shareCard.js
// 训练分享卡（图片）—— 把「本次训练」变成一张可直接发到微信的卡片。
//
// 为什么独立成模块：卡片 = 内容模型 + 版式 + 绘制，其中前两件是**纯逻辑**，
// 能在 node 里直接跑。守卫 scripts/verify-share-card.cjs 正是靠这一点断言：
// 版式不越界、配色达 AA、超长文案被截断、亮绿底上的字必为深字。
// draw() 只负责把版式 ops 翻译成 canvas 调用，本身不含任何口径。
//
// 口径：
//   · 所有指标都取自 utils/trainingStats.js —— 卡片**不许**自己再算一遍训练量/时长/结论/chip，
//     否则「同一场训练，卡片和复盘页数字不一样」是迟早的事；
//   · 卡片恒定使用**浅色品牌版**，不跟随 App 深浅主题：图片会进别人的聊天窗口，
//     收图的人看不到你的主题设置，品牌观感必须稳定（这是刻意选择，不是漏做深色）；
//   · canvas 读不到 CSS 变量，故配色在此硬编码一份 app.wxss 根 token 的镜像。
//     改 token 要同步改这里 —— 守卫 [A] 组会把每个色值对着底色验一遍对比度，改错就红。
const stats = require('./trainingStats.js');
const dateRange = require('./dateRange.js');

/* ================= 尺寸与配色 ================= */

// 卡片宽度 = 750，即设计稿 rpx 口径（750rpx = 375px）。字号可直接沿用设计系统的 rpx 数值。
// 输出图片恒为 750px 宽（backing store 固定，不乘 dpr）→ 跨设备出图完全一致。
const CARD_W = 750;

const PAD = 56;              // 四边留白
const MAX_ROWS = 4;          // 动作行上限，超出折叠成「共 N 个动作」
const ROW_H = 88;            // 单行动作高度
const CONTENT_W = CARD_W - PAD * 2;

// 与 app.json navigationBarTitleText 保持一致
const BRAND = '衡砺健身记录';

// —— app.wxss 根 token 的镜像（括号内为对应 token）——
const P = {
  bg: '#F7F7F5',        // --n-50 页面暖白底
  card: '#FFFFFF',      // --card
  border: '#E8E8E4',    // --n-200 边框线
  ink: '#0A0A0A',       // --n-950 主文字
  sub: '#444444',       // --n-700 次级文字（不用 --n-500 #A0A0A0：压暖白底仅 2.44:1，见报告 P2-9）
  brand: '#C8FF00',     // --primary
  brandInk: '#0A0A0A',  // 亮绿底上的字（对比度铁律：亮绿底必须配深字，16.74:1）
  upFg: '#4C7300',      // --success-text / --primary-text
  upBg: '#F1F5E6',      // rgba(111,159,0,.10) 叠白
  downFg: '#C4363B',    // --danger-text
  downBg: '#FBEDEB',    // rgba(216,72,59,.10) 叠白
  flatFg: '#444444',    // --n-700
  flatBg: '#F1F1EE'     // --n-100
};

// 每个色对都被守卫验证过（浅色底 → 深色字；亮绿底 → #0A0A0A）：
//   ink/bg 18.46 · ink/card 19.80 · ink/brand 16.74
//   sub/bg  9.08 · sub/card 9.74 · sub/flatBg 8.61
//   upFg/upBg 5.04 · downFg/downBg 4.68      —— 全部 ≥ AA 4.5:1
const FS = {
  brand: 32, date: 24,
  verdict: 30,
  metricLab: 22, metricVal: 46, metricUnit: 22,
  section: 28, rowName: 28, rowChip: 22, rowBest: 26, rowMeta: 22,
  pbBadge: 22, pbText: 26,
  foot: 24, footSub: 22
};

/* ================= 文本度量（纯函数） ================= */

// 宽度估算：不引 ctx.measureText，版式才是纯函数、才能在 node 里断言。
// 中文/全角按 1em，ASCII 按 0.62em —— 刻意**偏大**：宁可早一点截断，也不要压出卡片边界。
const WIDE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function estWidth(s, size) {
  let w = 0;
  Array.from(String(s == null ? '' : s)).forEach(ch => { w += WIDE.test(ch) ? size : size * 0.62; });
  return w;
}

// 截断到能放下为止（末位补省略号）
function fit(s, size, maxW) {
  const t = String(s == null ? '' : s);
  if (estWidth(t, size) <= maxW) return t;
  // 必须是「一超就停」的循环：用 forEach 只跳过当前字符的话，
  // 后面更窄的字符会被补上来，拼出「首尾相接但中间少字」的假文案。
  let out = '';
  const chars = Array.from(t);
  for (let i = 0; i < chars.length; i++) {
    if (out && estWidth(out + chars[i] + '…', size) > maxW) break;
    out += chars[i];
  }
  return out.replace(/\s+$/, '') + '…';
}

// 折行到最多 maxLines 行，放不下的用省略号收在末行
function wrap(s, size, maxW, maxLines) {
  const chars = Array.from(String(s == null ? '' : s).trim());
  if (!chars.length) return [];
  const lines = [];
  let cur = '';
  chars.forEach(ch => {
    if (cur && estWidth(cur + ch, size) > maxW) { lines.push(cur); cur = ch; }
    else cur += ch;
  });
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fit(kept[maxLines - 1] + lines.slice(maxLines).join(''), size, maxW);
  return kept;
}

/* ================= 内容模型 ================= */

// 从「已落库的一场训练」构建卡片内容。log = trainingLogs 里的一条，logsDesc = 按日期倒序的全部日志。
// 全部字段都是标量/字符串 —— 直接可以渲染，也可以直接断言。
function buildModel(opts) {
  const o = opts || {};
  const log = o.log;
  if (!log) return null;
  const logsDesc = o.logsDesc || [];
  const idx = Math.max(0, Number(o.idx) || 0);
  const actions = log.actions || [];

  let totalSets = 0, totalReps = 0;
  actions.forEach(a => stats.setsOf(a).forEach(x => {
    totalSets++;
    totalReps += stats.num(x.reps);
  }));

  const vol = stats.loadOfLog(log);
  const sec = stats.durationSecOfLog(log);
  const rpe = stats.avgRpeOfActions(actions);
  const pbs = stats.sessionRecords(log, logsDesc, idx);
  const pbByKey = {};
  pbs.forEach(p => { pbByKey[p.key] = p; });

  // 训练量：纯自重场次（负重恒 0）时退化为总次数。
  // 直接显示「训练量 0 kg」既难看也不传达任何信息，而且会让人以为数据丢了。
  const volumeMetric = vol > 0
    ? { lab: '训练量', val: stats.fmtVol(vol), unit: 'kg' }
    : { lab: '总次数', val: String(totalReps), unit: '次' };

  const rows = actions.map(a => {
    const key = stats.actionKey(a);
    const best = stats.bestSetOf(a);
    const pb = pbByKey[key];
    return {
      key,
      name: (a.nameZh || a.name) || '动作',
      best: best.topW > 0
        ? stats.fmtW(best.topW) + 'kg × ' + best.reps
        : (best.reps ? '自重 × ' + best.reps : '—'),
      setsMeta: stats.setsMetaOf(a),
      chip: stats.sessionChip(a, logsDesc, idx),   // 与复盘页同一份 chip，不另算
      isPb: !!pb,
      pbTxt: pb ? pb.valTxt : ''
    };
  });

  // 动作行只画前 MAX_ROWS 行；超出数量用「共 N 个动作」交代 —— 不静默丢弃信息
  return {
    dateText: dateRange.fmtDateSlash(log.date),
    verdict: String(stats.buildVerdict({ log, logsDesc, idx, rpe }).text || ''),
    metrics: [
      { lab: '时长', val: Math.floor(sec / 60) + ':' + dateRange.pad2(sec % 60), unit: '' },
      volumeMetric,
      { lab: '平均吃力', val: rpe.count ? rpe.avg + '/10' : '—', unit: '' }
    ],
    actionCount: actions.length,
    rows: rows.slice(0, MAX_ROWS),
    pbs,
    empty: actions.length === 0
  };
}

/* ================= 版式（纯函数 → ops 列表） ================= */

function chipStyle(cls) {
  if (cls === 'up') return { fg: P.upFg, bg: P.upBg };
  if (cls === 'down') return { fg: P.downFg, bg: P.downBg };
  return { fg: P.flatFg, bg: P.flatBg };
}

// 把模型摊成绘制指令。每个 text op 都带 bg（它压在什么底色上）——
// 守卫据此断言「亮绿底上必须是深字」，而不是靠肉眼看代码。
function layout(m) {
  const ops = [];
  const W = CARD_W;
  let y = PAD;

  // —— 页头：品牌点 + 品牌名 | 日期 ——
  ops.push({ t: 'circle', cx: PAD + 14, cy: y + 18, r: 14, fill: P.brand });
  ops.push({ t: 'text', s: BRAND, x: PAD + 42, y: y + 18, size: FS.brand, weight: 800, color: P.ink, align: 'left', baseline: 'middle', bg: P.bg });
  ops.push({ t: 'text', s: m.dateText, x: W - PAD, y: y + 18, size: FS.date, weight: 600, color: P.sub, align: 'right', baseline: 'middle', bg: P.bg });
  y += 36 + 24;

  // —— 一句话结论（亮绿块：块内文字必须是 #0A0A0A）——
  const vLines = wrap(m.verdict, FS.verdict, CONTENT_W - 56, 2);
  if (vLines.length) {
    const vLH = 46;
    const vH = vLines.length * vLH + 44;
    ops.push({ t: 'rect', x: PAD, y, w: CONTENT_W, h: vH, r: 24, fill: P.brand });
    vLines.forEach((ln, i) => ops.push({
      t: 'text', s: ln, x: PAD + 28, y: y + 22 + vLH * i + vLH / 2,
      size: FS.verdict, weight: 700, color: P.brandInk, align: 'left', baseline: 'middle', bg: P.brand
    }));
    y += vH + 28;
  }

  // —— 3 个指标 ——
  const colGap = 16;
  const colW = Math.floor((CONTENT_W - colGap * 2) / 3);
  const mH = 120;
  m.metrics.forEach((mt, i) => {
    const cx = PAD + i * (colW + colGap);
    ops.push({ t: 'rect', x: cx, y, w: colW, h: mH, r: 20, fill: P.card, stroke: P.border, lw: 1 });
    ops.push({ t: 'text', s: mt.lab, x: cx + colW / 2, y: y + 32, size: FS.metricLab, weight: 600, color: P.sub, align: 'center', baseline: 'middle', bg: P.card });
    const valW = estWidth(mt.val, FS.metricVal);
    const unitW = mt.unit ? estWidth(mt.unit, FS.metricUnit) + 6 : 0;
    const x0 = cx + colW / 2 - (valW + unitW) / 2;
    ops.push({ t: 'text', s: mt.val, x: x0, y: y + 78, size: FS.metricVal, weight: 800, color: P.ink, align: 'left', baseline: 'middle', bg: P.card });
    if (mt.unit) ops.push({ t: 'text', s: mt.unit, x: x0 + valW + 6, y: y + 84, size: FS.metricUnit, weight: 700, color: P.sub, align: 'left', baseline: 'middle', bg: P.card });
  });
  y += mH + 36;

  // —— 逐动作表现 ——
  ops.push({ t: 'text', s: '逐动作表现', x: PAD, y: y + 14, size: FS.section, weight: 800, color: P.ink, align: 'left', baseline: 'middle', bg: P.bg });
  // 动作超过上限时明说「只列前 N 个」—— 卡片是摘要，但不能让人以为这场就只有 4 个动作
  const countTxt = m.actionCount > MAX_ROWS
    ? '共 ' + m.actionCount + ' 个动作 · 列前 ' + MAX_ROWS + ' 个'
    : '共 ' + m.actionCount + ' 个动作';
  ops.push({ t: 'text', s: countTxt, x: W - PAD, y: y + 14, size: FS.rowMeta, weight: 600, color: P.sub, align: 'right', baseline: 'middle', bg: P.bg });
  y += 28 + 18;

  if (m.empty) {
    // 没记录动作的场次（例如只记了时长）也要能出卡，给一句实话而不是一张空壳
    const h = 88;
    ops.push({ t: 'rect', x: PAD, y, w: CONTENT_W, h, r: 24, fill: P.card, stroke: P.border, lw: 1 });
    ops.push({ t: 'text', s: '这场训练没有记录动作明细', x: PAD + 28, y: y + h / 2, size: FS.rowBest, weight: 600, color: P.sub, align: 'left', baseline: 'middle', bg: P.card });
    y += h + 24;
  } else {
    const rowsH = m.rows.length * ROW_H;
    ops.push({ t: 'rect', x: PAD, y, w: CONTENT_W, h: rowsH, r: 24, fill: P.card, stroke: P.border, lw: 1 });
    m.rows.forEach((r, i) => {
      const ry = y + i * ROW_H;
      const chipW = estWidth(r.chip.text, FS.rowChip) + 32;
      const cs = chipStyle(r.chip.cls);
      ops.push({ t: 'text', s: fit(r.name, FS.rowName, CONTENT_W - 56 - chipW - 16), x: PAD + 28, y: ry + 32, size: FS.rowName, weight: 700, color: P.ink, align: 'left', baseline: 'middle', bg: P.card });
      ops.push({ t: 'rect', x: W - PAD - 28 - chipW, y: ry + 12, w: chipW, h: 40, r: 20, fill: cs.bg });
      ops.push({ t: 'text', s: r.chip.text, x: W - PAD - 28 - chipW / 2, y: ry + 32, size: FS.rowChip, weight: 700, color: cs.fg, align: 'center', baseline: 'middle', bg: cs.bg });
      ops.push({ t: 'text', s: fit('最好一组 ' + r.best, FS.rowBest, CONTENT_W - 56 - 168), x: PAD + 28, y: ry + 64, size: FS.rowBest, weight: 700, color: P.ink, align: 'left', baseline: 'middle', bg: P.card });
      ops.push({ t: 'text', s: r.setsMeta, x: W - PAD - 28, y: ry + 64, size: FS.rowMeta, weight: 600, color: P.sub, align: 'right', baseline: 'middle', bg: P.card });
      if (i < m.rows.length - 1) ops.push({ t: 'line', x1: PAD + 28, y1: ry + ROW_H, x2: W - PAD - 28, y2: ry + ROW_H, color: P.border, lw: 1 });
    });
    y += rowsH + 24;
  }

  // —— 个人纪录条（只在本场真的破了纪录时出现，不做「无数据也占位」）——
  if (m.pbs.length) {
    const h = 68;
    const badgeX = PAD + 28;
    const textX = badgeX + 60 + 16;
    const detail = m.pbs.map(x => x.name + ' ' + x.valTxt).join(' · ');
    ops.push({ t: 'rect', x: PAD, y, w: CONTENT_W, h, r: 20, fill: P.card, stroke: P.border, lw: 1 });
    ops.push({ t: 'rect', x: PAD, y, w: 8, h, r: 4, fill: P.brand });
    ops.push({ t: 'rect', x: badgeX, y: y + 16, w: 60, h: 36, r: 18, fill: P.brand });
    ops.push({ t: 'text', s: '新', x: badgeX + 30, y: y + 34, size: FS.pbBadge, weight: 800, color: P.brandInk, align: 'center', baseline: 'middle', bg: P.brand });
    ops.push({ t: 'text', s: fit('本场刷新 ' + m.pbs.length + ' 项个人纪录 · ' + detail, FS.pbText, W - PAD - 28 - textX), x: textX, y: y + 34, size: FS.pbText, weight: 700, color: P.ink, align: 'left', baseline: 'middle', bg: P.card });
    y += h + 26;
  }

  // —— 页脚 ——
  ops.push({ t: 'text', s: BRAND, x: PAD, y: y + 12, size: FS.foot, weight: 800, color: P.ink, align: 'left', baseline: 'middle', bg: P.bg });
  ops.push({ t: 'text', s: '记录每一次进步', x: W - PAD, y: y + 12, size: FS.footSub, weight: 600, color: P.sub, align: 'right', baseline: 'middle', bg: P.bg });
  y += 32 + PAD;

  return { w: W, h: y, ops };
}

// 卡片总高（内容自适应：1 行结论 vs 2 行结论、有没有纪录条、几个动作行，高度都不一样）
function measure(m) { return layout(m).h; }

/* ================= 绘制 ================= */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r || 0, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// 把 ops 画到 canvas 2d 上下文。ctx 形状与 wx canvas 2d 一致：
// 只需 fillRect / clearRect / beginPath / moveTo / lineTo / arcTo / arc / closePath
// / fill / stroke / fillText 与 fillStyle / strokeStyle / lineWidth / font / textAlign / textBaseline。
// 因此守卫可以用一个「只记录调用的假 ctx」把它跑完，验证真的产出了图元。
function draw(ctx, m) {
  const L = layout(m);
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, L.w, L.h);

  L.ops.forEach(op => {
    if (op.t === 'rect') {
      ctx.beginPath();
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
      if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.lw || 1; ctx.stroke(); }
    } else if (op.t === 'circle') {
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.fill;
      ctx.fill();
    } else if (op.t === 'line') {
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.lw || 1;
      ctx.stroke();
    } else if (op.t === 'text') {
      ctx.font = (op.weight || 400) + ' ' + op.size + 'px sans-serif';
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align || 'left';
      ctx.textBaseline = op.baseline || 'alphabetic';
      ctx.fillText(op.s, op.x, op.y);
    }
  });
  return L;
}

module.exports = {
  CARD_W, PAD, MAX_ROWS, ROW_H, BRAND, PALETTE: P, FONT_SIZE: FS,
  estWidth, fit, wrap,
  buildModel, layout, measure, draw
};

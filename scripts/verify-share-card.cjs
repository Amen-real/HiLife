#!/usr/bin/env node
/**
 * verify-share-card.cjs —— 训练分享卡（B2）回归（零依赖）
 *
 * 为什么需要这个脚本：
 *   1. 分享卡是 **canvas 画出来的**，而 `verify-dark-theme.cjs` 只读 WXSS ——
 *      卡片上的每一个「字色 / 底色」组合都不在任何样式门禁的覆盖范围内。
 *      画错了（比如用了 #A0A0A0 那种浅灰）门禁一样全绿，只有这里能拦住。
 *   2. 版式是几何问题：文案长了会不会压出卡片边界、行会不会重叠，
 *      肉眼看代码看不出来，但用 ops 坐标算得出来。
 *   3. 出图链路（`wx:if` 画布 → createSelectorQuery → canvasToTempFilePath）只靠
 *      「模块单测通过」证明不了 —— 必须用 stub 跑一遍**真实组件处理器**。
 *
 * 用法：node scripts/verify-share-card.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p, sub) => read(p).indexOf(sub) >= 0;

// 静态扫描（[F] 组）前必须先剥注释。
// 原因：为了讲清「为什么不能这么写」，源码注释里会原样引用反面样例
// （例如 `onShareAppMessage() {}`）。不剥注释，尺子会把自己的说明文字
// 当成真实缺陷 —— 自伤报错，且修起来很容易误删正确代码。
// 注意 `[^:\/]` 是为了不误伤 `https://`。
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\/])\/\/[^\n]*/g, '$1');
const readCode = (p) => stripComments(read(p));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => v ? ok(label) : bad(label);
const isFalse = (label, v) => !v ? ok(label) : bad(label);
const near = (label, a, b) => (Math.abs(a - b) < 0.01) ? ok(label) : bad(label + '  expect=' + b + ' got=' + a);

const shareCard = require(path.join(ROOT, 'utils', 'shareCard.js'));
const stats = require(path.join(ROOT, 'utils', 'trainingStats.js'));
const P = shareCard.PALETTE;

/* ============ 本脚本自带的对比度算术 ============
   刻意**不**从被验模块里取（那等于自己验自己）。
   实现按 WCAG 2.1 相对亮度公式。 */
function hx(h) { const s = String(h).replace('#', ''); return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16)); }
function chan(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum(hex) { const r = hx(hex); return 0.2126 * chan(r[0]) + 0.7152 * chan(r[1]) + 0.0722 * chan(r[2]); }
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const r2 = (n) => Math.round(n * 100) / 100;
// 块边界判据（本仓口径）：rgba 叠底后逐通道最大差 ≥ 10/255
function delta(a, b) { const x = hx(a), y = hx(b); return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])); }

/* ============ [A] 卡片配色：全部字色/底色对必须达 AA ============ */
console.log('\n[A] 卡片配色 —— canvas 不在 CSS 门禁覆盖内，这里逐个色对验 AA');

// 卡片里允许出现的「字色 on 底色」组合。新增文字样式必须同时加进这张表，
// 否则 [D2] 会因为「出现未验证的色对」而红 —— 这是刻意的。
const AA_PAIRS = [
  ['ink', 'bg', '\u4e3b\u6587\u5b57 on \u6696\u767d\u5e95'],
  ['ink', 'card', '\u4e3b\u6587\u5b57 on \u767d\u5361'],
  ['ink', 'brand', '\u4e3b\u6587\u5b57 on \u4eae\u7eff\u5757'],
  ['sub', 'bg', '\u6b21\u7ea7\u5b57 on \u6696\u767d\u5e95'],
  ['sub', 'card', '\u6b21\u7ea7\u5b57 on \u767d\u5361'],
  ['sub', 'flatBg', '\u7070 chip \u5b57'],
  ['upFg', 'upBg', '\u4e0a\u5347 chip \u5b57'],
  ['downFg', 'downBg', '\u4e0b\u964d chip \u5b57'],
  ['brandInk', 'brand', '\u4eae\u7eff\u5e95\u4e0a\u7684\u5b57\uff08\u94c1\u5f8b\uff09']
];
let minPair = 99;
AA_PAIRS.forEach(([fg, bg, label]) => {
  const v = r2(contrast(P[fg], P[bg]));
  if (v < minPair) minPair = v;
  isTrue('A1 ' + label + ' ' + P[fg] + ' on ' + P[bg] + ' = ' + v + ':1 ≥ AA 4.5', v >= 4.5);
});

// 铁律：亮绿底上必须是深字（#0A0A0A）。亮绿是全库唯一不随主题翻转的色，
// 白字压亮绿只有 1.6:1 —— 这条在卡片上同样是硬线。
eq('A2 亮绿块的文字色固定为 #0A0A0A', P.brandInk, '#0A0A0A');
isTrue('A3 亮绿底 + 深字 ≥ 7:1（远好于 AA，因为它是视觉重心）', contrast(P.brandInk, P.brand) >= 7);

// 报告 P2-9 的盲区色：不要把它搬到卡片上
const vals = Object.keys(P).map(k => String(P[k]).toUpperCase());
isFalse('A4 卡片配色不含 #A0A0A0（--n-500，压浅底仅 2.6:1）', vals.indexOf('#A0A0A0') >= 0);
isFalse('A4 没把浅色面当字色（白字/亮绿字压浅底必然隐形）',
  AA_PAIRS.some(([fg]) => ['#FFFFFF', '#F7F7F5', '#F1F1EE', '#C8FF00'].indexOf(String(P[fg]).toUpperCase()) >= 0));

// 块边界（卡内子块要能看出边界）
isTrue('A5 白卡 vs 暖白底 Δ = ' + delta(P.card, P.bg) + ' ≥ 10', delta(P.card, P.bg) >= 10);
isTrue('A6 边框 vs 白卡 Δ = ' + delta(P.border, P.card) + ' ≥ 10', delta(P.border, P.card) >= 10);
isTrue('A7 灰 chip vs 白卡 Δ = ' + delta(P.flatBg, P.card) + ' ≥ 10', delta(P.flatBg, P.card) >= 10);
isTrue('A8 绿 chip vs 白卡 Δ = ' + delta(P.upBg, P.card) + ' ≥ 10', delta(P.upBg, P.card) >= 10);
console.log('  · 全表最小对比度 = ' + minPair + ':1');

/* ============ [B] 文本度量与截断（纯函数） ============ */
console.log('\n[B] \u6587\u672c\u5ea6\u91cf \u2014\u2014 \u5c3a\u5b50\u672c\u8eab\u5148\u6821\u51c6');
eq('B1 中文按 1em', shareCard.estWidth('\u5367\u63a8', 30), 60);
eq('B1 ASCII 按 0.62em（保守偏大）', r2(shareCard.estWidth('abcd', 30)), r2(30 * 0.62 * 4));
isTrue('B1 空串宽度为 0', shareCard.estWidth('', 30) === 0 && shareCard.estWidth(null, 30) === 0);

eq('B2 放得下就原样返回', shareCard.fit('\u5367\u63a8', 28, 200), '\u5367\u63a8');
const longName = '\u5361\u7279\u5c14\u62c9\u534a\u7a0b\u7a0b\u5ea6\u8fbe\u5230\u529b\u7aed\u7684\u90a3\u79cd\u8bad\u7ec3\u52a8\u4f5c\u540d\u79f0';
const fitted = shareCard.fit(longName, 28, 200);
isTrue('B3 超宽串被截断', fitted.length < longName.length);
isTrue('B3 截断以省略号收尾', fitted.slice(-1) === '\u2026');
isTrue('B3 截断后估算宽度仍 ≤ 上限', shareCard.estWidth(fitted, 28) <= 200);

eq('B4 空串折行返回空数组', shareCard.wrap('', 30, 200, 2), []);
const wrapped = shareCard.wrap(longName, 30, 300, 2);
isTrue('B4 折行不超过 maxLines', wrapped.length <= 2);
isTrue('B4 每行都在宽度内', wrapped.every(l => shareCard.estWidth(l, 30) <= 300));
isTrue('B4 被截断时末行有省略号', wrapped[wrapped.length - 1].slice(-1) === '\u2026');
eq('B5 一行放得下就只有一行', shareCard.wrap('\u4eca\u5929\u7ec3\u5f97\u4e0d\u9519', 30, 300, 2).length, 1);
isTrue('B5 两行内容不被截断', shareCard.wrap('\u4eca\u5929\u7ec3\u5f97\u4e0d\u9519\u54e6\u771f', 30, 160, 2).join('').indexOf('\u2026') < 0);

/* ============ [C] 内容模型 ============ */
console.log('\n[C] \u5185\u5bb9\u6a21\u578b \u2014\u2014 \u5168\u90e8\u53d6\u81ea trainingStats\uff0c\u4e0d\u81ea\u5df1\u7b97\u4e00\u904d');
const S = (w, r, rpe) => ({ weight: w, reps: r, trainSec: 60, restSec: 30, rpe: rpe === undefined ? 7 : rpe });
const A = (id, name, sets, equip) => ({ id, name, nameZh: name, equip: equip || '', setsDetail: sets, note: '' });
const dAgo = (n) => { const d = new Date(Date.UTC(2026, 8, 16)); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const logs = [
  { date: dAgo(1), actions: [A('a1', '\u5367\u63a8', [S(60, 10), S(60, 8)]), A('a2', '\u5f15\u4f53\u5411\u4e0a', [S(0, 12)]), A('a3', '\u6df1\u8e72', [S(100, 5)])] },
  { date: dAgo(4), actions: [A('a1', '\u5367\u63a8', [S(55, 10)]), A('a3', '\u6df1\u8e72', [S(95, 5)])] },
  { date: dAgo(9), actions: [A('a1', '\u5367\u63a8', [S(50, 10)])] }
];
const m = shareCard.buildModel({ log: logs[0], logsDesc: logs, idx: 0 });
isTrue('C1 有内容产出', !!m);
eq('C1 3 个指标', m.metrics.length, 3);
eq('C1 训练量单位为 kg', [m.metrics[1].lab, m.metrics[1].unit], ['\u8bad\u7ec3\u91cf', 'kg']);
eq('C1 训练量取 trainingStats.fmtVol 单源', m.metrics[1].val, stats.fmtVol(stats.loadOfLog(logs[0])));
eq('C1 时长取 trainingStats.durationSecOfLog 单源',
  m.metrics[0].val, Math.floor(stats.durationSecOfLog(logs[0]) / 60) + ':' + require(path.join(ROOT, 'utils', 'dateRange.js')).pad2(stats.durationSecOfLog(logs[0]) % 60));
eq('C1 平均吃力格式 x/10', m.metrics[2].val, '7/10');

// 纯自重场次：显示「训练量 0 kg」既难看也没信息，必须退化为总次数
const bw = shareCard.buildModel({
  log: { date: dAgo(1), actions: [A('b1', '\u5f15\u4f53\u5411\u4e0a', [S(0, 10), S(0, 8)])] },
  logsDesc: [], idx: 0
});
eq('C2 纯自重 → 指标改为总次数', [bw.metrics[1].lab, bw.metrics[1].val, bw.metrics[1].unit], ['\u603b\u6b21\u6570', '18', '\u6b21']);

const noRpe = shareCard.buildModel({ log: { date: dAgo(1), actions: [A('b1', 'x', [S(0, 10, null)])] }, logsDesc: [], idx: 0 });
eq('C3 未记录吃力 → —（不显示 0/10）', noRpe.metrics[2].val, '\u2014');

// 动作行上限：超出的不能静默丢掉，要用 actionCount 交代
const many = shareCard.buildModel({
  log: { date: dAgo(1), actions: [1, 2, 3, 4, 5, 6].map(i => A('m' + i, '\u52a8\u4f5c' + i, [S(50, 10)])) },
  logsDesc: [], idx: 0
});
eq('C4 行数封顶 MAX_ROWS', many.rows.length, shareCard.MAX_ROWS);
eq('C4 总数保留真实值', many.actionCount, 6);
eq('C4 MAX_ROWS = 4', shareCard.MAX_ROWS, 4);

// 破纪录：必须与 stats.sessionRecords 是同一把尺子
const pbNames = m.pbs.map(x => x.name).sort();
eq('C5 破纪录集合与 stats.sessionRecords 一致',
  pbNames, stats.sessionRecords(logs[0], logs, 0).map(x => x.name).sort());
isTrue('C5 卧推本场破纪录（600 > 550）', pbNames.indexOf('\u5367\u63a8') >= 0);
isTrue('C5 行上有 isPb 标', m.rows.some(r => r.isPb && r.name === '\u5367\u63a8'));

// chip 不自己算：与 stats.sessionChip 逐字一致
eq('C6 行 chip 与 stats.sessionChip 同一份',
  m.rows.map(r => r.chip), logs[0].actions.map(a => stats.sessionChip(a, logs, 0)));

const emptyM = shareCard.buildModel({ log: { date: dAgo(1), actions: [] }, logsDesc: [], idx: 0 });
eq('C7 无动作场次 empty = true', emptyM.empty, true);
eq('C7 无动作场次 0 行', emptyM.rows.length, 0);
eq('C8 无 log → null', shareCard.buildModel({ log: null }), null);
eq('C8 无参 → null', shareCard.buildModel(), null);

/* ============ [D] 版式几何 ============ */
console.log('\n[D] \u7248\u5f0f\u51e0\u4f55 \u2014\u2014 \u4e0d\u8d8a\u754c\u3001\u4e0d\u91cd\u53e0\u3001\u8272\u5bf9\u5728\u767d\u540d\u5355\u5185');

// 把「文字盒」按 align 折算成真实占据的 x 区间 —— 只看 o.x 会漏掉右对齐溢出
function textBox(o) {
  const w = shareCard.estWidth(o.s, o.size);
  let x0 = o.x;
  if (o.align === 'center') x0 = o.x - w / 2;
  if (o.align === 'right') x0 = o.x - w;
  return { x0, x1: x0 + w, y: o.y, h: o.size };
}

function scanLayout(model) {
  const L = shareCard.layout(model);
  const oob = [], unknownPair = [], brandBad = [];
  const pairKeys = {};
  AA_PAIRS.forEach(([fg, bg]) => { pairKeys[P[fg] + '|' + P[bg]] = fg + '/' + bg; });
  L.ops.forEach((o, i) => {
    if (o.t === 'rect') {
      if (o.x < -0.01 || o.y < -0.01 || o.x + o.w > L.w + 0.01 || o.y + o.h > L.h + 0.01) oob.push(i + ':rect');
      if (o.r && (o.r > o.w / 2 + 0.01 || o.r > o.h / 2 + 0.01)) oob.push(i + ':rect 圆角超过半宽/半高');
    } else if (o.t === 'line') {
      if (o.x1 < -0.01 || o.x2 > L.w + 0.01 || o.y1 < -0.01 || o.y1 > L.h + 0.01) oob.push(i + ':line');
    } else if (o.t === 'circle') {
      if (o.cx - o.r < -0.01 || o.cy - o.r < -0.01 || o.cx + o.r > L.w + 0.01 || o.cy + o.r > L.h + 0.01) oob.push(i + ':circle');
    } else if (o.t === 'text') {
      const b = textBox(o);
      if (b.x0 < -0.01 || b.x1 > L.w + 0.01) oob.push(i + ':text 横向越界 ' + b.x0.toFixed(1) + '~' + b.x1.toFixed(1) + ' 「' + o.s + '」');
      if (o.y - o.size / 2 < -0.01 || o.y + o.size / 2 > L.h + 0.01) oob.push(i + ':text 纵向越界 y=' + o.y);
      if (o.size < 20) oob.push(i + ':text 字号过小 ' + o.size);
      // 色对白名单：新加一格文字样式必须把色对加进 AA_PAIRS（否则这里红）
      if (!o.bg) unknownPair.push(i + ':text 未声明 bg');
      else if (!pairKeys[o.color + '|' + o.bg]) unknownPair.push(i + ':text 未验证色对 ' + o.color + ' on ' + o.bg + ' 「' + o.s + '」');
      // 铁律：亮绿底上必须是深字
      if (o.bg === P.brand && o.color !== P.brandInk) brandBad.push(i + ':text 亮绿底上用了非深字 ' + o.color);
    }
  });
  return { L, oob, unknownPair, brandBad };
}

const r1 = scanLayout(m);
eq('D1 常规卡片：无越界/无重叠图元', r1.oob, []);
eq('D2 常规卡片：所有文字色对都已在白名单', r1.unknownPair, []);
eq('D3 常规卡片：亮绿底上都是深字', r1.brandBad, []);

// 极长内容（长动作名 + 长结论 + 有纪录条）也不能越界 —— 这才是版式真正的压力测试
const stressLog = {
  date: dAgo(1),
  actions: [
    A('s1', '\u53cc\u624b\u54d1\u94c3\u5355\u81c2\u5f00\u624b\u6df1\u8e72\u4e0e\u8df3\u8dc3\u7ec4\u5408\u8bad\u7ec3', [S(123.5, 12)]),
    A('s2', '\u7ad9\u59ff\u6760\u94c3\u63a8\u4e3e\u76f8\u5bf9\u4e8e\u5367\u63a8\u7684\u7a33\u5b9a\u6027\u8bad\u7ec3', [S(0, 20)]),
    A('s3', '\u786c\u62c9', [S(180, 3)]),
    A('s4', '\u5212\u8239', [S(70, 10)]),
    A('s5', '\u5f15\u4f53\u5411\u4e0a', [S(0, 15)])
  ]
};
const stressLogs = [stressLog, { date: dAgo(5), actions: stressLog.actions.map(a => A(a.id, a.name, [S(1, 1)])) }];
const stress = shareCard.buildModel({ log: stressLog, logsDesc: stressLogs, idx: 0 });
const r2r = scanLayout(stress);
eq('D1 压力样本（长名称/5 动作/破纪录条）：无越界', r2r.oob, []);
eq('D2 压力样本：色对仍在白名单', r2r.unknownPair, []);
isTrue('D4 长动作名被截断而不是溢出', r2r.L.ops.some(o => o.t === 'text' && o.s.slice(-1) === '\u2026'));
isTrue('D4 压力样本比常规卡更高（有纪录条）', r2r.L.h > r1.L.h);

// 高度自适应：结论 1 行 vs 2 行必须给出不同高度，否则要么留白要么压字
const oneLine = shareCard.layout(Object.assign({}, m, { verdict: '\u53ea\u7ec3\u4e86\u4e00\u4e2a\u52a8\u4f5c' }));
const twoLine = shareCard.layout(Object.assign({}, m, {
  verdict: '\u5171\u540c\u52a8\u4f5c\u5bb9\u91cf\u6bd4\u4e0a\u573a +96%\uff0c\u5f3a\u5ea6\u9002\u4e2d\uff0c\u7a33\u6b65\u63a8\u8fdb\u5373\u53ef\uff0c\u4e0b\u6b21\u53ef\u4ee5\u5c1d\u8bd5\u52a0\u91cd 2.5kg \u770b\u770b\u53cd\u5e94'
}));
isTrue('D5 2 行结论比 1 行结论高', twoLine.h > oneLine.h);
isTrue('D5 结论最多 2 行',
  twoLine.ops.filter(o => o.t === 'text' && o.bg === P.brand && o.size === shareCard.FONT_SIZE.verdict).length <= 2);

// 无纪录条 vs 有纪录条：高度不同（不画空占位）
const noPb = shareCard.layout(Object.assign({}, m, { pbs: [], rows: m.rows.map(r => Object.assign({}, r, { isPb: false })) }));
isTrue('D5 无纪录条的卡片更矮', noPb.h < r1.L.h);
eq('D5 无纪录条时不画「新」徽标', noPb.ops.filter(o => o.t === 'text' && o.s === '\u65b0').length, 0);

eq('D6 CARD_W 为 750（设计稿 rpx 口径）', shareCard.CARD_W, 750);
eq('D6 所有 rect 都在卡片宽度内', r1.L.ops.filter(o => o.t === 'rect').every(o => o.x >= 0 && o.x + o.w <= shareCard.CARD_W), true);

/* ============ [E] 接线：用 stub 跑真实组件处理器，真跑到出图 ============ */
console.log('\n[E] \u63a5\u7ebf \u2014\u2014 stub wx \u8dd1\u771f\u5b9e\u7ec4\u4ef6\u5904\u7406\u5668\uff0c\u76f4\u5230\u4ea7\u51fa\u56fe\u7247\u8def\u5f84');

function makeCtx() {
  const ctx = { calls: [], fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '' };
  ['clearRect', 'fillRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'fill', 'stroke'].forEach(n => {
    ctx[n] = function () { ctx.calls.push({ n, a: Array.prototype.slice.call(arguments) }); };
  });
  ctx.fillText = function (s, x, y) {
    ctx.calls.push({ n: 'fillText', s, x, y, font: ctx.font, fillStyle: ctx.fillStyle, align: ctx.textAlign });
  };
  return ctx;
}
function makeCanvas() { const ctx = makeCtx(); return { width: 0, height: 0, _ctx: ctx, getContext: () => ctx }; }

const W = {
  toasts: [], modals: [], shareCalls: [], savedCalls: [], openSettingCalls: 0,
  node: null, exportFail: false, hasShareApi: true,
  showToast(o) { W.toasts.push(o); },
  showModal(o) { W.modals.push(o); },
  showShareImageMenu(o) { W.shareCalls.push(o); if (W.shareFail) o.fail(W.shareFail); },
  saveImageToPhotosAlbum(o) { W.savedCalls.push(o); if (W.saveFail) o.fail(W.saveFail); else o.success && o.success({}); },
  openSetting() { W.openSettingCalls++; },
  createSelectorQuery() {
    const q = {
      in() { return q; }, select(sel) { q._sel = sel; return q; },
      fields() { return q; }, boundingClientRect() { return q; },
      exec(cb) { cb([{ node: W.node, width: 375, height: 550 }]); }
    };
    return q;
  },
  canvasToTempFilePath(o) { W.lastExport = o; if (W.exportFail) o.fail({ errMsg: 'fail' }); else o.success({ tempFilePath: '/tmp/share-card.png' }); }
};
W.reset = () => { W.toasts = []; W.modals = []; W.shareCalls = []; W.savedCalls = []; W.openSettingCalls = 0;
  W.exportFail = false; W.shareFail = null; W.saveFail = null; W.node = makeCanvas(); };

global.wx = W;
const fakeApp = {
  globalData: { trainingPlans: [], trainingLogs: [], activePlanId: '', selectedActions: [], meals: [], weightRecords: [], customActions: [], profile: { fitnessDays: 0, weeklyTarget: 3 } },
  persist() {}
};
global.getApp = () => fakeApp;

let SPEC = null;
global.Component = (spec) => { SPEC = spec; };
require(path.join(ROOT, 'components', 'training-review', 'training-review.js'));
isTrue('E0 真实组件已加载', !!SPEC && !!SPEC.methods && !!SPEC.data);

// setData 必须真的回调 —— 组件靠回调触发绘制，stub 吞掉回调会让测试假绿
const mkInst = () => Object.assign({}, SPEC.methods, {
  data: JSON.parse(JSON.stringify(SPEC.data)),
  setData(patch, cb) { Object.keys(patch || {}).forEach(k => { this.data[k] = patch[k]; }); if (typeof cb === 'function') cb(); }
});

fakeApp.globalData.trainingLogs = logs;
const I1 = mkInst();
I1.rebuild();
eq('E1 组件读到 3 场', I1.data.logsCount, 3);

W.reset();
I1.openShareCard();
isTrue('E2 弹层已打开', I1.data.shareShow === true);
isFalse('E2 生成完成后 busy 归位 false', I1.data.shareBusy);
eq('E2 得到了临时图片路径', I1.data.shareImg, '/tmp/share-card.png');
isTrue('E2 画布 backing store 宽 = CARD_W', W.node.width === shareCard.CARD_W);
isTrue('E2 画布高 = measure()（与版式同一函数）', W.node.height === shareCard.measure(shareCard.buildModel({ log: logs[0], logsDesc: logs, idx: 0 })));
isTrue('E3 真的画了字（fillText 被调用）', W.node._ctx.calls.filter(c => c.n === 'fillText').length > 0);
isTrue('E3 真的铺了底色（fillRect 被调用）', W.node._ctx.calls.some(c => c.n === 'fillRect'));
isTrue('E3 画出的文字数量与版式 ops 对得上',
  W.node._ctx.calls.filter(c => c.n === 'fillText').length ===
  shareCard.layout(shareCard.buildModel({ log: logs[0], logsDesc: logs, idx: 0 })).ops.filter(o => o.t === 'text').length);
isTrue('E3 画布被清过（不留上一次的残影）', W.node._ctx.calls.some(c => c.n === 'clearRect'));

// 画布节点拿不到 → 必须关弹层并提示，不能静默留一个「正在生成…」
W.reset(); W.node = null;
const I2 = mkInst(); I2.rebuild(); I2.openShareCard();
isFalse('E5 拿不到画布节点 → 关闭弹层', I2.data.shareShow);
isFalse('E5 拿不到画布节点 → 回到非 busy', I2.data.shareBusy);
eq('E5 拿不到画布节点 → 有提示', W.toasts.length, 1);

// 导出失败 → 同样给反馈
W.reset(); W.exportFail = true;
const I3 = mkInst(); I3.rebuild(); I3.openShareCard();
isFalse('E6 导出失败 → 关闭弹层', I3.data.shareShow);
eq('E6 导出失败 → 有提示', W.toasts.length, 1);
eq('E6 导出失败 → 不留下半成品图片', I3.data.shareImg, '');

// 无日志 → 只提示，不开弹层
W.reset();
const I4 = mkInst();
I4.rebuild();
I4._logs = [];
I4.openShareCard();
isFalse('E7 无场次 → 不开弹层', I4.data.shareShow);
eq('E7 无场次 → 有提示', W.toasts.length, 1);

// 分享：能力缺失时必须给出真实替代，而不是假装分享成功
W.reset();
const I5 = mkInst(); I5.rebuild(); I5.openShareCard();
W.toasts = [];
I5.shareShareCard();
eq('E8 有分享接口 → 调用 showShareImageMenu', W.shareCalls.length, 1);
eq('E8 传入的是生成的临时图路径', W.shareCalls[0].path, '/tmp/share-card.png');
eq('E8 显式要求带小程序入口', W.shareCalls[0].needShowEntrance, true);
eq('E8 分享成功不弹提示', W.toasts.length, 0);

W.reset();
const I6 = mkInst(); I6.rebuild(); I6.openShareCard();
W.toasts = []; W.modals = [];
const savedApi = W.showShareImageMenu;
delete W.showShareImageMenu;               // 模拟低版本微信
I6.shareShareCard();
eq('E9 无分享接口 → 弹说明而不是静默', W.modals.length, 1);
isTrue('E9 说明里给出「保存到相册」这条真实路径', /相册/.test(W.modals[0].confirmText + W.modals[0].content));
W.showShareImageMenu = savedApi;

// 用户主动关掉分享面板 → 不该弹提示打扰
W.reset();
const I7 = mkInst(); I7.rebuild(); I7.openShareCard();
W.toasts = []; W.shareFail = { errMsg: 'showShareImageMenu:fail cancel' };
I7.shareShareCard();
eq('E10 用户取消分享 → 不弹提示', W.toasts.length, 0);

W.reset();
const I8 = mkInst(); I8.rebuild(); I8.openShareCard();
W.toasts = []; W.shareFail = { errMsg: 'showShareImageMenu:fail system error' };
I8.shareShareCard();
eq('E10 分享真失败 → 给提示', W.toasts.length, 1);

// 保存相册：权限被拒必须走设置页（重试无用）
W.reset();
const I9 = mkInst(); I9.rebuild(); I9.openShareCard();
W.toasts = []; W.saveFail = { errMsg: 'saveImageToPhotosAlbum:fail auth deny' };
I9.saveShareCard();
eq('E11 权限被拒 → 弹设置引导', W.modals.length, 1);
eq('E11 权限被拒 → 不误报成功', W.toasts.length, 0);
W.modals[0].success({ confirm: true });
eq('E11 点「去设置」→ 调 openSetting', W.openSettingCalls, 1);

W.reset();
const I10 = mkInst(); I10.rebuild(); I10.openShareCard();
W.toasts = []; W.saveFail = { errMsg: 'saveImageToPhotosAlbum:fail cancel' };
I10.saveShareCard();
eq('E11 用户取消保存 → 静默', W.toasts.length + W.modals.length, 0);

W.reset();
const I11 = mkInst(); I11.rebuild(); I11.openShareCard();
W.toasts = [];
I11.saveShareCard();
eq('E11 保存成功 → 提示已保存', W.toasts.length, 1);
isTrue('E11 保存的是同一张图', W.savedCalls[0].filePath === '/tmp/share-card.png');

// 没生成图就点分享/保存 → 提示，不发空请求
W.reset();
const I12 = mkInst(); I12.rebuild();
W.toasts = [];
I12.shareShareCard();
I12.saveShareCard();
eq('E12 未生成图 → 两次都只提示', W.toasts.length, 2);
eq('E12 未生成图 → 不调分享接口', W.shareCalls.length, 0);
eq('E12 未生成图 → 不调保存接口', W.savedCalls.length, 0);

// 关闭弹层要清干净，否则下次打开会先闪一张旧图
W.reset();
const I13 = mkInst(); I13.rebuild(); I13.openShareCard();
I13.closeShare();
eq('E13 关闭后状态全清', [I13.data.shareShow, I13.data.shareBusy, I13.data.shareImg], [false, false, '']);

/* ============ [F] 静态断言：口径不许被抄回调用方 ============ */
console.log('\n[F] \u9759\u6001\u65ad\u8a00 \u2014\u2014 \u9632\u6b62\u53e3\u5f84\u88ab\u6284\u56de\u7b2c\u4e8c\u4efd');
const TR = 'components/training-review/training-review.js';
const SC = 'utils/shareCard.js';
isTrue('F1 组件不再自定义 fmtW', !/function\s+fmtW|const\s+fmtW/.test(readCode(TR)));
isTrue('F1 组件不再自定义 fmtVol', !/function\s+fmtVol|const\s+fmtVol/.test(readCode(TR)));
isTrue('F2 组件不再自己算 chip（无 DELTA_SESSION 比较）', !/DELTA_SESSION/.test(readCode(TR)));
isTrue('F2 组件委派 stats.sessionChip', has(TR, 'stats.sessionChip('));
isTrue('F3 组件的 buildRecords 只做委派', /buildRecords\(logsDesc\)\s*\{[\s\S]{0,240}?stats\.buildRecords\(logsDesc\)/.test(readCode(TR)));
isFalse('F3 组件不再自己实现纪录排行', /rec\.score\s*=\s*score/.test(readCode(TR)));
isTrue('F4 分享卡模块不依赖 wx / store（纯逻辑，可 node 直跑）',
  !/\bwx\./.test(readCode(SC)) && !/require\(['"][^'"]*store/.test(readCode(SC)));
isTrue('F4 分享卡只依赖 trainingStats / dateRange',
  (readCode(SC).match(/require\(/g) || []).length === 2);
isTrue('F5 记录页的 onShareAppMessage 不再是空实现', !/onShareAppMessage\(\)\s*\{\s*\}/.test(readCode('pages/list/list.js')));
isTrue('F5 记录页给出真实分享路径', has('pages/list/list.js', "path: '/pages/list/list'"));
isTrue('F5 复盘页也实现了 onShareAppMessage', /onShareAppMessage\(\)\s*\{[\s\S]{0,120}?return\s*\{/.test(readCode('pages/review/review.js')));
isFalse('F6 分享弹层不用 opacity:0 藏原生画布', /sc-canvas[^}]*opacity/.test(readCode('components/training-review/training-review.wxss')));
isTrue('F6 画布由 wx:if 控制挂载', /canvas\s+wx:if=/.test(readCode('components/training-review/training-review.wxml')));
isFalse('F7 分享弹层文字不用 --n-500 / --text-weak（P2-9 盲区色）',
  /\.sc-(tip|busy)\s*\{[^}]*var\(--(n-500|text-weak)\)/.test(readCode('components/training-review/training-review.wxss')));

/* ============ [G] 校准：尺子必须能看见已知坏样本 ============ */
console.log('\n[G] \u6821\u51c6 \u2014\u2014 \u5148\u8bc1\u660e\u5c3a\u5b50\u80fd\u770b\u89c1\u5df2\u77e5\u574f\u6837\u672c');
isTrue('G1 对比度函数能认出坏样本 #A0A0A0 on #F7F7F5 < 4.5', r2(contrast('#A0A0A0', '#F7F7F5')) < 4.5);
isTrue('G1 对比度函数能认出坏样本 #FFFFFF on #C8FF00 < 4.5', r2(contrast('#FFFFFF', '#C8FF00')) < 4.5);
isTrue('G1 对比度函数对好样本给高分 #0A0A0A on #FFFFFF > 15', r2(contrast('#0A0A0A', '#FFFFFF')) > 15);
isTrue('G1 Δ 判据能认出同色块（Δ = 0）', delta('#1E1E1E', '#1E1E1E') === 0);

// 越界检测器本身不能是恒绿的空转
function scanOpsOnly(ops, w, h) {
  const oob = [];
  ops.forEach((o, i) => {
    if (o.t === 'text') { const b = textBox(o); if (b.x0 < -0.01 || b.x1 > w + 0.01) oob.push(i); }
    else if (o.t === 'rect' && (o.x < -0.01 || o.x + o.w > w + 0.01)) oob.push(i);
  });
  return oob;
}
eq('G2 越界检测器对良样本返回空', scanOpsOnly(r1.L.ops, r1.L.w, r1.L.h), []);
eq('G2 越界检测器能抓出人为越界（右越界 rect + 左对齐文字）',
  scanOpsOnly([{ t: 'rect', x: 700, y: 0, w: 200, h: 10 }, { t: 'text', s: 'x', size: 30, x: 740, align: 'left', y: 0 }], shareCard.CARD_W, 100).length, 2);
eq('G2 右对齐文字盒被正确折算（x=740 右对齐、宽 37 → 起点 703，不越界）',
  scanOpsOnly([{ t: 'text', s: 'ab', size: 30, x: 740, align: 'right', y: 0 }], shareCard.CARD_W, 100).length, 0);

// 剥注释器自身也要校准：既不能是空转（漏剥 → 自伤报错），
// 也不能剥过头（把真代码连注释一起吃掉 → 假绿）。
isTrue('G3 剥注释器确实剥掉了块注释里的反面样例',
  !/onShareAppMessage\(\)\s*\{\s*\}/.test(stripComments('// onShareAppMessage() {}\nvar a = 1;')));
isTrue('G3 剥注释器确实剥掉了行注释里的反面样例',
  !/onShareAppMessage\(\)\s*\{\s*\}/.test(stripComments('/* onShareAppMessage() {} */\nvar a = 1;')));
isTrue('G3 剥注释器不误伤真代码（空实现仍能被抓到）',
  /onShareAppMessage\(\)\s*\{\s*\}/.test(stripComments('onShareAppMessage() {}')));
isTrue('G3 剥注释器不误伤 https:// 这类含 // 的字面量',
  stripComments("var u = 'https://x.dev/a';").indexOf('https://x.dev/a') >= 0);

/* ============ [H] 解剖图纯数据契约 + 动作库 target 全覆盖 ============ */
// 分享卡要画解剖图（参考图的主视觉）。能不能画不重要，能不能**在 node 里断言**才重要 ——
// 所以 bodymap 必须暴露「纯数据」的 bodyPaths()，而不是只能直接往 canvas 上画。
// 同时锁死一条本轮修掉的真缺陷：动作库 target 里有 6 个值在图集里没有同名 slug。
console.log('\n[H] \u89e3\u5256\u56fe \u2014\u2014 \u8def\u5f84\u662f\u7eaf\u6570\u636e\uff0c\u4e14\u6bcf\u4e2a target \u90fd\u80fd\u843d\u5230\u808c\u7fa4');
const bm = require(ROOT + '/utils/bodymap.js');
const BM_DATA = require(ROOT + '/utils/bodymap-data.js');
const EX = require(ROOT + '/utils/exercises.js');

const sidesOf = (arr) => arr.reduce((s, p) =>
  s + (p.path.common || []).length + (p.path.left || []).length + (p.path.right || []).length, 0);

const bf = bm.bodyPaths('front', new Set(['chest']));
const bb = bm.bodyPaths('back', new Set(['upper-back']));
eq('H1 前视段数 = 数据侧段数', bf.parts.length, sidesOf(BM_DATA.FRONT));
eq('H2 后视段数 = 数据侧段数', bb.parts.length, sidesOf(BM_DATA.BACK));
isTrue('H2 前视坐标 724×1448', bf.vw === 724 && bf.vh === 1448);
eq('H2 后视需 x 偏移 -724（back 路径整体 +724）', bb.xOffset, -724);
eq('H2 前视无偏移', bf.xOffset, 0);
isTrue('H3 每段自带 d/fill/stroke/lw（纯数据，几何可直接断言）',
  bf.parts.every(p => typeof p.d === 'string' && p.d.length > 10 && !!p.fill && !!p.stroke && p.lw === 2));
eq('H3 activeCount = 该肌群在图中的段数（胸左右各一）', bf.activeCount, 2);
isTrue('H3 未激活用静默灰、激活用亮绿',
  bf.parts.find(p => p.slug === 'abs').fill === bm.BODY_COLORS.base &&
  bf.parts.find(p => p.slug === 'chest').fill === bm.BODY_COLORS.on);
isTrue('H4 bodymap 不依赖 wx（纯几何，可 node 直跑）', !/\bwx\./.test(readCode('utils/bodymap.js')));

// —— 动作库 target 全覆盖（本轮修的真缺陷，防它再漏回来）——
const targets = {};
Object.keys(EX.library).forEach(cat => EX.library[cat].forEach(a => { targets[a.target] = 1; }));
const tk = Object.keys(targets);
isTrue('H5 动作库 target 取值数 ≥ 18（现 ' + tk.length + ' 个）', tk.length >= 18);
eq('H5 每个 target 都能映射到 slug（曾漏 delts/upper back/spine/abductors/serrated/levator）',
  tk.filter(k => !bm.SLUG[String(k).toLowerCase()]), []);
const mappedSlugs = Array.from(new Set(tk.map(k => bm.SLUG[String(k).toLowerCase()])));
eq('H5 映射结果都真实存在于图集（前/后视之一）',
  mappedSlugs.filter(s => !bm.FRONT_SLUGS.has(s) && !bm.BACK_SLUGS.has(s)), []);

const allEx = [];
Object.keys(EX.library).forEach(cat => { EX.library[cat].forEach(a => allEx.push(a)); });
eq('H6 没有「一个肌群都点不亮」的动作', allEx.filter(a => bm.collectSlugs(a).size === 0).length, 0);
eq('H6 没有「主练肌群标不出」的动作（此前 262 个 / 20.2%）',
  allEx.filter(a => !bm.primarySlugOf(a)).length, 0);

// —— drawBody 仍按原调用序列作画（bodyPaths 抽取不许改变任何现有页面的渲染）——
function mkRecCtx() {
  const calls = [];
  const bare = (k) => () => { calls.push(k); };
  const args = (k) => (...a) => { calls.push(k + '(' + a.join(',') + ')'); };
  return {
    calls, fillStyle: '', strokeStyle: '', lineWidth: 0,
    save: bare('save'), restore: bare('restore'), scale: args('scale'), translate: args('translate'),
    clearRect: args('clearRect'), beginPath: bare('beginPath'), closePath: bare('closePath'),
    moveTo: bare('moveTo'), lineTo: bare('lineTo'), bezierCurveTo: bare('bezierCurveTo'),
    quadraticCurveTo: bare('quadraticCurveTo'), arcTo: bare('arcTo'), arc: bare('arc'),
    fill: bare('fill'), stroke: bare('stroke')
  };
}
const cnt = (arr, k) => arr.filter(x => x === k).length;
const c1 = mkRecCtx(); bm.drawBody({ width: 300, height: 600 }, c1, 'front', new Set(['chest']));
eq('H7 beginPath 次数 = 1 轮廓 + N 肌段', cnt(c1.calls, 'beginPath'), 1 + bf.parts.length);
eq('H7 fill 次数 = beginPath 次数', cnt(c1.calls, 'fill'), 1 + bf.parts.length);
eq('H7 stroke 次数 = beginPath 次数', cnt(c1.calls, 'stroke'), 1 + bf.parts.length);
eq('H7 save / restore 成对', [cnt(c1.calls, 'save'), cnt(c1.calls, 'restore')], [1, 1]);
isTrue('H7 真的画了曲线（bezierCurveTo 被调用）', cnt(c1.calls, 'bezierCurveTo') > 0);
const c2 = mkRecCtx(); bm.drawBody({ width: 300, height: 600 }, c2, 'back', new Set());
eq('H7 先 clearRect（不被上帧残留污染）', c2.calls[0], 'clearRect(0,0,300,600)');
isTrue('H7 后视图带 translate(-724,0)', c2.calls.indexOf('translate(-724,0)') >= 0);
isTrue('H7 画布尺寸为 0 时直接返回（不抛异常）',
  (() => { const c = mkRecCtx(); bm.drawBody({ width: 0, height: 0 }, c, 'front', new Set()); return c.calls.length === 0; })());

// —— 校准：上面这些判据自己不能是恒绿空转 ——
const fakeTargets = ['pectorals', 'delts', 'not-a-real-muscle'];
eq('H8 校准：覆盖检查器能抓出未映射值', fakeTargets.filter(k => !bm.SLUG[k]), ['not-a-real-muscle']);
isTrue('H8 校准：段数判据能区分前/后视（' + sidesOf(BM_DATA.FRONT) + ' ≠ ' + sidesOf(BM_DATA.BACK) + '）',
  sidesOf(BM_DATA.FRONT) !== sidesOf(BM_DATA.BACK));
isTrue('H8 校准：activeCount 判据能区分「点了」与「没点」',
  bm.bodyPaths('front', new Set()).activeCount === 0 && bf.activeCount === 2);

console.log('\n--------------------------------------------------------');
console.log('share-card: pass=' + pass + '  fail=' + fail);
if (fail) { console.log('存在失败断言'); process.exit(1); }
console.log('全部通过 \u2713');

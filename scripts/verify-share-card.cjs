#!/usr/bin/env node
/**
 * verify-share-card.cjs —— 训练分享卡（B2）回归（零依赖）
 *
 * 为什么需要这个脚本：
 *   1. 分享卡是 **canvas 画出来的**，而 `verify-dark-theme.cjs` 只读 WXSS ——
 *      卡片上的每一个「字色 / 底色」组合都不在任何样式门禁的覆盖范围内。
 *      画错了（比如用了 #A0A0A0 那种浅灰）门禁一样全绿，只有这里能拦住。
 *      调色板有**两套**（浅色 / 深色），所以每个色对都要**逐套**验，不能只验默认那套。
 *   2. 版式是几何问题：文案长了会不会压出卡片边界、五栏会不会互相压、引线会不会飞到画布外，
 *      肉眼看代码看不出来，但用 ops 坐标算得出来。
 *   3. 出图链路（`wx:if` 画布 → createSelectorQuery → canvasToTempFilePath）只靠
 *      「模块单测通过」证明不了 —— 必须用 stub 跑一遍**真实组件处理器**。
 *   4. 三个开关（隐藏训练内容 / 合并当天 / 换样式）必须是**真实能力**：
 *      每次切换都要真的重建模型并重新出图，而不是只把一个布尔值存进 data。
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

const shareCard = require(path.join(ROOT, 'utils', 'shareCard.js'));
const stats = require(path.join(ROOT, 'utils', 'trainingStats.js'));
const dateRange = require(path.join(ROOT, 'utils', 'dateRange.js'));

const PALETTES = shareCard.PALETTES;
const STYLES = shareCard.STYLE_KEYS;
const DEMO = require(path.join(ROOT, 'scripts', 'lib', 'sharecard-demo.cjs'));

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

/* ============ [A] 两套调色板：逐个色对验 AA ============ */

// 卡片里允许出现的「字色 on 底色」组合。新增文字样式必须同时加进这张表，
// 否则下面「未验证色对」检查会红 —— 这是刻意的。
const AA_PAIRS = [
  ['ink', 'bg', '\u4e3b\u6587\u5b57 on \u9875\u9762\u5e95'],
  ['ink', 'card', '\u4e3b\u6587\u5b57 on \u5361\u7247'],
  ['ink', 'accBg', '\u7ed3\u8bba\u6761\u6587\u5b57 on \u7ed3\u8bba\u6761\u5e95'],
  ['sub', 'bg', '\u6b21\u7ea7\u5b57 on \u9875\u9762\u5e95'],
  ['sub', 'card', '\u6b21\u7ea7\u5b57 on \u5361\u7247'],
  ['chipInk', 'chipBg', '\u4e2d\u6027\u80f6\u56ca\u5e95\u4e0a\u7684\u5b57'],
  ['flatFg', 'flatBg', '\u6301\u5e73 chip'],
  ['upFg', 'upBg', '\u4e0a\u5347 chip'],
  ['downFg', 'downBg', '\u4e0b\u964d chip'],
  ['brandInk', 'brand', '\u4eae\u7eff\u5b9e\u5e95\u4e0a\u7684\u5b57\uff08\u94c1\u5f8b\uff09'],
  ['brand', 'brandInk', '\u4eae\u7eff\u5b57\u538b\u6df1\u5e95\uff08\u7eaa\u5f55\u6761\u5fbd\u6807\uff0c\u53cd\u767d\uff09']
];

// 卡内子块必须能看出边界（Δ ≥ 10）。
// 刻意**不**列「边框 vs 胶囊底」：那对只差 8~10，而它外层已经和卡底差 ≥ 17，
// 边界靠的是「胶囊底 vs 卡底」这一对 —— 把装饰性描边也拉进判据只会产生假警报。
const DELTA_PAIRS = [
  ['card', 'bg', '\u5361\u7247 vs \u9875\u9762\u5e95'],
  ['border', 'card', '\u8fb9\u6846 vs \u5361\u7247'],
  ['chipBg', 'card', '\u4e2d\u6027\u80f6\u56ca\u5e95 vs \u5361\u7247'],
  ['flatBg', 'card', '\u6301\u5e73 chip vs \u5361\u7247'],
  ['upBg', 'card', '\u4e0a\u5347 chip vs \u5361\u7247'],
  ['accBg', 'card', '\u7ed3\u8bba\u6761\u5e95 vs \u5361\u7247'],
  ['anat.on', 'anat.base', '\u6fc0\u6d3b\u808c\u8089 vs \u672a\u6fc0\u6d3b\uff08\u770b\u4e0d\u51fa\u5c31\u767d\u753b\u4e86\uff09'],
  ['anat.base', 'anat.outlineFill', '\u808c\u8089 vs \u8eab\u4f53\u8f6e\u5ed3\uff08\u5426\u5219\u662f\u4e00\u5768\u7070\uff09']
];

const palPaths = (obj) => Object.keys(obj).reduce((acc, k) => {
  const v = obj[k];
  if (v && typeof v === 'object') Object.keys(v).forEach(k2 => { acc[k + '.' + k2] = v[k2]; });
  else acc[k] = v;
  return acc;
}, {});

const palFlat = {};
STYLES.forEach(s => { palFlat[s] = palPaths(PALETTES[s]); });
const getPal = (flat, key) => flat[key];

console.log('\n[A] \u5361\u7247\u914d\u8272 \u2014\u2014 canvas \u4e0d\u5728 CSS \u95e8\u7981\u8986\u76d6\u5185\uff0c\u4e24\u5957\u8c03\u8272\u677f\u9010\u4e2a\u8272\u5bf9\u9a8c AA');
console.log('  \u00b7 \u8c03\u8272\u677f = ' + STYLES.join(' / ') + '\uff08\u5916\u89c2\u4e0d\u8ddf\u968f App \u4e3b\u9898\uff0c\u53ea\u770b\u7528\u6237\u663e\u5f0f\u9009\u7684\u6837\u5f0f\uff09');

STYLES.forEach(st => {
  const flat = palFlat[st];
  const name = PALETTES[st].name;
  let minPair = 99;
  AA_PAIRS.forEach(([fg, bg, label]) => {
    const f = getPal(flat, fg), b = getPal(flat, bg);
    const v = r2(contrast(f, b));
    if (v < minPair) minPair = v;
    isTrue('A1[' + name + '] ' + label + ' ' + f + ' on ' + b + ' = ' + v + ':1 \u2265 AA 4.5', v >= 4.5);
  });
  console.log('  \u00b7 [' + name + '] \u5168\u8868\u6700\u5c0f\u5bf9\u6bd4\u5ea6 = ' + minPair + ':1');

  // 铁律：亮绿底上必须是深字。亮绿是全库唯一不随主题翻转的色，白字压亮绿只有 1.6:1。
  eq('A2[' + name + '] 亮绿实底的文字色固定为 #0A0A0A', flat.brandInk, '#0A0A0A');
  isTrue('A3[' + name + '] 亮绿底 + 深字 \u2265 7:1\uff08\u8fdc\u597d\u4e8e AA\uff0c\u5b83\u662f\u89c6\u89c9\u91cd\u5fc3\uff09',
    contrast(flat.brandInk, flat.brand) >= 7);

  // 亮绿当**字色**时必须压足够深的底。
  // 深色板里它被用作「上升 chip」的字色（压深绿底，对比度很高，是合法的）；
  // 浅色板里它只出现在记录条徽标那种反白位。要挡的是「亮绿字压浅底」——
  // 那种组合只有 ~1.05:1，字直接消失。
  isTrue('A4[' + name + '] 亮绿当字色时对比度 \u2265 7（压浅底必然隐形）',
    AA_PAIRS.filter(([fg]) => String(flat[fg]).toUpperCase() === '#C8FF00')
      .every(([fg, bg]) => contrast(flat[fg], flat[bg]) >= 7));

  // 报告 P2-9 的盲区色：不要把它搬到卡片上
  const vals = Object.keys(flat).map(k => String(flat[k]).toUpperCase());
  isFalse('A4[' + name + '] 不含 #A0A0A0\uff08--n-500\uff0c\u538b\u6d45\u5e95\u4ec5 2.44:1\uff09', vals.indexOf('#A0A0A0') >= 0);
  isFalse('A4[' + name + '] 不含 --text-weak 那类浅灰字（P2-9 盲区）',
    vals.some(v => ['#A0A0A0', '#9E9E9E', '#AAAAAA'].indexOf(v) >= 0));

  // 解剖图：高亮必须与品牌同色（不能有「第二种绿」），线宽必须放大到能看见
  eq('A9[' + name + '] 解剖图高亮色 == 品牌色（全库只有一种亮绿）', flat['anat.on'], flat.brand);
  isTrue('A9[' + name + '] 解剖图线宽 \u2265 6\uff08175px \u5bbd \u00d7 scale 0.24 \u4e0b lw=2 \u53ea\u6709 0.48px\uff0c\u770b\u4e0d\u89c1\uff09',
    Number(flat['anat.lw']) >= 6);

  // 块边界
  DELTA_PAIRS.forEach(([a, b, label]) => {
    const x = getPal(flat, a), y = getPal(flat, b);
    const d = delta(x, y);
    isTrue('A5[' + name + '] ' + label + ' \u0394 = ' + d + ' \u2265 10', d >= 10);
  });
});

// 默认导出仍是浅色（调用方 `shareCard.PALETTE` 的老用法不能悄悄换成深色）
eq('A0 PALETTE 默认 = 浅色', shareCard.PALETTE, PALETTES.light);
isTrue('A0 样式键唯一真源 STYLE_KEYS = ' + JSON.stringify(STYLES),
  STYLES.length >= 2 && STYLES.indexOf('light') >= 0 && STYLES.indexOf('dark') >= 0);

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
isTrue('B3 截断后估算宽度仍 \u2264 上限', shareCard.estWidth(fitted, 28) <= 200);

eq('B4 空串折行返回空数组', shareCard.wrap('', 30, 200, 2), []);
const wrapped = shareCard.wrap(longName, 30, 300, 2);
isTrue('B4 折行不超过 maxLines', wrapped.length <= 2);
isTrue('B4 每行都在宽度内', wrapped.every(l => shareCard.estWidth(l, 30) <= 300));
isTrue('B4 被截断时末行有省略号', wrapped[wrapped.length - 1].slice(-1) === '\u2026');
eq('B5 一行放得下就只有一行', shareCard.wrap('\u4eca\u5929\u7ec3\u5f97\u4e0d\u9519', 30, 300, 2).length, 1);
isTrue('B5 两行内容不被截断', shareCard.wrap('\u4eca\u5929\u7ec3\u5f97\u4e0d\u9519\u54e6\u771f', 30, 160, 2).join('').indexOf('\u2026') < 0);

// 数字不能截断（把 12800 显示成 12… 比换行更糟）→ fitSize 必须缩字号
isTrue('B6 数字放不下时缩字号而不是截断',
  shareCard.fitSize('12800', 36, 72, 22) < 36 && shareCard.estWidth('12800', shareCard.fitSize('12800', 36, 72, 22)) <= 72);
isTrue('B6 缩字号有下限（不会缩到看不清）', shareCard.fitSize('12800', 36, 10, 22) === 22);

/* ============ [C] 内容模型 ============ */
console.log('\n[C] \u5185\u5bb9\u6a21\u578b \u2014\u2014 \u5168\u90e8\u53d6\u81ea trainingStats\uff0c\u4e0d\u81ea\u5df1\u7b97\u4e00\u904d');

const { today, todayLate, bwOnly, LOGS } = DEMO;
const m = shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0 });
isTrue('C1 有内容产出', !!m);

// —— 三个指标：消耗(估算) / 总重量 | 总次数 / 总耗时 ——
eq('C1 3 个指标', m.kpis.length, 3);
isTrue('C1 消耗必须标「估算」（估算值不许伪装成实测）', /\u4f30\u7b97/.test(m.kpis[0].lab));
eq('C1 消耗取 trainingStats.estKcal 单源',
  m.kpis[0].val, String(stats.estKcal(stats.trainSecOfLog(today))));
eq('C1 消耗单位', m.kpis[0].unit, '\u5343\u5361');
eq('C1 总重量标签', m.kpis[1].lab, '\u603b\u91cd\u91cf(kg)');
eq('C1 总重量取 trainingStats.fmtVol 单源', m.kpis[1].val, stats.fmtVol(stats.loadOfLog(today)));
const durSec = stats.durationSecOfLog(today);
eq('C1 总耗时格式 mm:ss', m.kpis[2].val, Math.floor(durSec / 60) + ':' + dateRange.pad2(durSec % 60));

// 纯自重场次：显示「总重量 0 kg」既难看也没信息，必须退化为总次数
const bw = shareCard.buildModel({ log: bwOnly, logsDesc: LOGS, idx: 1 });
eq('C2 纯自重 → 指标改为总次数', [bw.kpis[1].lab, bw.kpis[1].unit], ['\u603b\u6b21\u6570', '\u6b21']);
isTrue('C2 总次数 = 该场实际次数之和（不显示 0）',
  Number(bw.kpis[1].val) > 0 && Number(bw.kpis[1].val) === stats.setsOf(bwOnly.actions[0]).reduce((s, x) => s + stats.num(x.reps), 0) + stats.setsOf(bwOnly.actions[1]).reduce((s, x) => s + stats.num(x.reps), 0));

// 卡片**不**展示 RPE：旧版这里有一格「平均吃力」，未记录时显示 0/10，
// 把「没测」说成了「测出来是 0」。要加回就必须同时处理未记录态。
const rpeTexts = shareCard.layout(m).ops.filter(o => o.t === 'text' && (/\d+\/10/.test(o.s) || /\u5403\u529b/.test(o.s)));
eq('C3 卡片不出现未测量的 RPE 数字（未测 ≠ 0）', rpeTexts.map(o => o.s), []);

// 逐组胶囊
const benchRow = m.rows.filter(r => r.name === '\u6760\u94c3\u5367\u63a8')[0];
isTrue('C3 卧推行存在', !!benchRow);
eq('C3 胶囊数封顶 MAX_CAPS', benchRow.caps.length, Math.min(4, shareCard.MAX_CAPS));
eq('C3 多出的组数用 more 交代（不静默丢）', benchRow.more, 4 - shareCard.MAX_CAPS);
eq('C3 counts 保留真实组数', benchRow.counts, 4);
isTrue('C3 有且只有一个「最好的一组」被标记', benchRow.caps.filter(c => c.best).length <= 1);
isTrue('C3 胶囊文案带重量与次数', /\d/.test(benchRow.caps[0].txt));

// 动作行上限：超出的不能静默丢掉，要用 actionCount / hiddenRows 交代
eq('C4 行数封顶 MAX_ROWS', m.rows.length, shareCard.MAX_ROWS);
eq('C4 总数保留真实值', m.actionCount, 5);
eq('C4 hiddenRows 交代未列出的动作', m.hiddenRows, 5 - shareCard.MAX_ROWS);
eq('C4 MAX_ROWS = 4', shareCard.MAX_ROWS, 4);

// 破纪录：必须与 stats.sessionRecords 是同一把尺子
const pbNames = m.pbs.map(x => x.name).sort();
eq('C5 破纪录集合与 stats.sessionRecords 一致',
  pbNames, stats.sessionRecords(today, LOGS, 0).map(x => x.name).sort());

// 演示数据（09-16 vs 09-14）的卧推**恰好打平**（720 = 720）→ 正确地不算破纪录。
// 所以另造一份确实有破纪录的样本，才能把「纪录条」这条分支真正跑到。
const pbLog = DEMO.log('2026-09-16', [DEMO.act('0025', '\u6760\u94c3\u5367\u63a8', '\u80f8\u90e8', '\u6760\u94c3', [DEMO.set(8, 45, 9)])]);
const pbLogs = [pbLog, DEMO.log('2026-09-12', [DEMO.act('0025', '\u6760\u94c3\u5367\u63a8', '\u80f8\u90e8', '\u6760\u94c3', [DEMO.set(8, 40, 7)])])];
const pbM = shareCard.buildModel({ log: pbLog, logsDesc: pbLogs, idx: 0 });
eq('C5 打平的场次不误报破纪录（720 = 720）', m.pbs, []);
eq('C5 真超过历史 → 记入破纪录', pbM.pbs.length, 1);
isTrue('C5 行上有 isPb 标', pbM.rows.some(r => r.isPb));
isTrue('C5 纪录条带具体数值', pbM.pbs[0].valTxt === '45kg \u00d7 8');

// chip 不自己算：与 stats.sessionChip 逐字一致
eq('C6 行 chip 与 stats.sessionChip 同一份',
  m.rows.map(r => r.chip.text), today.actions.slice(0, shareCard.MAX_ROWS).map(a => stats.sessionChip(a, LOGS, 0).text));

// 连续训练天数：口径取「截至这场训练那天」，不是「截至今天」
const streakLogs = [
  { date: '2026-09-16', actions: [] },
  { date: '2026-09-15', actions: [] },
  { date: '2026-09-14', actions: [] },
  { date: '2026-09-10', actions: [] }
];
const sm = shareCard.buildModel({ log: streakLogs[0], logsDesc: streakLogs, idx: 0 });
eq('C7 连续天数 = 截至该场那天（16/15/14 三天 = 3）', sm.streakDays, 3);
eq('C7 早一场（15 号）只有 2 天 —— 不是「截至今天」', shareCard.buildModel({ log: streakLogs[1], logsDesc: streakLogs, idx: 1 }).streakDays, 2);
eq('C7 与 dateRange.streakFromDates 同源', sm.streakDays,
  dateRange.streakFromDates(new Set(['2026-09-16', '2026-09-15', '2026-09-14', '2026-09-10']), '2026-09-16'));

// —— 三个开关 ——
const noAct = { date: '2026-09-16', actions: [] };
const em = shareCard.buildModel({ log: noAct, logsDesc: [], idx: 0 });
eq('C8 无动作场次 empty = true', em.empty, true);
eq('C8 无动作场次 0 行', em.rows.length, 0);
eq('C8 无 log → null', shareCard.buildModel({ log: null }), null);
eq('C8 无参 → null', shareCard.buildModel(), null);

const merged = shareCard.buildModel({ log: today, logsDesc: [today, todayLate, bwOnly], idx: 0, opts: { merge: true } });
eq('C9 合并当天 → merged = true', merged.merged, true);
eq('C9 合并当天 → 行数 = 两场之和', merged.actionCount, today.actions.length + todayLate.actions.length);
isTrue('C9 合并当天 → 结论文案换成「共 N 场」', /\u5171 2 \u573a/.test(merged.verdict));
isTrue('C9 合并当天 → 总组数按两场累加', merged.totalSets > m.totalSets);
eq('C9 合并当天 → 指标按时长累加（耗时变长）',
  merged.kpis[2].val !== m.kpis[2].val || stats.durationSecOfLog(today) === stats.durationSecOfLog(today) + stats.durationSecOfLog(todayLate), true);
const notMerged = shareCard.buildModel({ log: today, logsDesc: [today, todayLate, bwOnly], idx: 0, opts: { merge: false } });
eq('C9 不开合并 → 仍只有本场', notMerged.actionCount, today.actions.length);
eq('C9 不开合并 → merged = false', notMerged.merged, false);

const hidden = shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { hideContent: true } });
eq('C10 隐藏训练内容 → showActions = false', hidden.showActions, false);
eq('C10 隐藏训练内容 → rows 为空', hidden.rows.length, 0);
eq('C10 隐藏训练内容 → actionCount 仍保留（模型层不撒谎）', hidden.actionCount, 5);
isTrue('C10 隐藏训练内容 → 解剖图仍有点亮的肌群', hidden.anatomy.front.length > 0);
isTrue('C10 隐藏训练内容 → 版式里没有动作行',
  shareCard.layout(hidden).ops.every(o => o.t !== 'text' || o.s.indexOf('\u672c\u573a\u52a8\u4f5c') < 0));

eq('C11 样式 = dark 时模型带 style=dark',
  shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { style: 'dark' } }).style, 'dark');
eq('C11 未知样式回落到浅色',
  shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { style: 'purple' } }).style, 'light');

// 昵称 / 头像：头像走**文字**（首字），不依赖网络图片
const nick = shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { nickname: '\u5c0f\u660e' } });
eq('C12 头像取昵称首字', [nick.nickname, nick.avatarText], ['\u5c0f\u660e', '\u5c0f']);
const noNick = shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { nickname: '   ' } });
eq('C12 无昵称 → 兜底文案与首字', [noNick.nickname, noNick.avatarText], ['\u5065\u8eab\u7528\u6237', 'F']);
const emojiNick = shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { nickname: '\ud83d\udc02\u54e5' } });
eq('C12 emoji 昵称不会被截成半个代理对', emojiNick.avatarText, '\ud83d\udc02');

// 解剖图集合：必须是**数组**（Set 在 JSON 里是 {}，会把整个模型变成不可断言）
isTrue('C13 anatomy 三个字段都是数组（模型可 JSON 序列化）',
  ['front', 'back', 'primary'].every(k => Array.isArray(m.anatomy[k])));
isTrue('C13 卧推点亮了胸（前视）', m.anatomy.front.indexOf('chest') >= 0);
isTrue('C13 胸是「主练肌群」', m.anatomy.primary.indexOf('chest') >= 0);
isTrue('C13 划船点亮了上背（后视）', m.anatomy.back.indexOf('upper-back') >= 0);
eq('C13 模型可 JSON 往返（无 Set / 无循环引用）',
  JSON.parse(JSON.stringify(m)).anatomy, m.anatomy);

/* ============ [D] 版式几何 ============ */

// 把「文字盒」按 align 折算成真实占据的 x 区间 —— 只看 o.x 会漏掉右对齐溢出
function textBox(o) {
  const w = shareCard.estWidth(o.s, o.size);
  let x0 = o.x;
  if (o.align === 'center') x0 = o.x - w / 2;
  if (o.align === 'right') x0 = o.x - w;
  return { x0, x1: x0 + w, y: o.y, h: o.size };
}

const MIN_FONT = 18;   // 设计系统最小字号 18rpx（=9px）；再小就该改设计而不是放宽门禁

function scanLayout(model) {
  const L = shareCard.layout(model);
  const flat = palFlat[(model && model.style) || 'light'];
  const oob = [], unknownPair = [], brandBad = [], imgLike = [];
  const pairKeys = {};
  AA_PAIRS.forEach(([fg, bg]) => { pairKeys[flat[fg] + '|' + flat[bg]] = fg + '/' + bg; });
  const figureCols = {};
  L.ops.forEach(o => { if (o.t === 'body') figureCols[o.side] = { x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.h }; });

  L.ops.forEach((o, i) => {
    if (o.t === 'rect') {
      if (o.x < -0.01 || o.y < -0.01 || o.x + o.w > L.w + 0.01 || o.y + o.h > L.h + 0.01) oob.push(i + ':rect');
      if (o.r && (o.r > o.w / 2 + 0.01 || o.r > o.h / 2 + 0.01)) oob.push(i + ':rect \u5706\u89d2\u8d85\u8fc7\u534a\u5bbd/\u534a\u9ad8');
    } else if (o.t === 'body') {
      // 主视觉是解剖图：只声明一个**子矩形**，几何全在 node 里可算。
      // 一旦有人把主视觉换成图片资源，这里就没有 body op 了 —— [I] 组会红。
      if (o.x < -0.01 || o.y < -0.01 || o.x + o.w > L.w + 0.01 || o.y + o.h > L.h + 0.01) oob.push(i + ':body \u8d8a\u754c');
      if (o.slugs && !Array.isArray(o.slugs)) oob.push(i + ':body slugs \u4e0d\u662f\u6570\u7ec4');
    } else if (o.t === 'line') {
      if (o.x1 < -0.01 || o.x2 > L.w + 0.01 || o.y1 < -0.01 || o.y1 > L.h + 0.01) oob.push(i + ':line');
      // 引线必须落在**它自己那一栏**里。后视图路径 x 整体 +724，
      // 忘了补 xOffset 的引线会整体飞到画布右侧 —— 这条判据专门抓它。
      if (o.kind === 'leader') {
        const c = figureCols[o.side];
        if (!c) oob.push(i + ':leader \u6ca1\u6709\u5bf9\u5e94\u7684\u56fe\u533a');
        else if (o.x2 < c.x0 - 2 || o.x2 > c.x1 + 2) oob.push(i + ':leader(' + o.side + ') \u843d\u5728\u56fe\u533a\u5916 x=' + o.x2.toFixed(1) + ' \u533a\u95f4 [' + c.x0 + ',' + c.x1 + ']');
        else if (o.y2 < c.y0 - 2 || o.y2 > c.y1 + 2) oob.push(i + ':leader(' + o.side + ') \u7eb5\u5411\u843d\u5728\u56fe\u533a\u5916 y=' + o.y2.toFixed(1));
      }
    } else if (o.t === 'circle') {
      if (o.cx - o.r < -0.01 || o.cy - o.r < -0.01 || o.cx + o.r > L.w + 0.01 || o.cy + o.r > L.h + 0.01) oob.push(i + ':circle');
    } else if (o.t === 'text') {
      const b = textBox(o);
      if (b.x0 < -0.01 || b.x1 > L.w + 0.01) oob.push(i + ':text \u6a2a\u5411\u8d8a\u754c ' + b.x0.toFixed(1) + '~' + b.x1.toFixed(1) + ' \u300c' + o.s + '\u300d');
      if (o.y - o.size / 2 < -0.01 || o.y + o.size / 2 > L.h + 0.01) oob.push(i + ':text \u7eb5\u5411\u8d8a\u754c y=' + o.y);
      if (o.size < MIN_FONT) oob.push(i + ':text \u5b57\u53f7 ' + o.size + ' < \u4e0b\u9650 ' + MIN_FONT);
      // 色对白名单：新加一格文字样式必须把色对加进 AA_PAIRS（否则这里红）
      if (!o.bg) unknownPair.push(i + ':text \u672a\u58f0\u660e bg');
      else if (!pairKeys[o.color + '|' + o.bg]) unknownPair.push(i + ':text \u672a\u9a8c\u8bc1\u8272\u5bf9 ' + o.color + ' on ' + o.bg + ' \u300c' + o.s + '\u300d');
      // 铁律：亮绿底上必须是深字
      if (o.bg === flat.brand && o.color !== flat.brandInk) brandBad.push(i + ':text \u4eae\u7eff\u5e95\u4e0a\u7528\u4e86\u975e\u6df1\u5b57 ' + o.color);
      // 卡片里不该出现的图片/资源路径（主视觉走纯路径，见 [I]）
      if (/\.(png|jpe?g|webp|gif|svg)\b/i.test(String(o.s))) imgLike.push(i + ':text ' + o.s);
    }
  });
  return { L, oob, unknownPair, brandBad, imgLike, figureCols };
}

console.log('\n[D] \u7248\u5f0f\u51e0\u4f55 \u2014\u2014 \u4e0d\u8d8a\u754c\u3001\u4e0d\u91cd\u53e0\u3001\u8272\u5bf9\u5728\u767d\u540d\u5355\u5185');

const r1 = scanLayout(m);
eq('D1 常规卡片：无越界/无重叠图元', r1.oob, []);
eq('D2 常规卡片：所有文字色对都已在白名单', r1.unknownPair, []);
eq('D3 常规卡片：亮绿底上都是深字', r1.brandBad, []);
eq('D3 常规卡片：卡片文本里没有图片路径', r1.imgLike, []);

// —— 全量扫：5 个演示用例 × 2 套调色板 ——
// 逐个组合跑满，而不是只验一个「常规」样本：分支多（无动作 / 纯自重 / 合并 / 隐藏内容）
// 且每套调色板的色对白名单不同，只验一套等于漏了一半。
const sweepBad = [];
DEMO.cases().forEach((c, ci) => {
  STYLES.forEach(st => {
    const args = Object.assign({}, c.args, { opts: Object.assign({}, c.args.opts, { style: st }) });
    const model = shareCard.buildModel(args);
    const r = scanLayout(model);
    if (r.oob.length) sweepBad.push(c.title + '[' + st + '] oob: ' + r.oob.join(' | '));
    if (r.unknownPair.length) sweepBad.push(c.title + '[' + st + '] pair: ' + r.unknownPair.join(' | '));
    if (r.brandBad.length) sweepBad.push(c.title + '[' + st + '] brand: ' + r.brandBad.join(' | '));
  });
});
// 再补上「有纪录条 / 合并 + 隐藏 / 空动作」这几个演示用例没覆盖到的组合
[Object.assign({}, pbM, { style: 'light' }), Object.assign({}, pbM, { style: 'dark' }),
  Object.assign({}, m, { style: 'dark' }),
  shareCard.buildModel({ log: today, logsDesc: [today, todayLate, bwOnly], idx: 0, opts: { merge: true, hideContent: true, style: 'dark' } }),
  shareCard.buildModel({ log: { date: '2026-09-16', actions: [] }, logsDesc: [], idx: 0, opts: { style: 'dark' } })
].forEach((model, i) => {
  const r = scanLayout(model);
  if (r.oob.length) sweepBad.push('补充样本' + i + ' oob: ' + r.oob.join(' | '));
  if (r.unknownPair.length) sweepBad.push('补充样本' + i + ' pair: ' + r.unknownPair.join(' | '));
  if (r.brandBad.length) sweepBad.push('补充样本' + i + ' brand: ' + r.brandBad.join(' | '));
});
eq('D1 演示用例 \u00d7 两套调色板：全部无越界/无色对缺口/亮绿底全深字', sweepBad, []);

// 极长内容（长动作名 + 长结论 + 有纪录条）也不能越界 —— 这才是版式真正的压力测试
const stress = Object.assign({}, today, {
  actions: [
    DEMO.act('0025', '\u53cc\u624b\u54d1\u94c3\u5355\u81c2\u5f00\u624b\u6df1\u8e72\u4e0e\u8df3\u8dc3\u7ec4\u5408\u8bad\u7ec3', '\u80f8\u90e8', '\u6760\u94c3', [DEMO.set(12, 30, 7)]),
    DEMO.act('0043', '\u7ad9\u59ff\u6760\u94c3\u63a8\u4e3e\u76f8\u5bf9\u4e8e\u5367\u63a8\u7684\u7a33\u5b9a\u6027\u8bad\u7ec3', '\u817f\u90e8', '\u6760\u94c3', [DEMO.set(8, 70, 9)]),
    DEMO.act('0652', '\u5f15\u4f53\u5411\u4e0a', '\u80cc\u90e8', '\u81ea\u91cd', [DEMO.set(8, 0, 8)]),
    DEMO.act('0027', '\u6760\u94c3\u4fef\u8eab\u5212\u8239', '\u80cc\u90e8', '\u6760\u94c3', [DEMO.set(12, 40, 7)]),
    DEMO.act('0031', '\u6760\u94d3\u5f2f\u4e3e\u4e0e\u9524\u5f0f\u5f2f\u4e3e\u8d85\u7ea7\u7ec4\u8bad\u7ec3', '\u624b\u81c2', '\u6760\u94c3', [DEMO.set(12, 20, 7)])
  ]
});
const stressM = shareCard.buildModel({ log: stress, logsDesc: [stress].concat(LOGS), idx: 0 });
const rs = scanLayout(stressM);
eq('D1 压力样本（长名称/5 动作/破纪录条）：无越界', rs.oob, []);
eq('D2 压力样本：色对仍在白名单', rs.unknownPair, []);
isTrue('D4 长动作名被截断而不是溢出', rs.L.ops.some(o => o.t === 'text' && o.s.slice(-1) === '\u2026'));

// 高度自适应：结论 1 行 vs 2 行必须给出不同高度，否则要么留白要么压字
const oneLine = shareCard.layout(Object.assign({}, m, { verdict: '\u53ea\u7ec3\u4e86\u4e00\u4e2a\u52a8\u4f5c' }));
const twoLine = shareCard.layout(Object.assign({}, m, {
  verdict: '\u5171\u540c\u52a8\u4f5c\u5bb9\u91cf\u6bd4\u4e0a\u573a +96%\uff0c\u5f3a\u5ea6\u9002\u4e2d\uff0c\u7a33\u6b65\u63a8\u8fdb\u5373\u53ef\uff0c\u4e0b\u6b21\u53ef\u4ee5\u5c1d\u8bd5\u52a0\u91cd 2.5kg \u770b\u770b\u53cd\u5e94'
}));
isTrue('D5 2 行结论比 1 行结论高', twoLine.h > oneLine.h);
isTrue('D5 结论最多 2 行',
  twoLine.ops.filter(o => o.t === 'text' && o.bg === palFlat.light.brand && o.size === shareCard.FONT_SIZE.verdict).length <= 2);

// 无纪录条 vs 有纪录条：高度必须不同（不画空占位）。
// 注意要拿**同一个模型**去掉 pbs 来比 —— 拿它跟「5 个动作」的常规卡比高度，
// 比出来的是动作行数差异，跟纪录条没关系（写断言时踩过）。
const withPb = scanLayout(pbM);
const withPbL = withPb.L;
const noPb = shareCard.layout(Object.assign({}, pbM, { pbs: [] }));
isTrue('D5 有纪录条时卡片更高（不是画个空占位）', withPbL.h > noPb.h);
const pbBar = withPbL.ops.filter(o => o.t === 'rect' && o.fill === shareCard.PALETTE.brand && o.w === shareCard.CARD_W_IN);
eq('D5 纪录条是一整张亮绿横条', pbBar.length, 1);
eq('D5 高度差恰好 = 纪录条高 + 卡间距', withPbL.h - noPb.h, pbBar[0].h + 20);
eq('D5 无纪录条时不画「新」徽标', noPb.ops.filter(o => o.t === 'text' && o.s === '\u65b0').length, 0);
eq('D5 有纪录条时画「新」徽标', withPbL.ops.filter(o => o.t === 'text' && o.s === '\u65b0').length, 1);
isTrue('D5 纪录条上的文字压亮绿底 → 必须是深字',
  withPbL.ops.filter(o => o.bg === shareCard.PALETTE.brand).every(o => o.color === shareCard.PALETTE.brandInk));

// 隐藏训练内容 → 卡片更矮（少了一整张动作卡）
isTrue('D5 隐藏训练内容后卡片变矮',
  shareCard.layout(shareCard.buildModel({ log: today, logsDesc: LOGS, idx: 0, opts: { hideContent: true } })).h < r1.L.h);

eq('D6 CARD_W 为 750（设计稿 rpx 口径）', shareCard.CARD_W, 750);
eq('D6 所有 rect 都在卡片宽度内', r1.L.ops.filter(o => o.t === 'rect').every(o => o.x >= 0 && o.x + o.w <= shareCard.CARD_W), true);

// —— 解剖图五栏几何：62+12+175+12+175+12+62+12+116 = 638 = INNER_W ——
const bodies = r1.L.ops.filter(o => o.t === 'body');
eq('D7 前/后两张解剖图各一个 body op', bodies.map(o => o.side).sort(), ['back', 'front']);
isTrue('D7 两栏合计铺满内容宽（62+12+175+12+175+12+62+12+116 = INNER_W）',
  (bodies[1].x + bodies[1].w + 12 + 62 + 12 + 116) === shareCard.INNER_X + shareCard.INNER_W);
isTrue('D7 两张解剖图不重叠（后视图在前视图右侧）', bodies[1].x >= bodies[0].x + bodies[0].w);
isTrue('D7 后视图不与右列指标重叠',
  bodies[1].x + bodies[1].w <= shareCard.INNER_X + shareCard.INNER_W - 116);
isTrue('D7 解剖图同比不拉伸（175:350 = 724:1448）',
  bodies.every(o => Math.abs((o.w / o.h) - (724 / 1448)) < 0.001));
isTrue('D7 解剖图尺寸 = FIG_W × FIG_H（标签栏与它等高，槽位才等距）',
  bodies.every(o => o.w === shareCard.FIG_W && o.h === shareCard.FIG_H));

// —— 引线：数量、方向、落点 ——
const leaders = r1.L.ops.filter(o => o.t === 'line' && o.kind === 'leader');
isTrue('D8 有引线（肌群标签被画出来了）', leaders.length > 0);
isTrue('D8 每条引线都有自己的 side 标（否则无从断言 xOffset 是否补回）',
  leaders.every(o => o.side === 'front' || o.side === 'back'));
isTrue('D8 前视引线指向左（标签在左侧栏），后视引线指向右',
  leaders.filter(o => o.side === 'front').every(o => o.x2 > o.x1) &&
  leaders.filter(o => o.side === 'back').every(o => o.x2 < o.x1));
isTrue('D8 引线端点都在自己那一栏内（后视图忘了补 -724 就会飞出去）',
  leaders.every(o => { const c = r1.figureCols[o.side]; return o.x2 >= c.x0 - 2 && o.x2 <= c.x1 + 2; }));
// NaN 会让上面那条判据**静默失效**（NaN 参与比较永远为 false），所以单独钉一次有限性
isTrue('D8 引线端点都是有限数（NaN 会让越界判据静默变绿）',
  leaders.every(o => isFinite(o.x1) && isFinite(o.y1) && isFinite(o.x2) && isFinite(o.y2)));
isTrue('D8 单侧标签数 \u2264 MAX_LABELS + 1（多出的折成「等 N 处」）',
  leaders.filter(o => o.side === 'front').length <= shareCard.MAX_LABELS &&
  leaders.filter(o => o.side === 'back').length <= shareCard.MAX_LABELS);
// 「等 N 处」分支：肌群多到超过上限时必须给出交代
const manyLabels = shareCard.layout(Object.assign({}, m, {
  anatomy: { front: ['chest', 'biceps', 'triceps', 'forearm', 'abs', 'obliques', 'quadriceps', 'adductors'], back: ['upper-back', 'trapezius', 'lower-back', 'gluteal', 'hamstring', 'calves'], primary: ['chest'] }
}));
isTrue('D8 超过 MAX_LABELS 时折成「等 N 处」而不是静默丢弃',
  manyLabels.ops.some(o => o.t === 'text' && /^\u7b49 \d+ \u5904$/.test(o.s)));
eq('D8 引线数被 MAX_LABELS 封顶', manyLabels.ops.filter(o => o.t === 'line' && o.kind === 'leader').length,
  shareCard.MAX_LABELS * 2);
eq('D8 动作行分隔线仍在（kind=rule）', r1.L.ops.filter(o => o.t === 'line' && o.kind === 'rule').length, shareCard.MAX_ROWS - 1);

/* ============ [E] 接线：用 stub 跑真实组件处理器，真跑到出图 ============ */
console.log('\n[E] \u63a5\u7ebf \u2014\u2014 stub wx \u8dd1\u771f\u5b9e\u7ec4\u4ef6\u5904\u7406\u5668\uff0c\u76f4\u5230\u4ea7\u51fa\u56fe\u7247\u8def\u5f84');

function makeCtx() {
  const ctx = { calls: [], fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '' };
  ['clearRect', 'fillRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'fill', 'stroke',
    'save', 'restore', 'translate', 'scale', 'bezierCurveTo', 'quadraticCurveTo'].forEach(n => {
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
  globalData: {
    trainingPlans: [], trainingLogs: [], activePlanId: '', selectedActions: [], meals: [],
    weightRecords: [], customActions: [], profile: { fitnessDays: 0, weeklyTarget: 3 },
    userInfo: { nickname: '\u5c0f\u660e' }
  },
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

fakeApp.globalData.trainingLogs = DEMO.LOGS;
const I1 = mkInst();
I1.rebuild();
eq('E1 组件读到 4 场', I1.data.logsCount, DEMO.LOGS.length);

W.reset();
I1.openShareCard();
isTrue('E2 弹层已打开', I1.data.shareShow === true);
isFalse('E2 生成完成后 busy 归位 false', I1.data.shareBusy);
eq('E2 得到了临时图片路径', I1.data.shareImg, '/tmp/share-card.png');
isTrue('E2 画布 backing store 宽 = CARD_W', W.node.width === shareCard.CARD_W);
isTrue('E2 画布高 = measure()（与版式同一函数）', W.node.height === shareCard.measure(I1._cardModel));
isTrue('E3 真的画了字（fillText 被调用）', W.node._ctx.calls.filter(c => c.n === 'fillText').length > 0);
isTrue('E3 真的铺了底色（fillRect 被调用）', W.node._ctx.calls.some(c => c.n === 'fillRect'));
isTrue('E3 画出的文字数量与版式 ops 对得上',
  W.node._ctx.calls.filter(c => c.n === 'fillText').length ===
  shareCard.layout(I1._cardModel).ops.filter(o => o.t === 'text').length);
isTrue('E3 画布被清过（不留上一次的残影）', W.node._ctx.calls.some(c => c.n === 'clearRect'));
isTrue('E3 解剖图被真的 translate+scale 到子矩形里（不是画在原点）',
  W.node._ctx.calls.some(c => c.n === 'translate') && W.node._ctx.calls.some(c => c.n === 'scale'));
isTrue('E3 后视图补了 -724 的 x 偏移', W.node._ctx.calls.filter(c => c.n === 'translate').some(c => c.a[0] === -724));
// 解剖图与其它图元分开画：bodyPaths 的坐标在「图集 viewBox」里，必须先 save/translate/scale
// 定位、画完 restore 回来，否则后面所有图元都会被带偏。每张解剖图一对 save/restore。
const bodyOpCount = shareCard.layout(I1._cardModel).ops.filter(o => o.t === 'body').length;
eq('E3 save / restore 与解剖图数量成对（定位不漏出来污染后续图元）',
  [W.node._ctx.calls.filter(c => c.n === 'save').length, W.node._ctx.calls.filter(c => c.n === 'restore').length],
  [bodyOpCount, bodyOpCount]);
isTrue('E3 头像取到 store 里的昵称首字', I1._cardModel.avatarText === '\u5c0f');

// —— 三个开关：必须真的重建模型并重新出图，不是只存一个布尔值 ——
W.reset();
const before1 = shareCard.measure(I1._cardModel);
I1.toggleShareOpt({ currentTarget: { dataset: { k: 'hide' } } });
eq('E4 开关「隐藏训练内容」落到 data', I1.data.shareHide, true);
eq('E4 开关切换后**重新出图了**（真实能力，不是只存布尔值）', I1.data.shareImg, '/tmp/share-card.png');
eq('E4 新的模型确实不带动作了', I1._cardModel.showActions, false);
isTrue('E4 隐藏内容后卡片确实变矮（版式真的重排了）', shareCard.measure(I1._cardModel) < before1);
I1.toggleShareOpt({ currentTarget: { dataset: { k: 'hide' } } });
eq('E4 再切一次恢复', [I1.data.shareHide, I1._cardModel.showActions], [false, true]);

W.reset();
I1.cycleShareStyle();
eq('E5 换样式切到深色', [I1.data.shareStyle, I1.data.shareStyleName], ['dark', '\u6df1\u8272']);
eq('E5 样式真的作用到模型（换调色板，不是换文案）', I1._cardModel.style, 'dark');
eq('E5 画布重画了一遍', W.node._ctx.calls.filter(c => c.n === 'fillText').length > 0, true);
I1.cycleShareStyle();
eq('E5 再切一圈回到浅色（STYLE_KEYS 是唯一真源）', I1.data.shareStyle, 'light');

// 画布节点拿不到 → 必须关弹层并提示，不能静默留一个「正在生成…」
W.reset(); W.node = null;
const I2 = mkInst(); I2.rebuild(); I2.openShareCard();
isFalse('E6 拿不到画布节点 → 关闭弹层', I2.data.shareShow);
isFalse('E6 拿不到画布节点 → 回到非 busy', I2.data.shareBusy);
eq('E6 拿不到画布节点 → 有提示', W.toasts.length, 1);

// 导出失败 → 同样给反馈
W.reset(); W.exportFail = true;
const I3 = mkInst(); I3.rebuild(); I3.openShareCard();
isFalse('E7 导出失败 → 关闭弹层', I3.data.shareShow);
eq('E7 导出失败 → 有提示', W.toasts.length, 1);
eq('E7 导出失败 → 不留下半成品图片', I3.data.shareImg, '');

// 无日志 → 只提示，不开弹层
W.reset();
const I4 = mkInst();
I4.rebuild();
I4._logs = [];
I4.openShareCard();
isFalse('E8 无场次 → 不开弹层', I4.data.shareShow);
eq('E8 无场次 → 有提示', W.toasts.length, 1);

// 分享：能力缺失时必须给出真实替代，而不是假装分享成功
W.reset();
const I5 = mkInst(); I5.rebuild(); I5.openShareCard();
W.toasts = [];
I5.shareShareCard();
eq('E9 有分享接口 → 调用 showShareImageMenu', W.shareCalls.length, 1);
eq('E9 传入的是生成的临时图路径', W.shareCalls[0].path, '/tmp/share-card.png');
eq('E9 显式要求带小程序入口', W.shareCalls[0].needShowEntrance, true);
eq('E9 分享成功不弹提示', W.toasts.length, 0);

W.reset();
const I6 = mkInst(); I6.rebuild(); I6.openShareCard();
W.toasts = []; W.modals = [];
const savedApi = W.showShareImageMenu;
delete W.showShareImageMenu;               // 模拟低版本微信
I6.shareShareCard();
eq('E10 无分享接口 → 弹说明而不是静默', W.modals.length, 1);
isTrue('E10 说明里给出「保存到相册」这条真实路径', /\u76f8\u518c/.test(W.modals[0].confirmText + W.modals[0].content));
W.showShareImageMenu = savedApi;

// 用户主动关掉分享面板 → 不该弹提示打扰
W.reset();
const I7 = mkInst(); I7.rebuild(); I7.openShareCard();
W.toasts = []; W.shareFail = { errMsg: 'showShareImageMenu:fail cancel' };
I7.shareShareCard();
eq('E11 用户取消分享 → 不弹提示', W.toasts.length, 0);

W.reset();
const I8 = mkInst(); I8.rebuild(); I8.openShareCard();
W.toasts = []; W.shareFail = { errMsg: 'showShareImageMenu:fail system error' };
I8.shareShareCard();
eq('E11 分享真失败 → 给提示', W.toasts.length, 1);

// —— 分享通道：**通道数 = 真实能力数**，不为同一个能力开两个入口 ——
// 曾有第三条「存相册发朋友圈」：微信没有「一键发朋友圈」的开放接口
//（唯一相关的 onShareTimeline 是单页模式，交互密集页加它就是残废入口，本项目刻意不加），
// 早期做法是「存到相册 + 弹一句引导」。但它的实现与 saveShareCard **逐行相同**
//（都是 saveImageToPhotosAlbum + 提示），区别只有一句 modal 文案；
// 而 wx.showShareImageMenu 的转发面板里本来就能直接选朋友圈。真机确认后整条通道删除。
// 这里守两件事：① 它不许悄悄长回来；② 剩下的两条仍是**真实能力**，不是空壳入口。
const TRW = 'components/training-review/training-review.wxml';
const TRC = 'components/training-review/training-review.wxss';
// 同 [F] 组的 stripComments：本仓 wxml 的注释里会**原样引用**被删掉的旧入口名
// （「曾有的第三条 XXX 已删除」），不剥注释尺子会把自己的说明文字当成真缺陷。
const trwCode = read(TRW).replace(/<!--[\s\S]*?-->/g, ' ');
W.reset();
const I8b = mkInst(); I8b.rebuild(); I8b.openShareCard();
eq('E12 分享通道只剩两个处理器', typeof I8b.shareShareCard + '/' + typeof I8b.saveShareCard, 'function/function');
eq('E12 不再有「存相册发朋友圈」处理器', typeof I8b.saveMomentsShareCard, 'undefined');
eq('E12 通道行恰好两个入口', (trwCode.match(/class="sc-ch"/g) || []).length, 2);
isFalse('E12 面板上不再出现「存相册发朋友圈」', /\u5b58\u76f8\u518c\u53d1\u670b\u53cb\u5708/.test(trwCode));
isFalse('E12 图标样式不留死代码（ico-moment-sc 已随之删除）', /ico-moment-sc/.test(read(TRC)));
isTrue('E12 说明文案指的是真实路径（转发面板里可发朋友圈）',
  /\u8f6c\u53d1\u9762\u677f[\s\S]{0,30}\u670b\u53cb\u5708/.test(trwCode));
isFalse('E12 不谎称「已分享到朋友圈」', /\u5df2\u5206\u4eab\u5230\u670b\u53cb\u5708/.test(trwCode));

// 保存相册：权限被拒必须走设置页（重试无用）
W.reset();
const I9 = mkInst(); I9.rebuild(); I9.openShareCard();
W.toasts = []; W.saveFail = { errMsg: 'saveImageToPhotosAlbum:fail auth deny' };
I9.saveShareCard();
eq('E13 权限被拒 → 弹设置引导', W.modals.length, 1);
eq('E13 权限被拒 → 不误报成功', W.toasts.length, 0);
W.modals[0].success({ confirm: true });
eq('E13 点「去设置」→ 调 openSetting', W.openSettingCalls, 1);

W.reset();
const I10 = mkInst(); I10.rebuild(); I10.openShareCard();
W.toasts = []; W.saveFail = { errMsg: 'saveImageToPhotosAlbum:fail cancel' };
I10.saveShareCard();
eq('E13 用户取消保存 → 静默', W.toasts.length + W.modals.length, 0);

W.reset();
const I11 = mkInst(); I11.rebuild(); I11.openShareCard();
W.toasts = [];
I11.saveShareCard();
eq('E13 保存成功 → 提示已保存', W.toasts.length, 1);
isTrue('E13 保存的是同一张图', W.savedCalls[0].filePath === '/tmp/share-card.png');

// 没生成图就点分享/保存 → 提示，不发空请求
W.reset();
const I12 = mkInst(); I12.rebuild();
W.toasts = [];
I12.shareShareCard();
I12.saveShareCard();
eq('E14 未生成图 → 两个通道都只提示', W.toasts.length, 2);
eq('E14 未生成图 → 不调分享接口', W.shareCalls.length, 0);
eq('E14 未生成图 → 不调保存接口', W.savedCalls.length, 0);

// 关闭弹层要清干净，否则下次打开会先闪一张旧图
W.reset();
const I13 = mkInst(); I13.rebuild(); I13.openShareCard();
I13.closeShare();
eq('E15 关闭后状态全清', [I13.data.shareShow, I13.data.shareBusy, I13.data.shareImg], [false, false, '']);
isTrue('E15 关闭后再打开仍能出图（wx:if 卸载后画布能重新挂载）',
  (() => { W.reset(); I13.openShareCard(); return I13.data.shareImg === '/tmp/share-card.png'; })());

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
// 顶层 require 白名单：动作库（550KB）必须**懒**加载 —— 放进顶层会让每次冷启动都付解析成本
const topRequires = (readCode(SC).match(/^const [^\n=]+=\s*require\(['"]([^'"]+)['"]\)/gm) || [])
  .map(s => s.replace(/^.*require\(['"]/, '').replace(/['"]\)$/, ''));
eq('F4 顶层只依赖 trainingStats / dateRange / bodymap', topRequires.sort(), ['./bodymap.js', './dateRange.js', './trainingStats.js']);
isTrue('F4 动作库是懒加载（出现在函数体内，不在顶层）',
  /function exIndex\(\)/.test(readCode(SC)) && topRequires.indexOf('./exercises.js') < 0);
isTrue('F4 卡片配色镜像自 app.wxss 根 token（改 token 要同步改这里）',
  /--primary/.test(read(SC)) || /#C8FF00/.test(readCode(SC)));

isTrue('F5 记录页的 onShareAppMessage 不再是空实现', !/onShareAppMessage\(\)\s*\{\s*\}/.test(readCode('pages/list/list.js')));
isTrue('F5 记录页给出真实分享路径', has('pages/list/list.js', "path: '/pages/list/list'"));
isTrue('F5 复盘页也实现了 onShareAppMessage', /onShareAppMessage\(\)\s*\{[\s\S]{0,120}?return\s*\{/.test(readCode('pages/review/review.js')));
isFalse('F5 分享卡模块不自己声明 onShareTimeline（朋友圈走存相册引导，不走单页模式）',
  /onShareTimeline/.test(readCode(SC)));

isFalse('F6 分享弹层不用 opacity:0 藏原生画布', /sc-canvas[^}]*opacity/.test(readCode('components/training-review/training-review.wxss')));
isTrue('F6 画布由 wx:if 控制挂载', /canvas\s+wx:if=/.test(readCode('components/training-review/training-review.wxml')));
isFalse('F7 分享弹层文字不用 --n-500 / --text-weak（P2-9 盲区色）',
  /\.sc-(tip|busy)\s*\{[^}]*var\(--(n-500|text-weak)\)/.test(readCode('components/training-review/training-review.wxss')));

// 分享面板的每个可点项都必须绑到**真实处理器**（静态事件名，禁 Mustache 动态事件名）
['toggleShareOpt', 'cycleShareStyle', 'shareShareCard', 'saveShareCard', 'closeShare'].forEach(fn => {
  isTrue('F8 分享面板绑定了 ' + fn, new RegExp('bindtap="' + fn + '"').test(read('components/training-review/training-review.wxml')));
});
isTrue('F8 面板上不再有指向已删除处理器的绑定',
  !/bindtap="saveMomentsShareCard"/.test(read('components/training-review/training-review.wxml')));
isFalse('F8 分享面板没有 Mustache 动态事件名',
  /bind[a-z:]*="\{\{/.test(read('components/training-review/training-review.wxml')));

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
// 字号下限判据不能是恒绿空转
const tooSmall = (ops) => ops.filter(o => o.t === 'text' && o.size < MIN_FONT).length;
eq('G2 字号下限判据能抓出过小字号（17 < 18，18 不算）',
  tooSmall([{ t: 'text', s: 'x', size: 17 }, { t: 'text', s: 'y', size: 18 }]), 1);

// 引线落栏判据不能是恒绿：把后视引线人为右移 700 必须被抓住
const fakeLeaders = (() => {
  const r = scanLayout(m);
  const ops = r.L.ops.map(o => (o.t === 'line' && o.kind === 'leader' && o.side === 'back')
    ? Object.assign({}, o, { x2: o.x2 + 700 }) : o);
  const cols = r.figureCols;
  return ops.filter(o => o.t === 'line' && o.kind === 'leader').filter(o => {
    const c = cols[o.side]; return !(o.x2 >= c.x0 - 2 && o.x2 <= c.x1 + 2);
  }).length;
})();
isTrue('G2 引线落栏判据能抓出「后视图忘了补 -724」（人为右移 700 → 被抓）', fakeLeaders > 0);

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
const bm = require(path.join(ROOT, 'utils', 'bodymap.js'));
const BM_DATA = require(path.join(ROOT, 'utils', 'bodymap-data.js'));
const EX = require(path.join(ROOT, 'utils', 'exercises.js'));

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

// 线宽可配置：175px 宽的图 scale≈0.24，默认 lw=2 只有 0.48px —— 分享卡必须能调粗
const bf6 = bm.bodyPaths('front', new Set(['chest']), { lw: 6 });
eq('H4 lw 可覆盖为 6（分享卡用）', bf6.parts.map(p => p.lw), bf.parts.map(() => 6));
isTrue('H4 轮廓线宽也被一并覆盖', bf6.outline.lw === 6);

// 标签锚点：必须能拿到「某个肌群在图里的包围盒」，否则引线无从落点
const sb = bm.slugBounds(bf);
isTrue('H4 slugBounds 给出每个肌群的包围盒（标签引线靠它落点）',
  !!sb.chest && sb.chest.active === true && isFinite(sb.chest.cx) && isFinite(sb.chest.cy));
isTrue('H4 未激活的肌群 active=false（不会被标上标签）', sb.abs.active === false);
isTrue('H4 boundsOf 是纯几何（身体轮廓 box 落在 viewBox 内）',
  (() => {
    const b = bm.boundsOf(bf.outline.d);
    return isFinite(b.x) && isFinite(b.y) && b.w > 0 && b.h > 0 &&
      b.x >= -50 && b.x + b.w <= 724 + 50 && b.y >= -50 && b.y + b.h <= 1448 + 50;
  })());
isTrue('H4 slugBounds 的联合包围盒确实包含该肌群的单段包围盒',
  (() => {
    const p = bm.boundsOf(bf.parts.filter(x => x.slug === 'chest')[0].d);
    const s = sb.chest;
    return p.x >= s.x - 0.01 && p.x + p.w <= s.x2 + 0.01 && p.y >= s.y - 0.01 && p.y + p.h <= s.y2 + 0.01;
  })());
isTrue('H4 parsePath 导出（预览工具要把路径摊平成折线）', typeof bm.parsePath === 'function');

// —— 动作库 target 全覆盖（本轮修的真缺陷，防它再漏回来）——
const targets = {};
Object.keys(EX.library).forEach(cat => EX.library[cat].forEach(a => { targets[a.target] = 1; }));
const tk = Object.keys(targets);
isTrue('H5 动作库 target 取值数 \u2265 18（现 ' + tk.length + ' 个）', tk.length >= 18);
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
isTrue('H8 校准：段数判据能区分前/后视（' + sidesOf(BM_DATA.FRONT) + ' \u2260 ' + sidesOf(BM_DATA.BACK) + '）',
  sidesOf(BM_DATA.FRONT) !== sidesOf(BM_DATA.BACK));
isTrue('H8 校准：activeCount 判据能区分「点了」与「没点」',
  bm.bodyPaths('front', new Set()).activeCount === 0 && bf.activeCount === 2);
isTrue('H8 校准：lw 判据能区分默认值与覆盖值', bf.parts[0].lw !== bf6.parts[0].lw);

/* ============ [I] 主视觉 = 解剖图，且**不许引图片资源** ============ */
// 这条是红线不是权衡：一旦主视觉依赖图片（canvas.createImage / <image src>），
// 「版式/对比度/越界都能在 node 里穷举断言」这个前提就没了 —— 整套验收会降级成真机截图。
console.log('\n[I] \u4e3b\u89c6\u89c9 \u2014\u2014 \u89e3\u5256\u56fe\u8d70\u7eaf\u8def\u5f84\uff0c\u5361\u7247\u91cc\u6ca1\u6709\u4efb\u4f55\u56fe\u7247\u8d44\u6e90');
isTrue('I1 版式里有 body op（解剖图就是主视觉）', r1.L.ops.filter(o => o.t === 'body').length === 2);
isFalse('I1 分享卡模块不引用任何图片/资源路径', /\.(png|jpe?g|webp|gif)\b/i.test(readCode(SC)));
isFalse('I1 分享卡模块不用 canvas.createImage（异步图片会让版式不再是纯函数）', /createImage/.test(readCode(SC)));
isFalse('I1 分享卡模块不引任何图片目录', /assets\//.test(readCode(SC)));
isTrue('I1 解剖路径确实来自 bodymap（唯一一份几何，与动作详情页共用）',
  /bodymap\.bodyPaths/.test(readCode(SC)) && /bodymap\.drawShapes/.test(readCode(SC)));
isFalse('I1 分享卡不用 drawBody（它会 clearRect 把已铺好的卡片擦掉）', /bodymap\.drawBody/.test(readCode(SC)));
isTrue('I2 分享面板的画布上没有任何图片元素（主视觉不是 <image>）',
  (() => {
    const wxml = read('components/training-review/training-review.wxml');
    const i = wxml.indexOf('sc-canvas');
    return i >= 0 && !/<image\b/.test(wxml.slice(Math.max(0, i - 1200), i));
  })());

/* ============ [J] 底部「取消」永不被遮挡（真机反馈的两个独立成因） ============ */
// 真机反馈：分享卡弹层底部的「取消」被挡住。成因有两个，必须各自钉一条 ——
//   ① 抽屉总高**没有上限** → 内容一多（小屏 / 文案变长 / 加一行说明）就把「取消」顶出屏幕；
//   ② 宿主页是「数据」tab（自定义 tabBar 是框架级固定层，页面弹层 z-index 压不住）→ 底栏盖住按钮。
// 组件里另一个弹层（.ka-mask / .ka-sheet）早就用 with-tab 处理过 ②，分享弹层两样都缺 ——
// 「同一个组件里同一类 bug 修了一半」是最典型的漏网，所以这里按**结构不变量**钉死，
// 而不是按当下的像素值（像素值会随设备与文案变化）。
console.log('\n[J] \u5e95\u90e8\u300c\u53d6\u6d88\u300d\u6c38\u4e0d\u88ab\u906e\u6321');

const CSS_SC = read(TRC);
// 取某个选择器**自己的**声明块（避开 .sc-cancel:active / .sc-sheet.with-tab 这类同前缀邻居）
function blockOf(css, sel) {
  const i = css.indexOf(sel + ' {');
  if (i < 0) return '';
  const j = css.indexOf('}', i);
  return j < 0 ? '' : css.slice(i + sel.length, j);
}
const SHEET = blockOf(CSS_SC, '.sc-sheet');
isTrue('J1 抽屉有高度上限（max-height 存在，不再靠「经验上装得下」）', /max-height\s*:/.test(SHEET));
isTrue('J2 上限用 vh 表达（随屏高自适应，不写死 px）', /max-height\s*:\s*calc\(\s*100vh\s*-/.test(SHEET));
isTrue('J3 上限留出顶部空隙（遮罩仍可见，用户知道可以点空白关闭）',
  /100vh\s*-\s*(4[0-9]|[5-9][0-9]|[0-9]{3,})rpx/.test(SHEET));
const PREV = blockOf(CSS_SC, '.sc-preview');
isTrue('J4 预览图承担全部压缩（flex-shrink 不为 0，且带 min-height 下限）',
  /flex\s*:\s*0\s+1\s+auto/.test(PREV) && /min-height\s*:/.test(PREV));
['.sc-switches', '.sc-channels', '.sc-tip', '.sc-cancel'].forEach(sel => {
  isTrue('J5 ' + sel + ' 禁止被压缩（flex-shrink: 0）', /flex-shrink\s*:\s*0/.test(blockOf(CSS_SC, sel)));
});
const SHEET_TAB = blockOf(CSS_SC, '.sc-sheet.with-tab');
isTrue('J6 tab 页抽屉让出底栏（.sc-sheet.with-tab 存在）', /padding-bottom\s*:/.test(SHEET_TAB));
isTrue('J7 让出的高度与 .ka-mask.with-tab 同一口径（88rpx 底栏 + 44rpx 呼吸 + 安全区）',
  /calc\(\s*88rpx\s*\+\s*44rpx\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/.test(SHEET_TAB));
isTrue('J8 wxml 把 with-tab 绑到运行时探测结果（不是写死某一个页面）',
  /class="sc-sheet \{\{scTabSafe \? 'with-tab' : ''\}\}"/.test(read(TRW)));

// 探测必须是**运行时**的，且真的改变结果 —— 桩 getCurrentPages 后跑真实 openShareCard
W.reset();
const savedGCP = global.getCurrentPages;
delete global.getCurrentPages;
const J_1 = mkInst(); J_1.rebuild(); J_1.openShareCard();
isFalse('J9 拿不到页面栈 → 不预留（最坏只是少留白，不误伤复盘页）', J_1.data.scTabSafe);

global.getCurrentPages = () => [{ getTabBar: () => ({}) }];      // 有自定义 tabBar 的 tab 页
const J_2 = mkInst(); J_2.rebuild(); J_2.openShareCard();
isTrue('J9 在数据 tab 打开 → 置位 scTabSafe', J_2.data.scTabSafe);

global.getCurrentPages = () => [{}];                             // 普通页（复盘页）
const J_3 = mkInst(); J_3.rebuild(); J_3.openShareCard();
isFalse('J9 在复盘页打开 → 不预留', J_3.data.scTabSafe);

global.getCurrentPages = () => { throw new Error('boom'); };      // 探测抛异常
const J_4 = mkInst(); J_4.rebuild(); J_4.openShareCard();
isFalse('J9 探测抛异常 → 兜底 false 而不是把弹层弄崩', J_4.data.scTabSafe);
isTrue('J9 探测失败也照常出图（弹层不因探测而残废）', !!J_4.data.shareImg);
if (savedGCP) global.getCurrentPages = savedGCP; else delete global.getCurrentPages;

// —— 校准：上面这几条判据自己不能是恒绿空转 ——
isTrue('J10 校准：把 max-height 删掉后 J1/J2 判据会报错',
  !/max-height\s*:/.test(SHEET.replace(/max-height[^;]*;/, '')));
isTrue('J10 校准：把 flex-shrink:0 改成 1 后 J5 判据会报错',
  !/flex-shrink\s*:\s*0/.test(blockOf(CSS_SC.replace(/flex-shrink\s*:\s*0/g, 'flex-shrink: 1'), '.sc-cancel')));
isFalse('J10 校准：blockOf 不会误取到 .sc-cancel:active 的同名声明', /:active/.test(blockOf(CSS_SC, '.sc-cancel')));
isFalse('J10 校准：blockOf(.sc-sheet) 没有误吃进 .with-tab 的声明', /with-tab/.test(SHEET));

/* J11 几何复算 —— 把「为什么必须这么改」写成可执行的算式，而不是注释里一句话。
   两个真实机型 × 两种状态（有无 with-tab）。**坏样本必须被判为「取消被底栏盖住」**，
   否则这条尺子就是恒绿空转（J12 校准在下面兜）。 */
function sheetGeom(vw, vh, safeBottom, withTab) {
  const r = vw / 750;                                        // 1rpx = ?px
  const padTop = 28 * r;
  const padBottom = 28 * r + (withTab ? (88 + 44) * r : 0) + safeBottom;
  const rows = (76 + 96 + 12 + 22 + 88) * r;                 // 开关 + 圆图标 + 图标间隙 + 通道文案 + 取消
  const gaps = 4 * 20 * r;                                   // 5 个子项 → 4 个 gap
  const tip = 3 * 20 * r * 1.6;                              // 说明文字按最坏折 3 行
  const others = padTop + padBottom + rows + gaps + tip;
  const cap = vh - 96 * r;                                   // .sc-sheet 的 max-height
  const previewWant = 0.5 * vh;                              // .sc-preview 的 height: 50vh
  const previewMin = 220 * r;                                // .sc-preview 的 min-height
  let sheet = Math.min(cap, others + previewWant);
  let preview = sheet - others;
  if (preview < previewMin) { preview = previewMin; sheet = Math.min(vh, others + preview); }
  const tabTop = vh - (88 * r + safeBottom);                 // 自定义 tabBar 顶边
  const cancelBottom = vh - padBottom;                       // 「取消」底边
  const cancelTop = cancelBottom - 88 * r;
  const covered = Math.max(0, cancelBottom - Math.max(cancelTop, tabTop));
  return { r, sheet, cap, preview, cancelTop, cancelBottom, tabTop, covered, visible: 88 * r - covered, safeBottom, tabBar: true };
}
const PROFILES = [[375, 667, 0, '\u5c0f\u5c4f\u65e0\u5b89\u5168\u533a'], [375, 812, 34, 'iPhone X \u7cfb']];
PROFILES.forEach(([vw, vh, safe, name]) => {
  const bad = sheetGeom(vw, vh, safe, false);
  const fixed = sheetGeom(vw, vh, safe, true);
  isTrue('J11 ' + name + '\uff1a\u65e0 with-tab \u65f6\u300c\u53d6\u6d88\u300d\u786e\u5b9e\u88ab\u5e95\u680f\u76d6\u4f4f\uff08'
    + Math.round(bad.covered) + 'px / ' + Math.round(88 * bad.r) + 'px\uff09', bad.visible < 88 * bad.r * 0.5);
  eq('J11 ' + name + '\uff1a\u52a0 with-tab \u540e\u300c\u53d6\u6d88\u300d\u5b8c\u6574\u53ef\u89c1', Math.round(fixed.covered), 0);
  isTrue('J11 ' + name + '\uff1a\u62bd\u5c49\u6c38\u4e0d\u9ad8\u8fc7\u5c4f\u5e55\uff08max-height \u751f\u6548\uff09', fixed.sheet <= fixed.cap + 0.01);
  isTrue('J11 ' + name + '\uff1a\u9884\u89c8\u56fe\u88ab\u538b\u7f29\u540e\u4ecd \u2265 220rpx\uff08\u4e0d\u5854\u6210 0\uff09', fixed.preview >= 220 * fixed.r - 0.01);
});
// 复盘页没有自定义 tabBar：只要求不压到 iPhone 的横条，别把 with-tab 的账算到它头上
PROFILES.forEach(([vw, vh, safe, name]) => {
  const rev = sheetGeom(vw, vh, safe, false);
  isTrue('J11 复盘页 / ' + name + '：取消边距尊重安全区（不压横条）',
    rev.cancelBottom <= vh - safe + 0.01);
});

// 模型里的常量必须与 CSS 同源 —— 否则改了 CSS 而模型没改，J11 会开始骗人
isTrue('J12 模型锚点：.sc-preview 仍是 height: 50vh', /height\s*:\s*50vh/.test(PREV));
isTrue('J12 模型锚点：.sc-cancel 仍是 height: 88rpx', /height\s*:\s*88rpx/.test(blockOf(CSS_SC, '.sc-cancel')));
isTrue('J12 模型锚点：.sc-sheet 的 max-height 仍是 100vh - 96rpx', /calc\(\s*100vh\s*-\s*96rpx\s*\)/.test(SHEET));
isTrue('J12 校准：改掉 50vh 后 J12 判据会报错',
  !/height\s*:\s*50vh/.test(PREV.replace(/height\s*:\s*50vh/, 'height: 60vh')));

console.log('\n--------------------------------------------------------');
console.log('share-card: pass=' + pass + '  fail=' + fail);
if (fail) { console.log('存在失败断言'); process.exit(1); }
console.log('全部通过 \u2713');

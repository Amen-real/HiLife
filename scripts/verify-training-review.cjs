#!/usr/bin/env node
/**
 * verify-training-review.cjs —— 数据页 / 训练复盘的「口径 + 统计」回归（零依赖）
 *
 * 背景：复盘此前有三处口径分歧，导致同一份数据在不同页面/不同人眼里读法不一：
 *   1. 「本周」—— 复盘用「滚动最近 7 天」，计划页用「自然周（周一起算）」，同一天两页对不上；
 *   2. 「结论」—— 拿「全场训练量 vs 上一场」比，而 A/B/C 轮转每场动作本就不同，
 *      换动作会被误读成退步（今天练腿、上次练胸 → 结论「退步 40%」）；
 *   3. 「N 组 × M 次」—— M 取最后一组快照，递减组/热身组被吞掉。
 *
 * 本脚本锁定修好后的口径（实现集中在 utils/dateRange.js + utils/trainingStats.js）：
 *   A. dateRange：自然周半开区间 [周一 00:00, 下周一 00:00) —— 含跨月/跨年/周日归属
 *   B. weekTargetOf：计划 daysPerWeek > 个人 weeklyTarget > 默认 3
 *   C. buildVerdict：首次 / 有共同动作 / 无共同动作降级 / 彻底无可比 —— 四分支
 *   D. setsMetaOf：逐组聚合（均匀 / 12-10-8 / 旧日志退化）
 *   E. 单源常量：kcal 8 只有一处、旧的滚动 7 天 helper 已删除
 *   F. actionKey：同名不同器械 / 自建动作重名不串台
 *   G. 自然周 vs 滚动 7 天的差异证据（防止有人把口径改回去）
 *   H. 接线断言：组件 / 记录页 / 计划页 / 详情页按约定接入
 *
 * 用法：node scripts/verify-training-review.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p, sub) => read(p).indexOf(sub) >= 0;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => v ? ok(label) : bad(label);
const isFalse = (label, v) => !v ? ok(label) : bad(label);
const contains = (label, s, sub) => (String(s).indexOf(sub) >= 0) ? ok(label) : bad(label + '  \u2209 ' + JSON.stringify(sub) + ' (\u5b9e\u9645: ' + JSON.stringify(String(s).slice(0, 80)) + ')');

const dateRange = require(path.join(ROOT, 'utils', 'dateRange.js'));
const stats = require(path.join(ROOT, 'utils', 'trainingStats.js'));

/* ============ A. dateRange —— 自然周口径 ============ */
console.log('\n[A] dateRange —— 自然周 [\u5468\u4e00, \u4e0b\u5468\u4e00) \u534a\u5f00\u533a\u95f4');
const md = (iso) => dateRange.fmtDate(dateRange.mondayOf(iso));
eq('\u5468\u4e00\u81ea\u8eab \u2192 \u81ea\u8eab', md('2026-09-07'), '2026-09-07');
eq('\u5468\u4e09 \u2192 \u672c\u5468\u4e00', md('2026-09-09'), '2026-09-07');
eq('\u5468\u65e5 \u2192 \u4e0a\u4e00\u4e2a\u5468\u4e00\uff08\u5468\u65e5\u5f52\u4e0a\u5468\uff09', md('2026-09-13'), '2026-09-07');
eq('\u4e0b\u5468\u4e00 \u2192 \u81ea\u8eab\uff08\u4e0d\u5f52\u4e0a\u5468\uff09', md('2026-09-14'), '2026-09-14');
eq('\u8de8\u6708\uff1a10-01 \u2192 09-28', md('2026-10-01'), '2026-09-28');
eq('\u8de8\u5e74\uff1a2026-01-01 \u2192 2025-12-29', md('2026-01-01'), '2025-12-29');

const wk = dateRange.weekRange('2026-09-09');
eq('\u672c\u5468\u8d77\u6b62\uff08sunStr = \u4e0b\u5468\u4e00\uff09', [wk.monStr, wk.sunStr], ['2026-09-07', '2026-09-14']);
isTrue('\u5468\u4e00 00:00 \u6574\u70b9\uff08\u65f6\u5206\u79d2\u6beb\u5f52\u96f6\uff09',
  wk.mon.getHours() === 0 && wk.mon.getMinutes() === 0 && wk.mon.getSeconds() === 0 && wk.mon.getMilliseconds() === 0);
eq('\u5468\u4e00\u5728\u533a\u95f4\u5185', dateRange.inRange('2026-09-07', wk.monStr, wk.sunStr), true);
eq('\u5468\u65e5\u5728\u533a\u95f4\u5185', dateRange.inRange('2026-09-13', wk.monStr, wk.sunStr), true);
eq('\u4e0b\u5468\u4e00\u5728\u533a\u95f4\u5916\uff08\u534a\u5f00\uff09', dateRange.inRange('2026-09-14', wk.monStr, wk.sunStr), false);
eq('\u4e0a\u5468\u65e5\u5728\u533a\u95f4\u5916', dateRange.inRange('2026-09-06', wk.monStr, wk.sunStr), false);

const wr1 = dateRange.weekRangeOffset('2026-09-09', -1);
eq('\u4e0a\u4e00\u5468\u533a\u95f4', [wr1.monStr, wr1.sunStr], ['2026-08-31', '2026-09-07']);
const wr5 = dateRange.weekRangeOffset('2026-09-09', -5);
eq('W-5 \u533a\u95f4', [wr5.monStr, wr5.sunStr], ['2026-08-03', '2026-08-10']);
eq('\u504f\u79fb 0 \u5468 = \u672c\u5468',
  [dateRange.weekRangeOffset('2026-09-09', 0).monStr, dateRange.weekRange('2026-09-09').monStr],
  ['2026-09-07', '2026-09-07']);

eq('shiftDaysISO -7', dateRange.shiftDaysISO('2026-09-09', -7), '2026-09-02');
eq('shiftDaysISO +7 \u8de8\u6708', dateRange.shiftDaysISO('2026-09-30', 7), '2026-10-07');
eq('fmtMonthLabel', dateRange.fmtMonthLabel('2026-09-09'), '2026\u5e749\u6708');
eq('fmtDateSlash', dateRange.fmtDateSlash('2026-09-09'), '2026/09/09');
isTrue('todayStr \u5f62\u72b6 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(dateRange.todayStr()));
eq('\u7a7a\u5165\u53c2\u4e0d\u5d29\uff08parseISO \u515c\u5e95\uff09',
  [typeof dateRange.parseISO('').getTime(), typeof dateRange.mondayOf('').getTime()], ['number', 'number']);

/* ============ B. weekTargetOf —— 目标优先级 ============ */
console.log('\n[B] weekTargetOf \u2014\u2014 \u8ba1\u5212 > \u4e2a\u4eba\u8bbe\u7f6e > \u9ed8\u8ba4 3');
eq('\u6709\u8ba1\u5212 daysPerWeek \u2192 \u7528\u8ba1\u5212\u503c\u5e76\u6807 fromPlan',
  stats.weekTargetOf({ weeklyTarget: 5 }, { daysPerWeek: 4 }), { target: 4, fromPlan: true });
eq('\u65e0\u8ba1\u5212 \u2192 \u7528\u4e2a\u4eba\u8bbe\u7f6e',
  stats.weekTargetOf({ weeklyTarget: 5 }, null), { target: 5, fromPlan: false });
eq('\u90fd\u6ca1\u6709 \u2192 \u9ed8\u8ba4 3',
  stats.weekTargetOf({}, null), { target: 3, fromPlan: false });
eq('profile \u7f3a\u5931\u4e0d\u5d29', stats.weekTargetOf(null, null), { target: 3, fromPlan: false });
eq('\u8ba1\u5212 daysPerWeek=0 \u2192 \u56de\u9000\u4e2a\u4eba\u8bbe\u7f6e',
  stats.weekTargetOf({ weeklyTarget: 5 }, { daysPerWeek: 0 }), { target: 5, fromPlan: false });
eq('\u8ba1\u5212 daysPerWeek \u5b57\u7b26\u4e32\u4e5f\u8ba4',
  stats.weekTargetOf({ weeklyTarget: 5 }, { daysPerWeek: '3' }), { target: 3, fromPlan: true });

/* ============ C. buildVerdict —— 四分支 ============ */
console.log('\n[C] buildVerdict \u2014\u2014 \u53ea\u6bd4\u5171\u540c\u52a8\u4f5c');
const A = (id, equip, sets) => ({ id, name: id, equip: equip || '', sets: sets.length, setsDetail: sets });
const S = (w, r, rpe) => ({ weight: w, reps: r, trainSec: 0, restSec: 0, rpe: rpe == null ? 7 : rpe });
const V = (cur, prev, tail) => stats.buildVerdict({
  log: cur, idx: 0, logsDesc: [cur, prev].concat(tail || [])
});

// C1 首次记录
const first = V({ date: 'd1', actions: [A('x', '', [S(50, 10)])] }, null);
eq('C1 \u9996\u6b21\u8bb0\u5f55 kind', first.kind, 'first');
contains('C1 \u9996\u6b21\u8bb0\u5f55\u6587\u6848', first.text, '\u9996\u6b21\u8bb0\u5f55');

// C2 有共同动作 → 只算共同动作；单方新增的大重量动作不得影响结论
const cur2 = { date: 'd2', actions: [A('x', '\u6760\u94c3', [S(110, 5)]), A('z', '\u54d1\u94c3', [S(1000, 10)])] };
const prev2 = { date: 'd1', actions: [A('x', '\u6760\u94c3', [S(100, 5)]), A('y', '\u673a\u5668', [S(200, 10)])] };
const v2 = V(cur2, prev2);
eq('C2 kind=common', v2.kind, 'common');
eq('C2 \u53ea\u7b97\u5171\u540c\u52a8\u4f5c\uff08+10%\uff0c\u4e0d\u53d7 z \u5f71\u54cd\uff09', v2.pct, 10);
eq('C2 \u5171\u540c\u52a8\u4f5c\u6570', v2.commonCount, 1);
contains('C2 \u6587\u6848\u542b\u201c\u5171\u540c\u52a8\u4f5c\u5bb9\u91cf\u201d', v2.text, '\u5171\u540c\u52a8\u4f5c\u5bb9\u91cf');
contains('C2 \u6587\u6848\u542b +10%', v2.text, '+10%');
isFalse('C2 \u6587\u6848\u4e0d\u51fa\u73b0\u201c\u5168\u573a\u201d\u5b57\u6837', v2.text.indexOf('\u5168\u573a') >= 0);

// C3 阈值内记持平
const v3 = V({ date: 'd2', actions: [A('x', '', [S(500, 1)])] }, { date: 'd1', actions: [A('x', '', [S(510, 1)])] });
eq('C3 \u9608\u503c\u5185 kind=common', v3.kind, 'common');
eq('C3 \u9608\u503c\u5185 pct=-2', v3.pct, -2);
contains('C3 \u9608\u503c\u5185\u6587\u6848\u201c\u4e0e\u4e0a\u573a\u6301\u5e73\u201d', v3.text, '\u4e0e\u4e0a\u573a\u6301\u5e73');

// C4 阈值外记下降
const v4 = V({ date: 'd2', actions: [A('x', '', [S(450, 1)])] }, { date: 'd1', actions: [A('x', '', [S(500, 1)])] });
eq('C4 pct=-10', v4.pct, -10);
contains('C4 \u6587\u6848\u542b \u221210%', v4.text, '\u221210%');

// C5 无共同动作 → 降级比各动作自身历史
const cur5 = { date: 'd3', actions: [A('x', '', [S(50, 10)])] };
const mid5 = { date: 'd2', actions: [A('y', '', [S(999, 10)])] };
const old5 = { date: 'd1', actions: [A('x', '', [S(40, 10)])] };
const v5 = stats.buildVerdict({ log: cur5, idx: 0, logsDesc: [cur5, mid5, old5] });
eq('C5 kind=fallback', v5.kind, 'fallback');
eq('C5 \u964d\u7ea7\u540e pct=+25%', v5.pct, 25);
eq('C5 commonCount=0', v5.commonCount, 0);
contains('C5 \u6587\u6848\u8bf4\u660e\u52a8\u4f5c\u4e0d\u540c', v5.text, '\u672c\u8f6e\u4e0e\u4e0a\u573a\u52a8\u4f5c\u4e0d\u540c');

// C6 彻底无可比 → 明说，不硬编结论
const cur6 = { date: 'd2', actions: [A('x', '', [S(50, 10)])] };
const prev6 = { date: 'd1', actions: [A('y', '', [S(60, 10)])] };
const v6 = stats.buildVerdict({ log: cur6, idx: 0, logsDesc: [cur6, prev6] });
eq('C6 kind=none', v6.kind, 'none');
contains('C6 \u6587\u6848\u660e\u8bf4\u65e0\u5386\u53f2', v6.text, '\u6ca1\u6709\u5386\u53f2');

// C7 纯自重动作：训练量恒 0 → 退化为「总次数」比较
const v7 = V(
  { date: 'd2', actions: [A('bw', '', [S(0, 10), S(0, 10), S(0, 10)])] },
  { date: 'd1', actions: [A('bw', '', [S(0, 8), S(0, 8)])] }
);
eq('C7 \u81ea\u91cd\u4f5c\u9000\u5316\u6bd4\u603b\u6b21\u6570\uff0830 vs 16 = +88%\uff09', v7.pct, 88);
eq('C7 kind=common', v7.kind, 'common');
isFalse('C7 \u4e0d\u662f\u201c\u6301\u5e73\u201d\uff08\u8bf4\u660e\u4e0d\u662f\u6052 0 \u5bb9\u91cf\uff09', v7.text.indexOf('\u6301\u5e73') >= 0);

// C8 同场同名动作出现两次 → 训练量累加而非覆盖
const v8 = V(
  { date: 'd2', actions: [A('x', '', [S(50, 10)]), A('x', '', [S(50, 10)])] },
  { date: 'd1', actions: [A('x', '', [S(50, 10)])] }
);
eq('C8 \u540c\u573a\u540c\u52a8\u4f5c\u7d2f\u52a0 (+100%)', v8.pct, 100);

/* ============ D. setsMetaOf —— 逐组聚合 ============ */
console.log('\n[D] setsMetaOf \u2014\u2014 \u4e0d\u518d\u53ea\u770b\u6700\u540e\u4e00\u7ec4');
eq('\u9012\u51cf\u7ec4 12/10/8', stats.setsMetaOf({ sets: 3, setsDetail: [S(50, 12), S(50, 10), S(50, 8)] }), '3 \u7ec4 \u00d7 12/10/8 \u6b21');
eq('\u5747\u5300 12 \u6b21\u4e0d\u7f57\u55e6', stats.setsMetaOf({ sets: 3, setsDetail: [S(50, 12), S(50, 12), S(50, 12)] }), '3 \u7ec4 \u00d7 12 \u6b21');
eq('\u65e7\u65e5\u5fd7\u65e0\u660e\u7ec6 \u2192 0 \u6b21', stats.setsMetaOf({ sets: 3, reps: 12 }), '3 \u7ec4 \u00d7 0 \u6b21');
eq('\u65e0 sets \u5b57\u6bb5\u53d6\u660e\u7ec6\u957f\u5ea6', stats.setsMetaOf({ setsDetail: [S(50, 5)] }), '1 \u7ec4 \u00d7 5 \u6b21');
eq('0 \u6b21\u4e0d\u5165\u5e8f\u5217', stats.setsMetaOf({ sets: 3, setsDetail: [S(50, 12), S(0, 0), S(50, 10)] }), '3 \u7ec4 \u00d7 12/10 \u6b21');
eq('null \u4e0d\u5d29', stats.setsMetaOf(null), '');

/* ============ E. 单源常量 & 旧口径清除 ============ */
console.log('\n[E] \u5355\u6e90\u5e38\u91cf \u2014\u2014 kcal \u53ea\u6709\u4e00\u5904');
eq('EST_KCAL_PER_MIN = 8', stats.EST_KCAL_PER_MIN, 8);
eq('estKcal(600s) = 80', stats.estKcal(600), 80);
eq('estKcal(90s) = 12', stats.estKcal(90), 12);
eq('estKcal(\u5f02\u5e38\u503c) = 0', stats.estKcal(null), 0);
eq('DELTA_SESSION = 5', stats.DELTA_SESSION, 5);
eq('DELTA_TREND = 3', stats.DELTA_TREND, 3);

// rpeSumOfActions 提供原始累加：跨周求平均时不能被「先四舍五入的 avg」污染
const rpeA = { actions: [A('x', '', [S(50, 10, 7), S(50, 10, 7), S(50, 10, 8)])] };
eq('rpe \u539f\u59cb\u7d2f\u52a0', stats.rpeSumOfActions(rpeA.actions), { sum: 22, count: 3 });
eq('rpe \u5e73\u5747 = 7.3', stats.avgRpeOfActions(rpeA.actions), { avg: 7.3, count: 3 });
isTrue('avg\u00d7count \u4f1a\u6f02\u79fb\uff08\u6545\u8de8\u5468\u5fc5\u987b\u7528 sum\uff09', 7.3 * 3 !== 22);
eq('rpe \u8d8a\u754c\u503c\uff088 / 0\uff09\u4e0d\u8ba1\u5165', stats.rpeSumOfActions([A('x', '', [S(50, 10, 11), S(50, 10, 0), S(50, 10, 6)])]), { sum: 6, count: 1 });
isTrue('list.js \u63a5\u5165 trainingStats \u5355\u6e90\u7edf\u8ba1', has('pages/list/list.js', "utils/trainingStats.js"));
isFalse('list.js \u4e0d\u518d\u81ea\u5efa estKcal', has('pages/list/list.js', 'function estKcal'));
isFalse('training-review.js \u5220\u9664\u6b7b\u4ee3\u7801 CAL_PER_MIN', has('components/training-review/training-review.js', 'CAL_PER_MIN'));
isFalse('training-review.js \u5220\u9664\u6eda\u52a8 7 \u5929 daysOf()', has('components/training-review/training-review.js', 'daysOf('));
isTrue('training-review.js \u63a5\u5165 dateRange', has('components/training-review/training-review.js', "utils/dateRange.js"));
isTrue('training-review.js \u63a5\u5165 trainingStats', has('components/training-review/training-review.js', "utils/trainingStats.js"));

/* ============ F. actionKey —— 同名不串台 ============ */
console.log('\n[F] actionKey \u2014\u2014 \u540c\u540d\u4e0d\u540c\u52a8\u4f5c\u4e0d\u7a9c');
isTrue('id \u4e0d\u540c \u2192 key \u4e0d\u540c\uff08\u81ea\u5efa\u52a8\u4f5c\u91cd\u540d\u4e0d\u7a9c\uff09',
  stats.actionKey({ id: 'u1', name: '\u5367\u63a8', equip: '\u6760\u94c3' }) !== stats.actionKey({ id: 'u2', name: '\u5367\u63a8', equip: '\u6760\u94c3' }));
isTrue('id \u76f8\u540c\u3001\u5668\u68b0\u4e0d\u540c \u2192 key \u4e0d\u540c',
  stats.actionKey({ id: 'u1', name: '\u5367\u63a8', equip: '\u6760\u94c3' }) !== stats.actionKey({ id: 'u1', name: '\u5367\u63a8', equip: '\u54d1\u94c3' }));
isTrue('\u65e0 id \u65f6\u56de\u9000\u5230\u540d\u5b57',
  stats.actionKey({ name: '\u5367\u63a8', equip: '' }) === stats.actionKey({ nameZh: '\u5367\u63a8', equip: '' }));
eq('\u7a7a\u52a8\u4f5c\u4e0d\u5d29', stats.actionKey(null), '');

/* ============ G. 自然周 vs 滚动 7 天 —— 差异证据 ============ */
console.log('\n[G] \u81ea\u7136\u5468 vs \u6eda\u52a8 7 \u5929 \u2014\u2014 \u4e3a\u4ec0\u4e48\u8981\u6539\u53e3\u5f84');
// 基准 = 2026-09-09（周三）
const wkG = dateRange.weekRange('2026-09-09');                 // [09-07, 09-14)
const rolling = [];                                            // 旧的 daysOf(0,6)：09-03 ~ 09-09
for (let i = 6; i >= 0; i--) rolling.push(dateRange.shiftDaysISO('2026-09-09', -i));
const natHit = (iso) => dateRange.inRange(iso, wkG.monStr, wkG.sunStr);
const rollHit = (iso) => rolling.indexOf(iso) >= 0;
eq('\u81ea\u7136\u5468\u542b 09-11\uff08\u6eda\u52a8 7 \u5929\u4e0d\u542b\uff09', [natHit('2026-09-11'), rollHit('2026-09-11')], [true, false]);
eq('\u81ea\u7136\u5468\u4e0d\u542b 09-03\uff08\u6eda\u52a8 7 \u5929\u542b\uff09', [natHit('2026-09-03'), rollHit('2026-09-03')], [false, true]);
eq('\u5468\u4e00 09-07 \u4e24\u8005\u90fd\u542b', [natHit('2026-09-07'), rollHit('2026-09-07')], [true, true]);
eq('\u5468\u65e5 09-13 \u53ea\u6709\u81ea\u7136\u5468\u542b', [natHit('2026-09-13'), rollHit('2026-09-13')], [true, false]);

// 与计划页共用同一区间：同一份日志，两边算出的「本周天数」必须一致
const planRotation = require(path.join(ROOT, 'utils', 'planRotation.js'));
const logsG = [
  { date: '2026-09-08', planId: 'p1', programId: 'g1' },
  { date: '2026-09-11', planId: 'p1', programId: 'g1' },
  { date: '2026-09-13', planId: 'p1', programId: 'g1' }
];
const byPlan = planRotation.weekDatesByKey(logsG, 'planId', wkG.monStr, wkG.sunStr);
const planSide = planRotation.weekDayCount(byPlan, 'p1');
const reviewSide = new Set(logsG.filter(l => dateRange.inRange(l.date, wkG.monStr, wkG.sunStr)).map(l => l.date)).size;
eq('\u8ba1\u5212\u9875\u4e0e\u590d\u76d8\u201c\u672c\u5468\u5929\u6570\u201d\u4e00\u81f4\uff083 \u5929\uff09', [planSide, reviewSide], [3, 3]);
eq('\u8de8\u5468\u7684 09-06 \u4e0d\u8ba1\u5165', planRotation.weekDayCount(
  planRotation.weekDatesByKey([{ date: '2026-09-06', planId: 'p1' }], 'planId', wkG.monStr, wkG.sunStr), 'p1'), 0);

/* ============ H. 接线断言 ============ */
console.log('\n[H] \u63a5\u7ebf\u65ad\u8a00');
const TR_WXML = 'components/training-review/training-review.wxml';
const TR_JS = 'components/training-review/training-review.js';
const TR_WXSS = 'components/training-review/training-review.wxss';
const LIST_JS = 'pages/list/list.js';
const LIST_WXML = 'pages/list/list.wxml';

isTrue('\u590d\u76d8\u7ec4\u4ef6\u58f0\u660e focusDate \u5c5e\u6027', has(TR_JS, 'focusDate'));
isTrue('\u8bb0\u5f55\u9875\u900f\u4f20 focus-date', has(LIST_WXML, 'focus-date="{{selectedDate}}"'));
isTrue('复盘用自然周桶 weekRangeOffset(', has(TR_JS, 'dateRange.weekRangeOffset('));
isTrue('\u590d\u76d8\u201c\u672c\u5468\u201d\u7528 inRange \u5224\u5b9a', has(TR_JS, 'dateRange.inRange('));
isTrue('\u8ba1\u5212\u9875 weekRange \u59d4\u6d3e\u7ed9 dateRange', has('pages/plan/plan.js', 'return dateRange.weekRange();'));
isTrue('\u8bb0\u5f55\u9875 meta \u7528 setsMetaOf', has(LIST_JS, 'stats.setsMetaOf('));
isTrue('\u8bb0\u5f55\u9875\u53d6\u5cf0\u503c\u91cd\u91cf', has(LIST_JS, 'stats.peakWeightOf('));
isTrue('\u8bb0\u5f55\u9875 kcal \u8d70\u5355\u6e90', has(LIST_JS, 'stats.estKcal('));
isTrue('\u8bb0\u5f55\u9875\u6309 id \u53cd\u67e5\u52a8\u4f5c\u5e93', has(LIST_JS, 'findLib(') && has(LIST_JS, 'LIB_BY_ID'));
isTrue('\u8bb0\u5f55\u9875\u52a8\u4f5c\u884c\u552f\u4e00\u952e k', has(LIST_WXML, 'wx:key="k"'));
isTrue('\u8bb0\u5f55\u9875\u900f\u4f20 data-id', has(LIST_WXML, 'data-id="{{item.id}}"'));
isTrue('\u8be6\u60c5\u9875\u52a8\u4f5c\u552f\u4e00\u952e k', has('pages/train-detail/train-detail.wxml', 'wx:key="k"'));
isTrue('\u590d\u76d8\u6bcf\u52a8\u4f5c\u7528 setsMeta \u6587\u6848', has(TR_WXML, '{{item.setsMeta}}'));
isFalse('趋势页已移除「本周执行」卡', has(TR_WXML, '本周执行'));
isFalse('不再画周完成度环（conic-gradient）', has(TR_JS, 'conic-gradient'));
isFalse('不再有周目标就地改方法', has(TR_JS, 'editWeeklyTarget'));
isFalse('不再残留 weekly 数据槽位', has(TR_JS, 'weekly: { weeklyTarget'));
isTrue('周趋势改由 buildWeeks 承担', has(TR_JS, 'buildWeeks(') && !has(TR_JS, 'buildWeekly('));
isTrue('\u590d\u76d8\u7ec4\u4ef6\u7a7a\u6001 CTA', has(TR_WXML, 'ph-cta') && has(TR_JS, 'goTrain'));
isTrue('\u7a7a\u6001 CTA \u6837\u5f0f\u5b58\u5728', has(TR_WXSS, '.ph-cta'));
isTrue('\u52aa\u529b\u5ea6\u67f1\u6709 min-height\uff08\u4e0d\u4f1a\u77ee\u5230\u770b\u4e0d\u89c1\uff09', has(TR_JS, 'min-height: 8%'));
isTrue('\u5403\u529b\u5f39\u7a97\u8865 1\u201310 \u6570\u503c\u6620\u5c04', has(TR_JS, '9\u201310') && has(TR_JS, '1\u20134'));
// —— 下次训练建议 / 回填计划 ——
isTrue('\u590d\u76d8\u7ec4\u4ef6\u8c03\u7528 nextSessionSuggestion', has(TR_JS, 'nextSessionSuggestion('));
isTrue('\u590d\u76d8\u7ec4\u4ef6\u6709\u300c\u5e94\u7528\u5230\u8ba1\u5212\u300d\u5904\u7406', has(TR_JS, 'applySuggestions'));
isTrue('\u56de\u586b\u8d70 store.updatePlan', has(TR_JS, 'store.updatePlan('));
isFalse('\u56de\u586b\u4e0d\u6539\u6fc0\u6d3b\u6307\u9488\uff08\u4e0d\u8c03 setActivePlan\uff09', has(TR_JS, 'setActivePlan('));
isTrue('wxml \u6709\u4e0b\u6b21\u5efa\u8bae\u5361', has(TR_WXML, 'sg-card'));
isTrue('wxml \u5efa\u8bae\u5361\u6709\u5e94\u7528\u6309\u94ae', has(TR_WXML, '\u5e94\u7528\u5230\u8ba1\u5212'));
isTrue('wxss \u6709\u5efa\u8bae\u5361\u6309\u94ae\u6837\u5f0f', has(TR_WXSS, '.sg-apply'));
isTrue('wxss 有减载行箭头样式', has(TR_WXSS, '.sg-row.dl'));
isTrue('wxml 箭头按建议方向渲染（加重 → / 减载 ↓）', has(TR_WXML, '{{item.arrow}}'));
isTrue('trainingStats 导出 floorPlate（降重向下取整）', typeof stats.floorPlate === 'function');
// —— 计划页：重量手动编辑入口（此前计划重量只能靠建议卡回填，用户没有别的出口）——
isTrue('计划页有重量输入框', has('pages/plan/plan.wxml', 'onActionWeight'));
isTrue('计划页有重量输入处理', has('pages/plan/plan.js', 'onActionWeight('));
isTrue('计划页重量写回 _pickedDetails', has('pages/plan/plan.js', '.weight = v'));
isTrue('计划页重量输入样式', has('pages/plan/plan.wxss', '.pf-i.sm'));
// —— 进步趋势口径（2026-09-14 修：纵轴从周均 RPE 换成周训练量）——
isTrue('wxml 有场次不足钩子', has(TR_WXML, '趋势需要一点积累'));
isTrue('wxss 有个人纪录样式', has(TR_WXSS, '.pr-card'));
isTrue('wxml 有个人纪录块', has(TR_WXML, '个人纪录'));
isTrue('wxml 标题为「训练量 · 近 6 周」', has(TR_WXML, '训练量 · 近 6 周'));
isFalse('wxml 不再有「努力度 · 近 6 周」纵轴图', has(TR_WXML, '努力度 · 近 6 周'));
isTrue('wxml 关键动作带训练量说明行', has(TR_WXML, 'ka-cap'));
isTrue('组件有 buildRecords', has(TR_JS, 'buildRecords('));
isTrue('趋势柱高改用可比容量', has(TR_JS, 'capacityOfAction(a)'));
isFalse('关键动作柱高不再按峰值重量归一', has(TR_JS, 'x.topW || maxW'));
isTrue('趋势场次门槛已定义', has(TR_JS, 'TREND_MIN_LOGS'));
// —— 关键动作「自动前 3 + 可切换」（2026-09-14：原来写死 slice(0,3)，用户没得选）——
isTrue('组件不再写死 slice(0,3)', !has(TR_JS, 'groups.slice(0, 3)'));
isTrue('关键动作读取用户自选', has(TR_JS, 'store.getKeyActionPicks()'));
isTrue('关键动作落库自选', has(TR_JS, 'store.setKeyActionPicks('));
isTrue('卡位上限单源常量 KA_MAX', has(TR_JS, 'const KA_MAX = 3;'));
isTrue('store 提供 getKeyActionPicks', typeof require(path.join(ROOT, 'utils', 'store.js')).getKeyActionPicks === 'function');
isTrue('store 提供 setKeyActionPicks', typeof require(path.join(ROOT, 'utils', 'store.js')).setKeyActionPicks === 'function');
isTrue('globalData 有 keyActionPicks 槽位', has('app.js', 'keyActionPicks'));
isTrue('退出登录会清空自选（不串号）', has('utils/store.js', 'data.keyActionPicks = [];'));
isTrue('wxml 有切换入口', has(TR_WXML, 'bindtap="openKaSheet"'));
isTrue('wxml 有选择弹层', has(TR_WXML, 'class="ka-sheet"'));
isTrue('wxml 勾选项唯一键', has(TR_WXML, 'data-key="{{item.key}}"'));
isTrue('wxss 弹层遮罩高于 nav-bar', has(TR_WXSS, 'z-index: 2000;'));
isTrue('wxss 弹层列表给明确高度', has(TR_WXSS, '.ka-sheet-list { height: 52vh; }'));
// —— 底栏遮挡（2026-09-14 修：数据 tab 的自定义底栏盖住「恢复自动 / 完成」）——
isTrue('wxml 抽屉按宿主页底栏让位', has(TR_WXML, "kaTabSafe ? 'with-tab' : ''"));
isTrue('wxss 预留 88rpx 底栏高度', has(TR_WXSS, '.ka-mask.with-tab .ka-sheet'));
isTrue('组件自动探测宿主页底栏', has(TR_JS, '_hasTabBar()'));
isTrue('探测用 getTabBar 判定 tab 页', has(TR_JS, 'cur.getTabBar()'));

/* ============ I. 组件数据形状（真实组件 + stub 宿主） ============ */
// 为什么单独测：H 段全是「文件里有没有这段字符串」的结构断言，抓不到「把对象塞进文本字段」
// 这类数据形状 bug。现实教训——把 bestSetOf() 的返回对象 {topW,reps} 直接赋给
// perAction[].best，WXML 就渲染成「最好一组 [object Object]」。
// 这里用 Component / getApp stub 加载【真实组件】，跑 rebuild()，再递归扫 setData 结果：
// 任何会被当文本渲染的字段都不许是对象。
console.log('\n[I] \u7ec4\u4ef6\u6570\u636e\u5f62\u72b6 \u2014\u2014 \u6587\u672c\u5b57\u6bb5\u4e0d\u5f97\u662f\u5bf9\u8c61');

const fakeAppTR = {
  globalData: {
    trainingPlans: [], trainingLogs: [], activePlanId: '', selectedActions: [],
    meals: [], weightRecords: [], customActions: [],
    profile: { fitnessDays: 0, weeklyTarget: 3 }
  },
  persist() {}
};
global.getApp = () => fakeAppTR;
global.wx = { showModal() {}, showToast() {}, switchTab() {}, navigateBack() {} };
let TR_SPEC = null;
global.Component = (spec) => { TR_SPEC = spec; };
require(path.join(ROOT, 'components', 'training-review', 'training-review.js'));
isTrue('\u771f\u5b9e\u7ec4\u4ef6\u5df2\u52a0\u8f7d\uff08Component \u88ab\u8c03\u7528\uff09', !!TR_SPEC && !!TR_SPEC.methods);

const mkInst = () => Object.assign({}, TR_SPEC.methods, {
  data: JSON.parse(JSON.stringify(TR_SPEC.data)),
  setData(patch) { Object.keys(patch || {}).forEach(k => { this.data[k] = patch[k]; }); }
});

// 容器字段：本身就该是对象/数组，其子字段才是被渲染的文本
const CONTAINERS = { perAction: 1, feelings: 1, keyActions: 1, weeks: 1, stats: 1, chip: 1, bars: 1, records: 1, pickOptions: 1 };
function sweepObjects(o, path, bads) {
  if (!o || typeof o !== 'object') return;
  Object.keys(o).forEach(k => {
    const v = o[k];
    if (v === null || v === undefined || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => sweepObjects(x, path + '.' + k + '[' + i + ']', bads)); return; }
    if (CONTAINERS[k]) { sweepObjects(v, path + '.' + k, bads); return; }
    bads.push(path + '.' + k);
  });
}

const S2 = (w, r, rpe) => ({ weight: w, reps: r, trainSec: 60, restSec: 30, rpe: rpe == null ? 7 : rpe });
const A2 = (id, name, sets) => ({ id, name, nameZh: name, equip: '', setsDetail: sets, note: '' });
const dayAgo = (i) => dateRange.shiftDaysISO(dateRange.todayStr(), -i);
const mkLog = (sid, i, createdAt, actions, planId) => ({
  sid, date: dayAgo(i), createdAt, planId: planId || '', programId: planId ? 'g1' : '', actions
});

fakeAppTR.globalData.trainingLogs = [
  mkLog('l0', 1, 3, [A2('a1', '\u5367\u63a8', [S2(60, 10, 7), S2(60, 8, 8)]), A2('a2', '\u5f15\u4f53\u5411\u4e0a', [S2(0, 10, 6)])], 'p1'),
  mkLog('l1', 3, 2, [A2('a1', '\u5367\u63a8', [S2(55, 10, 8)]), A2('a3', '\u6df1\u8e72', [S2(80, 5, 9)])], 'p1'),
  mkLog('l2', 9, 1, [A2('a1', '\u5367\u63a8', [S2(50, 10, 7)])], '')
];

const I1 = mkInst();
I1.rebuild();
const bad1 = [];
sweepObjects(I1.data, 'data', bad1);
eq('I1 \u8bfb\u5230 3 \u573a\u6b21', I1.data.logsCount, 3);
eq('I1 \u9012\u5f52\u626b\u63cf\uff1a\u65e0\u5bf9\u8c61\u5f53\u6587\u672c\u6e32\u67d3', bad1, []);
isTrue('I1 perAction \u6709\u6570\u636e', I1.data.perAction.length > 0);
isTrue('I1 perAction[].best \u662f\u5b57\u7b26\u4e32\uff08\u4e0d\u662f bestSetOf \u7684\u5bf9\u8c61\uff09',
  typeof I1.data.perAction[0].best === 'string');
isTrue('I1 perAction[].best \u542b\u91cd\u91cf\u4e0e\u6b21\u6570', /kg \u00d7 \d+/.test(I1.data.perAction[0].best));
isTrue('I1 perAction[].setsMeta \u662f\u5b57\u7b26\u4e32', typeof I1.data.perAction[0].setsMeta === 'string');
isTrue('I1 perAction[].plan \u662f\u5b57\u7b26\u4e32', typeof I1.data.perAction[0].plan === 'string');
isTrue('I1 verdict \u662f\u5b57\u7b26\u4e32', typeof I1.data.verdict === 'string');
isTrue('I1 stats \u4e09\u9879\u5747\u5b57\u7b26\u4e32',
  ['duration', 'volume', 'effort'].every(k => typeof I1.data.stats[k] === 'string'));
isTrue('I1 不再存在 weekly（本周执行卡已移除）', I1.data.weekly === undefined);
eq('I1 weeks \u5171 6 \u6839\u67f1', I1.data.weeks.length, 6);
isTrue('I1 weeks[].barStyle \u662f\u5b57\u7b26\u4e32', I1.data.weeks.every(w => typeof w.barStyle === 'string'));
isTrue('I1 keyActions \u6709\u6570\u636e\u4e14 chip.text \u4e3a\u5b57\u7b26\u4e32',
  I1.data.keyActions.length > 0 && typeof I1.data.keyActions[0].chip.text === 'string');
isTrue('I1 bars[].hot \u662f\u5e03\u5c14', I1.data.keyActions[0].bars.every(b => typeof b.hot === 'boolean'));

// 空态分支同样不许出现对象字段
const I2 = mkInst();
fakeAppTR.globalData.trainingLogs = [];
I2.rebuild();
const bad2 = [];
sweepObjects(I2.data, 'data', bad2);
eq('I2 \u7a7a\u6001\u65e0\u5bf9\u8c61\u5b57\u6bb5', bad2, []);
eq('I2 empty=true', I2.data.empty, true);
isTrue('I2 空态 weeks 仍为空数组', I2.data.weeks.length === 0);

// 切场次 / 切 tab 不炸且状态自洽
const I3 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLog('l0', 1, 2, [A2('a1', '\u5367\u63a8', [S2(60, 10, 7)])], ''),
  mkLog('l1', 4, 1, [A2('a1', '\u5367\u63a8', [S2(50, 10, 7)])], '')
];
I3.rebuild();
const dateNewest = I3.data.sessionDate;
I3.selSession({ currentTarget: { dataset: { dir: 'older' } } });
isTrue('I3 \u5411\u65e7\u5207\u573a\u6b21\u540e\u65e5\u671f\u53d8\u5316', I3.data.sessionDate !== dateNewest);
isTrue('I3 \u5207\u573a\u6b21\u540e\u4ecd\u65e0\u5bf9\u8c61\u5b57\u6bb5', (() => { const b = []; sweepObjects(I3.data, 'data', b); return b.length === 0; })());
I3.selSession({ currentTarget: { dataset: { dir: 'newer' } } });
eq('I3 \u5411\u65b0\u5207\u56de\u6700\u65b0\u4e00\u573a', I3.data.sessionDate, dateNewest);
I3.switchTab({ currentTarget: { dataset: { tab: 'trend' } } });
eq('I3 \u5207\u5230\u8d8b\u52bf tab', I3.data.tab, 'trend');

// 建议（suggest）形状：容器本身是数组，其子字段必须全为标量
isTrue('I1 suggest \u6761\u6570 = \u52a8\u4f5c\u6570', I1.data.suggest.length === I1.data.perAction.length);
isTrue('I1 suggest[].reason \u662f\u5b57\u7b26\u4e32', I1.data.suggest.every(s => typeof s.reason === 'string'));
isTrue('I1 suggest[].fromTxt/toTxt \u662f\u5b57\u7b26\u4e32',
  I1.data.suggest.every(s => typeof s.fromTxt === 'string' && typeof s.toTxt === 'string'));
isTrue('I1 suggest[].draftW/draftReps/draftSets \u662f\u6570\u5b57',
  I1.data.suggest.every(s => typeof s.draftW === 'number' && typeof s.draftReps === 'number' && typeof s.draftSets === 'number'));
isTrue('I1 suggest[].actionable/editable \u662f\u5e03\u5c14',
  I1.data.suggest.every(s => typeof s.actionable === 'boolean' && typeof s.editable === 'boolean'));
isTrue('I1 hasSuggest = true', I1.data.hasSuggest === true);

// I4 建议可应用 + 一键回填计划（真实组件 + 真实 store 端到端）
const I4 = mkInst();
fakeAppTR.globalData.trainingPlans = [
  { id: 'p1', name: 'A\u65e5', daysPerWeek: 3, actions: [
    { actionId: 'a1', nameZh: '\u5367\u63a8', setsCount: 3, reps: '8', weight: '55' },
    { actionId: 'a9', nameZh: '\u6df1\u8e72', setsCount: 4, reps: '5', weight: '100' }
  ] }
];
fakeAppTR.globalData.activePlanId = 'p1';
fakeAppTR.globalData.trainingLogs = [
  mkLog('l0', 1, 3, [A2('a1', '\u5367\u63a8', [S2(60, 10, 6)])], 'p1'),
  mkLog('l1', 3, 2, [A2('a1', '\u5367\u63a8', [S2(55, 10, 7)])], 'p1'),
  mkLog('l2', 9, 1, [A2('a1', '\u5367\u63a8', [S2(50, 10, 7)])], '')
];
I4.rebuild();
const sg4 = I4.data.suggest.find(s => s.key.indexOf('a1') === 0);
isTrue('I4 \u547d\u4e2d\u8ba1\u5212\u52a8\u4f5c\uff08planMatched\uff09', !!sg4 && sg4.planMatched === true);
isTrue('I4 canApply = true', I4.data.canApply === true);
isTrue('I4 \u5efa\u8bae\u52a0\u91cd\uff08>55\uff09', sg4.draftW > 55);
const badI4 = [];
sweepObjects(I4.data, 'data', badI4);
eq('I4 \u5efa\u8bae\u6570\u636e\u65e0\u5bf9\u8c61\u5f53\u6587\u672c', badI4, []);
I4.applySuggestions();
const paA1 = fakeAppTR.globalData.trainingPlans[0].actions[0];
const paA9 = fakeAppTR.globalData.trainingPlans[0].actions[1];
isTrue('I4 \u8ba1\u5212\u91cd\u91cf\u5df2\u56de\u586b\uff08>55\uff09', Number(paA1.weight) > 55);
eq('I4 \u672a\u5339\u914d\u52a8\u4f5c\u539f\u6837\u4fdd\u7559', paA9.weight, '100');
eq('I4 \u6fc0\u6d3b\u6307\u9488\u672a\u88ab\u6539\u52a8', fakeAppTR.globalData.activePlanId, 'p1');
eq('I4 \u8ba1\u5212 id \u672a\u88ab\u6539\u52a8', fakeAppTR.globalData.trainingPlans[0].id, 'p1');
// 关键回归：回填后本场重新计算 → 计划已高于本场达成 → 不可再加（否则点一次涨一次）
I4.rebuild();
isTrue('I4 回填后本场不可再加（防一直加重量）', I4.data.canApply === false);

// I5 降重端到端：计划高于本场实际且本场吃力 → 建议降重 → 回填 → 计划下调，且不可再降
const I5 = mkInst();
fakeAppTR.globalData.trainingPlans = [
  { id: 'p1', name: 'A日', daysPerWeek: 3, actions: [
    { actionId: 'a1', nameZh: '卧推', setsCount: 3, reps: '8', weight: '80' }
  ] }
];
fakeAppTR.globalData.activePlanId = 'p1';
fakeAppTR.globalData.trainingLogs = [
  mkLog('l0', 1, 2, [A2('a1', '卧推', [S2(60, 8, 8)])], 'p1'),
  mkLog('l1', 4, 1, [A2('a1', '卧推', [S2(60, 8, 7)])], 'p1')
];
I5.rebuild();
const sg5 = I5.data.suggest.find(s => s.key.indexOf('a1') === 0);
isTrue('I5 计划高于本场 → 判定降重', !!sg5 && sg5.deload === true);
eq('I5 降到不超过本场实际 60', sg5.draftW, 60);
eq('I5 箭头向下', sg5.arrow, '↓');
isTrue('I5 canApply = true', I5.data.canApply === true);
const badI5 = [];
sweepObjects(I5.data, 'data', badI5);
eq('I5 降重建议无对象当文本', badI5, []);
I5.applySuggestions();
eq('I5 计划重量已下调到 60', fakeAppTR.globalData.trainingPlans[0].actions[0].weight, '60');
eq('I5 激活指针未被改动', fakeAppTR.globalData.activePlanId, 'p1');
I5.rebuild();
isTrue('I5 回填后不可再降（防一路往下掉）', I5.data.canApply === false);

// 进步趋势改版后的数据形状：新增字段同样不许是对象
isTrue('I1 weeks[].volTxt 是字符串', I1.data.weeks.every(w => typeof w.volTxt === 'string'));
isTrue('I1 weeks[].pct 是数字', I1.data.weeks.every(w => typeof w.pct === 'number'));
isTrue('I1 keyActions[].firstCap/lastCap 是字符串',
  I1.data.keyActions.every(k => typeof k.firstCap === 'string' && typeof k.lastCap === 'string'));
isTrue('I1 records[] 全为标量（无对象当文本）',
  I1.data.records.every(r => typeof r.name === 'string' && typeof r.valTxt === 'string' &&
    typeof r.dateTxt === 'string' && typeof r.isNew === 'boolean'));
isTrue('I1 recordsSummary 是字符串', typeof I1.data.recordsSummary === 'string');
isTrue('I1 trendReady 是布尔', typeof I1.data.trendReady === 'boolean');
eq('I2 空态 records 为空', I2.data.records, []);
eq('I2 空态 trendReady=false', I2.data.trendReady, false);
eq('I2 空态 trendNeed=0', I2.data.trendNeed, 0);

/* ============ J. nextSessionSuggestion —— 下次训练建议 ============ */
console.log('\n[J] nextSessionSuggestion —— 建议回填计划（AC1–AC4）');

// 辅助：阶梯取整 / reps 区间不解析
eq('J roundPlate 61.5 → 62.5', stats.roundPlate(61.5), 62.5);
eq('J roundPlate 102.5 → 102.5', stats.roundPlate(102.5), 102.5);
eq("J singleIntOf('8') = 8", stats.singleIntOf('8'), 8);
eq("J singleIntOf('8-12') = 0（区间不解析）", stats.singleIntOf('8-12'), 0);
eq("J singleIntOf('') = 0", stats.singleIntOf(''), 0);

// AC1a 状态轻松 + 历史容量≥2 场向上 → 加重 +2.5–5%
const jL1 = [
  { date: 'd3', actions: [A('bp', '杠铃', [S(60, 8, 6)])] },
  { date: 'd2', actions: [A('bp', '杠铃', [S(55, 8, 8)])] },
  { date: 'd1', actions: [A('bp', '杠铃', [S(50, 8, 8)])] }
];
const j1 = stats.nextSessionSuggestion(jL1[0].actions, jL1, 0, null);
eq('AC1a 条数', j1.length, 1);
eq('AC1a actionable', j1[0].actionable, true);
eq('AC1a 加重到 62.5（60×1.025 取 2.5 阶梯）', j1[0].draftW, 62.5);
contains('AC1a 理由含「加重」', j1[0].reason, '加重');
isTrue('AC1a key 带唯一后缀（同名动作不串）', j1[0].key.indexOf('#') > 0);

// AC1b rpe ≥ 9 → 维持容量，不增
const jL2 = [
  { date: 'd2', actions: [A('sq', '杠铃', [S(100, 5, 9)])] },
  { date: 'd1', actions: [A('sq', '杠铃', [S(95, 5, 8)])] }
];
const j2 = stats.nextSessionSuggestion(jL2[0].actions, jL2, 0, null);
eq('AC1b 不可应用', j2[0].actionable, false);
contains('AC1b 理由「维持容量」', j2[0].reason, '维持容量');

// AC1c 6 < rpe < 9 → 保持容量稳步推进（零增量）
const jL3 = [
  { date: 'd2', actions: [A('dl', '杠铃', [S(80, 5, 7.5)])] },
  { date: 'd1', actions: [A('dl', '杠铃', [S(75, 5, 7)])] }
];
const j3 = stats.nextSessionSuggestion(jL3[0].actions, jL3, 0, null);
eq('AC1c 不可应用', j3[0].actionable, false);
contains('AC1c 理由「稳步推进」', j3[0].reason, '稳步推进');

// AC1d 首训（无历史无计划）→ 提示
const jL4 = [{ date: 'd1', actions: [A('np', '', [S(40, 10, 6)])] }];
const j4 = stats.nextSessionSuggestion(jL4[0].actions, jL4, 0, null);
eq('AC1d 不可应用', j4[0].actionable, false);
contains('AC1d 提示「首次训练」', j4[0].reason, '首次训练');

// AC4 自重动作 → +1 次，不加重
const jL5 = [
  { date: 'd3', actions: [A('pu', '', [S(0, 10, 6)])] },
  { date: 'd2', actions: [A('pu', '', [S(0, 8, 7)])] },
  { date: 'd1', actions: [A('pu', '', [S(0, 6, 7)])] }
];
const j5 = stats.nextSessionSuggestion(jL5[0].actions, jL5, 0, null);
eq('AC4 自重 actionable', j5[0].actionable, true);
eq('AC4 hasW=false（不加重）', j5[0].hasW, false);
contains('AC4 建议 +1 次（10→11）', j5[0].toTxt, '11');
contains('AC4 理由含「+1 次」', j5[0].reason, '+1 次');

// AC2 计划匹配 → 展示基线取计划目标；但本场未达计划 → 不加（达成闸门）
const planJ = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 4, reps: '8', weight: '60' }] };
const jL6 = [
  { date: 'd2', actions: [A('bp', '', [S(55, 8, 6)])] },
  { date: 'd1', actions: [A('bp', '', [S(50, 8, 7)])] }
];
const j6 = stats.nextSessionSuggestion(jL6[0].actions, jL6, 0, planJ);
eq('AC2 planMatched', j6[0].planMatched, true);
contains('AC2 展示基线取计划 60kg', j6[0].fromTxt, '60kg');
contains('AC2 本场未达计划 → 不加', j6[0].reason, '未达计划重量');
eq('AC2 不可应用', j6[0].actionable, false);
eq('AC2 planActionId 可回填定位', j6[0].planActionId, 'bp');

// J8 达成计划才加重；计划被改高后再算 → 不可再加（**防「一直加重量」**）
const planJ8a = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '60' }] };
const jL8 = [
  { date: 'd2', actions: [A('bp', '', [S(60, 8, 6)])] },
  { date: 'd1', actions: [A('bp', '', [S(55, 8, 7)])] }
];
const j8a = stats.nextSessionSuggestion(jL8[0].actions, jL8, 0, planJ8a);
eq('J8a 达成计划 → 可加重', j8a[0].actionable, true);
eq('J8a 加到 62.5（基数=本场实际 60，单次上限 +2.5）', j8a[0].draftW, 62.5);
// 幂等：计划已被改成 62.5，本场仍是 60 → 再算必须不再加（否则点一次涨一次）
const planJ8b = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '62.5' }] };
const j8b = stats.nextSessionSuggestion(jL8[0].actions, jL8, 0, planJ8b);
eq('J8b 计划已更高 → 不可再加（防无限加重）', j8b[0].actionable, false);
contains('J8b 说明未达新计划', j8b[0].reason, '未达计划重量');

// J9 计划指定次数未达 → 先补次数，不加重量
const planJ9 = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '10', weight: '60' }] };
const jL9 = [
  { date: 'd2', actions: [A('bp', '', [S(60, 6, 6)])] },
  { date: 'd1', actions: [A('bp', '', [S(55, 6, 7)])] }
];
const j9 = stats.nextSessionSuggestion(jL9[0].actions, jL9, 0, planJ9);
eq('J9 次数未达 → 不加', j9[0].actionable, false);
contains('J9 提示先补次数', j9[0].reason, '补足计划次数');

// J10 reps 区间取下界（用于「本场是否达计划次数」判定）
eq("J lowIntOf('8-12') = 8", stats.lowIntOf('8-12'), 8);
eq("J lowIntOf('10') = 10", stats.lowIntOf('10'), 10);
eq("J lowIntOf('') = 0", stats.lowIntOf(''), 0);

// AC1 补充：无吃力记录 → 不臆断，提示先记录
const jL7 = [
  { date: 'd2', actions: [A('bp', '', [{ weight: 60, reps: 8, trainSec: 60, restSec: 30, rpe: '' }])] },
  { date: 'd1', actions: [A('bp', '', [S(55, 8, 7)])] }
];
const j7 = stats.nextSessionSuggestion(jL7[0].actions, jL7, 0, null);
eq('AC1 无 rpe 不可应用', j7[0].actionable, false);
contains('AC1 提示「记录吃力程度」', j7[0].reason, '记录吃力程度');

/* ============ K. 降重（减载） ============ */
console.log('\n[K] nextSessionSuggestion —— 降重（减载）');

// K1 疲劳降载：rpe≥9 且有匹配计划 → 降约 10%（2.5 阶梯取整）
const planK1 = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '60' }] };
const kL1 = [
  { date: 'd2', actions: [A('bp', '', [S(60, 8, 9)])] },
  { date: 'd1', actions: [A('bp', '', [S(60, 8, 6)])] }
];
const k1 = stats.nextSessionSuggestion(kL1[0].actions, kL1, 0, planK1);
eq('K1 rpe≥9 → 可降重', k1[0].actionable, true);
eq('K1 标记 deload', k1[0].deload, true);
eq('K1 降到 55（0.9×60=54 → 2.5 阶梯）', k1[0].draftW, 55);
eq('K1 箭头向下', k1[0].arrow, '↓');
contains('K1 理由点明疲劳', k1[0].reason, '疲劳');

// K2 幂等：按 K1 降重回填后再算 → 已到位，不可再降（**防一路往下掉**）
const planK2 = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '55' }] };
const k2 = stats.nextSessionSuggestion(kL1[0].actions, kL1, 0, planK2);
eq('K2 已降到位 → 不可再降（幂等）', k2[0].actionable, false);
contains('K2 转「接近力竭」维持', k2[0].reason, '接近力竭');

// K3 计划高于本场实际 且 rpe≥8 → 降到不超过本场实际（floorPlate）
const planK3 = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '70' }] };
const kL3 = [
  { date: 'd2', actions: [A('bp', '', [S(60, 8, 8)])] },
  { date: 'd1', actions: [A('bp', '', [S(60, 8, 6)])] }
];
const k3 = stats.nextSessionSuggestion(kL3[0].actions, kL3, 0, planK3);
eq('K3 计划过高且吃力 → 可降重', k3[0].actionable, true);
eq('K3 降到不超过本场实际 60', k3[0].draftW, 60);
contains('K3 理由说明计划高于本场', k3[0].reason, '高于本场');

// K3b 幂等：降到本场后再算 → 不可再降
const planK3b = { id: 'p1', actions: [{ actionId: 'bp', nameZh: '卧推', setsCount: 3, reps: '8', weight: '60' }] };
const k3b = stats.nextSessionSuggestion(kL3[0].actions, kL3, 0, planK3b);
eq('K3b 降到本场后 → 不可再降（幂等）', k3b[0].actionable, false);

// K4 未达计划但 rpe<8（只是没顶上去，不是疲劳）→ 不降，只提示先按计划
const kL4 = [
  { date: 'd2', actions: [A('bp', '', [S(50, 8, 6)])] },
  { date: 'd1', actions: [A('bp', '', [S(55, 8, 7)])] }
];
const k4 = stats.nextSessionSuggestion(kL4[0].actions, kL4, 0, planK1);
eq('K4 rpe<8 未达计划 → 不降（拒绝单场波动）', k4[0].actionable, false);
contains('K4 仍提示先按计划', k4[0].reason, '未达计划重量');

// K5 自重动作 rpe≥9 → 无重量可降，转「维持」
const kL5 = [
  { date: 'd2', actions: [A('pu', '', [S(0, 15, 9)])] },
  { date: 'd1', actions: [A('pu', '', [S(0, 12, 6)])] }
];
const k5 = stats.nextSessionSuggestion(kL5[0].actions, kL5, 0, null);
eq('K5 自重 rpe≥9 → 不降重', k5[0].actionable, false);
contains('K5 理由为接近力竭', k5[0].reason, '接近力竭');

// K6 无匹配计划 → 降重没有可写目标，不臆断
const k6 = stats.nextSessionSuggestion(kL1[0].actions, kL1, 0, null);
eq('K6 无计划 → 不可降重', k6[0].actionable, false);
eq('K6 箭头仍为默认向右', k6[0].arrow, '→');

// K7 floorPlate 取整方向必须向下（「降了不能反而没降」）
eq('K7 floorPlate(54) = 52.5', stats.floorPlate(54), 52.5);
eq('K7 floorPlate(60) = 60', stats.floorPlate(60), 60);
eq('K7 floorPlate(62.5) = 62.5', stats.floorPlate(62.5), 62.5);
eq('K7 floorPlate(1) = 0', stats.floorPlate(1), 0);

/* ============ L. 进步趋势：纵轴口径回归守卫 ============ */
// 为什么单独测：[I] 只扫「数据形状合法」，抓不到「图有没有信息」。
// 2026-09-14 修的两件事——① 纵轴从周均 RPE 换成周训练量（RPE 无方向性，
// 柱高被压在 60%–90%，六根柱永远等高）；② 关键动作柱高/涨跌从峰值重量 topW
// 换成可比容量（旧实现自重动作 topW 恒 0 → 每根柱都 100%，整块图零信息）。
// 这里把那两个「零信息」症状直接写成断言，防止后人改回去。
console.log('\n[L] 进步趋势 —— 训练量纵轴 / 容量柱 / 个人纪录');

const wkMon = dateRange.weekRange(new Date()).monStr;
const mkLogOn = (sid, iso, actions) => ({ sid, date: iso, createdAt: 1, planId: '', programId: '', actions });
const wkOffset = (k) => dateRange.shiftDaysISO(wkMon, k);

// L1 纵轴 = 周总容量（Σ 重量×次数），不是周均 RPE
const L1 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7), S2(60, 10, 7), S2(60, 10, 7)])]),   // 1800
  mkLogOn('b', wkOffset(-7), [A2('bp', '卧推', [S2(30, 10, 7), S2(30, 10, 7), S2(30, 10, 7)])])    // 900
];
L1.rebuild();
const wThis = L1.data.weeks.find(w => w.label === '本周');
const wLast = L1.data.weeks.find(w => w.label === 'W-1');
eq('L1 本周训练量 = 1800（Σ重量×次数）', wThis.vol, 1800);
eq('L1 上周训练量 = 900', wLast.vol, 900);
eq('L1 柱高按容量归一：本周 100%', wThis.pct, 100);
eq('L1 柱高按容量归一：上周 50%', wLast.pct, 50);
isTrue('L1 柱高量级差 ≥40（旧的 RPE 纵轴最多只有 30%）', wThis.pct - wLast.pct >= 40);
eq('L1 柱上带具体训练量文案', wThis.volTxt, '1800');
eq('L1 空周无柱', L1.data.weeks.find(w => w.label === 'W-5').pct, 0);
isTrue('L1 trendReady（3 场 ≥ 门槛 2）', L1.data.trendReady === true);

// L2 自重动作：柱高不再全等，且给出涨跌 chip（旧实现 topW 恒 0 → 全 100% + 只说「N 场」）
const L2 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('pu', '引体向上', [S2(0, 15, 7)])]),
  mkLogOn('b', wkOffset(-7), [A2('pu', '引体向上', [S2(0, 12, 7)])]),
  mkLogOn('c', wkOffset(-14), [A2('pu', '引体向上', [S2(0, 10, 7)])])
];
L2.rebuild();
const ka2 = L2.data.keyActions[0] || { bars: [], chip: {} };
eq('L2 取到自重动作', ka2.name, '引体向上');
isTrue('L2 自重柱高有差异（旧实现全等 100%）', new Set((ka2.bars || []).map(b => b.style)).size >= 2);
eq('L2 自重次数涨了 → chip 判为向上', ka2.chip.cls, 'up');
eq('L2 chip 文案带百分比', ka2.chip.text, '+50%');
eq('L2 首值用容量（次数）', ka2.firstCap, '10');
eq('L2 末值用容量（次数）', ka2.lastCap, '15');
eq('L2 首值文案仍是可读的最好一组', ka2.firstTxt, '自重×10');

// L3 场次不足不画趋势（1 根柱不是趋势）
const L3 = mkInst();
fakeAppTR.globalData.trainingLogs = [mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)])])];
L3.rebuild();
eq('L3 仅 1 场 → trendReady=false', L3.data.trendReady, false);
eq('L3 提示还差 1 次', L3.data.trendNeed, 1);

// L4 个人纪录：按最近刷新排序、近 7 天标「新」、汇总说清刷新几项
const L4 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)])]),      // 600 ← 本周刷新
  mkLogOn('b', wkOffset(-7), [A2('bp', '卧推', [S2(50, 10, 7)])]),     // 500
  mkLogOn('c', wkOffset(-21), [A2('sq', '深蹲', [S2(100, 5, 8)])]),    // 500 ← 21 天前
  mkLogOn('d', wkOffset(-14), [A2('sq', '深蹲', [S2(90, 5, 8)])])      // 450
];
L4.rebuild();
const rec4 = L4.data.records;
eq('L4 有 2 项纪录', rec4.length, 2);
eq('L4 按最近刷新排序（卧推在前）', rec4[0].name, '卧推');
eq('L4 纪录值 = 60kg × 10', rec4[0].valTxt, '60kg × 10');
eq('L4 本周刷新的标记为新纪录', rec4[0].isNew, true);
eq('L4 21 天前的不标记为新', rec4[1].isNew, false);
contains('L4 汇总说明刷新了几项', L4.data.recordsSummary, '刷新 1 项');

// L5 只练过 1 场的动作不算「破纪录」
const L5 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)])]),
  mkLogOn('b', wkOffset(-7), [A2('sq', '深蹲', [S2(100, 5, 8)])])
];
L5.rebuild();
eq('L5 只练过 1 场 → 不计入纪录', L5.data.records.length, 0);
contains('L5 给首次提示', L5.data.recordsSummary, '练满 2 场');

/* ============ M. 关键动作：自动前 3 + 可切换 ============ */
// 为什么测：列表原本写死 groups.slice(0,3)，用户没法看自己真正在意的动作。
// 改成「自动前 3 + 可切换」后，风险点有三个：① 自选顺序没被尊重；② 选了没练过的
// 动作渲染出空卡；③ 勾选超 3 个把卡片撑爆。三条都在这里锁死。
console.log('\n[M] 关键动作 —— 自动前 3 + 可切换');

const storeTR = require(path.join(ROOT, 'utils', 'store.js'));

// M1 无自选 → 自动前 3（场次降序），候选列表默认勾选这 3 个
const M1 = mkInst();
fakeAppTR.globalData.keyActionPicks = [];
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)]), A2('sq', '深蹲', [S2(100, 5, 8)]), A2('row', '划船', [S2(50, 10, 7)]), A2('ohp', '推举', [S2(40, 8, 7)])]),
  mkLogOn('b', wkOffset(-7), [A2('bp', '卧推', [S2(60, 10, 7)]), A2('sq', '深蹲', [S2(100, 5, 8)]), A2('row', '划船', [S2(50, 10, 7)])]),
  mkLogOn('c', wkOffset(-14), [A2('bp', '卧推', [S2(60, 10, 7)]), A2('sq', '深蹲', [S2(100, 5, 8)])])
];
M1.rebuild();
eq('M1 自动取前 3', M1.data.keyActions.length, 3);
eq('M1 场次最多者在前', M1.data.keyActions.map(k => k.name), ['卧推', '深蹲', '划船']);
eq('M1 未自选 → kaCustom=false', M1.data.kaCustom, false);
eq('M1 候选列全部练过的动作', M1.data.pickOptions.map(o => o.name), ['卧推', '深蹲', '划船', '推举']);
eq('M1 候选默认勾选生效中的 3 个', M1.data.pickOptions.filter(o => o.checked).map(o => o.name), ['卧推', '深蹲', '划船']);
contains('M1 候选带场次与最近日期', M1.data.pickOptions[3].metaTxt, '1 场');
eq('M1 已选计数 = 3', M1.data.kaPickedCount, 3);
eq('M1 卡位上限 = 3', M1.data.kaMax, 3);

// 真实 actionKey = 「动作 id + 空格 + 器械」（equip 为空 → 尾部带一个空格），
// 所以这里不硬编码 'bp'，而是从候选里按名字取，避免测试自身写错键
const kaKeyOf = (inst, name) => ((inst.data.pickOptions.filter(o => o.name === name)[0]) || {}).key;
const K_BP = kaKeyOf(M1, '卧推'), K_SQ = kaKeyOf(M1, '深蹲'), K_ROW = kaKeyOf(M1, '划船'), K_OHP = kaKeyOf(M1, '推举');

// M2 自选 → 卡片顺序 = 选择顺序，不受场次排序影响
const M2 = mkInst();
fakeAppTR.globalData.keyActionPicks = [K_OHP, K_BP];
M2.rebuild();
eq('M2 按用户顺序出卡（推举在前）', M2.data.keyActions.map(k => k.name), ['推举', '卧推']);
eq('M2 自选生效 → kaCustom=true', M2.data.kaCustom, true);
eq('M2 自选数量 = 2', M2.data.kaPickedCount, 2);
// 注意：候选列表顺序恒为「场次降序」（方便找动作），只有卡片顺序才跟用户自选
eq('M2 候选勾选态跟随自选', M2.data.pickOptions.filter(o => o.checked).map(o => o.name), ['卧推', '推举']);

// M3 选了没练过的 key → 跳过，不渲染空卡；全无效则回落自动
const M3 = mkInst();
fakeAppTR.globalData.keyActionPicks = ['ghost 铁', K_OHP];
M3.rebuild();
eq('M3 无历史的 key 被跳过', M3.data.keyActions.map(k => k.name), ['推举']);
fakeAppTR.globalData.keyActionPicks = ['ghost 铁'];
M3.rebuild();
eq('M3 全部无效 → 回落自动前 3', M3.data.keyActions.length, 3);
eq('M3 回落时不算自选', M3.data.kaCustom, false);

// M4 落库去重 + 限长 3（脏数据不该把卡片撑爆）
fakeAppTR.globalData.keyActionPicks = [];
storeTR.setKeyActionPicks([K_BP, K_BP, '', K_SQ, K_ROW, K_OHP]);
eq('M4 落库去重去空并截断到 3', storeTR.getKeyActionPicks(), [K_BP, K_SQ, K_ROW]);
storeTR.setKeyActionPicks('not-an-array');
eq('M4 非法入参退化为空数组', storeTR.getKeyActionPicks(), []);

// M5 勾选互斥：满 3 后再勾要被拦住（不落库、不发散）
let TOAST = '';
global.wx.showToast = (o) => { TOAST = (o && o.title) || ''; };
const M5 = mkInst();
fakeAppTR.globalData.keyActionPicks = [];
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)]), A2('sq', '深蹲', [S2(100, 5, 8)]), A2('row', '划船', [S2(50, 10, 7)]), A2('ohp', '推举', [S2(40, 8, 7)])])
];
M5.rebuild();
M5.toggleKaPick({ currentTarget: { dataset: { key: K_OHP } } });
eq('M5 满 3 后勾第 4 个被拦', M5.data.pickOptions.filter(o => o.checked).length, 3);
contains('M5 给出上限提示', TOAST, '最多选 3 个');
M5.toggleKaPick({ currentTarget: { dataset: { key: K_ROW } } });
eq('M5 取消勾选立刻生效', M5.data.pickOptions.filter(o => o.checked).map(o => o.key), [K_BP, K_SQ]);
M5.toggleKaPick({ currentTarget: { dataset: { key: K_OHP } } });
eq('M5 空出名额后可再勾', M5.data.pickOptions.filter(o => o.checked).map(o => o.key), [K_BP, K_SQ, K_OHP]);

// M6 完成 → 落库 + 卡片立即重排；恢复自动 → 清空自选
const M6 = mkInst();
fakeAppTR.globalData.keyActionPicks = [];
M6.rebuild();
M6.toggleKaPick({ currentTarget: { dataset: { key: K_ROW } } });   // 取消「划船」
M6.saveKaPicks();
eq('M6 保存后落库', storeTR.getKeyActionPicks(), [K_BP, K_SQ]);
eq('M6 保存后卡片同步', M6.data.keyActions.map(k => k.key), [K_BP, K_SQ]);
contains('M6 提示已更新', TOAST, '已更新关键动作');
eq('M6 保存后关弹层', M6.data.kaSheet, false);
M6.resetKaPicks();
contains('M6 提示已恢复自动', TOAST, '已恢复自动推荐');
eq('M6 恢复自动 → 自选清空', storeTR.getKeyActionPicks(), []);
eq('M6 恢复自动 → 卡片回到前 3', M6.data.keyActions.length, 3);
eq('M6 恢复自动 → kaCustom 复位', M6.data.kaCustom, false);

// M7 打开弹层丢弃上次未保存的勾选（勾了没点完成就退出）
const M7 = mkInst();
fakeAppTR.globalData.keyActionPicks = [K_BP, K_SQ];
M7.rebuild();
M7.toggleKaPick({ currentTarget: { dataset: { key: K_ROW } } });
M7.toggleKaPick({ currentTarget: { dataset: { key: K_OHP } } });
M7.openKaSheet();
eq('M7 重新打开时勾选态 = 已落库选择', M7.data.pickOptions.filter(o => o.checked).map(o => o.key), [K_BP, K_SQ]);
eq('M7 打开弹层置位', M7.data.kaSheet, true);
eq('M7 打开不改动落库值', storeTR.getKeyActionPicks(), [K_BP, K_SQ]);

// M8 空数据（0 场）时弹层候选与计数一并清空
const M8 = mkInst();
fakeAppTR.globalData.trainingLogs = [];
fakeAppTR.globalData.keyActionPicks = ['bp'];
M8.rebuild();
eq('M8 空态清空候选', M8.data.pickOptions.length, 0);
eq('M8 空态归零计数', M8.data.kaPickedCount, 0);

// M9 宿主页有无自定义 tabBar 决定抽屉是否给底栏让位
// （自定义 tabBar 是框架级固定层，页面里的 z-index 压不住它 → 不让位就会盖住「恢复自动/完成」）
const M9 = mkInst();
fakeAppTR.globalData.trainingLogs = [
  mkLogOn('a', wkOffset(0), [A2('bp', '卧推', [S2(60, 10, 7)])])
];
fakeAppTR.globalData.keyActionPicks = [];
M9.rebuild();
global.getCurrentPages = () => [{ getTabBar: () => ({}) }];
M9.openKaSheet();
eq('M9 数据 tab（有自定义底栏）→ 抽屉预留底栏', M9.data.kaTabSafe, true);
global.getCurrentPages = () => [{ getTabBar: () => null }];
M9.openKaSheet();
eq('M9 底栏组件未挂载 → 不预留', M9.data.kaTabSafe, false);
global.getCurrentPages = () => [{}];
M9.openKaSheet();
eq('M9 普通页（无 getTabBar）→ 不预留', M9.data.kaTabSafe, false);
delete global.getCurrentPages;
M9.openKaSheet();
eq('M9 无 getCurrentPages（Node 环境）不抛错', M9.data.kaTabSafe, false);
eq('M9 探测失败不影响弹层打开', M9.data.kaSheet, true);

fakeAppTR.globalData.keyActionPicks = [];

/* ============ 汇总 ============ */
console.log('\n' + '-'.repeat(56));
console.log('pass=' + pass + '  fail=' + fail);
if (fail) {
  console.log('\u5931\u8d25\u9879\u9700\u4fee\u590d\u540e\u518d\u63d0\u4ea4\u3002');
  process.exit(1);
}
console.log('\u5168\u90e8\u901a\u8fc7 \u2713');

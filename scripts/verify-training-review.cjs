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
isTrue('\u590d\u76d8\u7ec4\u4ef6\u7528\u81ea\u7136\u5468 weekRange(', has(TR_JS, 'dateRange.weekRange('));
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
isTrue('\u5468\u76ee\u6807\u7531\u8ba1\u5212\u51b3\u5b9a\u65f6\u4e0d\u53ef\u6539\uff08UI \u6807\u6ce8\uff09', has(TR_WXML, '\u7531\u8ba1\u5212\u51b3\u5b9a'));
isTrue('\u590d\u76d8\u7ec4\u4ef6\u7a7a\u6001 CTA', has(TR_WXML, 'ph-cta') && has(TR_JS, 'goTrain'));
isTrue('\u7a7a\u6001 CTA \u6837\u5f0f\u5b58\u5728', has(TR_WXSS, '.ph-cta'));
isTrue('\u52aa\u529b\u5ea6\u67f1\u6709 min-height\uff08\u4e0d\u4f1a\u77ee\u5230\u770b\u4e0d\u89c1\uff09', has(TR_JS, 'min-height: 8%'));
isTrue('\u5403\u529b\u5f39\u7a97\u8865 1\u201310 \u6570\u503c\u6620\u5c04', has(TR_JS, '9\u201310') && has(TR_JS, '1\u20134'));

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
const CONTAINERS = { perAction: 1, feelings: 1, keyActions: 1, weeks: 1, weekly: 1, stats: 1, chip: 1, bars: 1 };
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
isTrue('I1 weekly.compStyle \u662f\u5b57\u7b26\u4e32', typeof I1.data.weekly.compStyle === 'string');
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
isTrue('I2 \u7a7a\u6001 weekly.compStyle \u4ecd\u4e3a\u5b57\u7b26\u4e32', typeof I2.data.weekly.compStyle === 'string');

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

/* ============ 汇总 ============ */
console.log('\n' + '-'.repeat(56));
console.log('pass=' + pass + '  fail=' + fail);
if (fail) {
  console.log('\u5931\u8d25\u9879\u9700\u4fee\u590d\u540e\u518d\u63d0\u4ea4\u3002');
  process.exit(1);
}
console.log('\u5168\u90e8\u901a\u8fc7 \u2713');

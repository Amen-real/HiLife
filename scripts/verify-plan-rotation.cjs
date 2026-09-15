#!/usr/bin/env node
/**
 * verify-plan-rotation.cjs —— 模板计划「整套导入 + 自动轮转」回归（零依赖）
 *
 * 背景：用户要求「选模板后我的计划页显示该模板所有计划；本周训练目标按模板 daysPerWeek；
 *      默认训练为 A 日，完成后自动轮 B 日、再 C 日，首页今日推荐同步变化」。
 * 实现要点：模板的每个训练日落地为一个独立 store 计划（同 programId + dayIndex），
 *      「今日计划」= 单指针 activePlanId，训练保存后由 store.advanceActivePlan() 推进。
 *
 * 本脚本防止回归，检查三项：
 *   A. 纯逻辑：utils/planRotation.js 的 nextPlanId / groupPlans / 命名函数（直接单测真实模块）
 *   B. 数据端到端：用真实 presets/plans.js 模拟连续训练，验证 A→B→C→A 轮转与周目标口径
 *   C. 接线：store / plan / workout / home / wxml / wxss 是否按约定接入（字符串结构断言）
 *
 * 追加覆盖（多套方案并存治理）：
 *   · 计划库允许并存多套模板 → groupPlans 分组（一套一组、手动计划聚一组、激活组置顶）
 *   · 训练日志写入 planId/programId 归属 → 计划页按归属统计各组本周进度与完成态
 *   · 修掉「练了 A 套，B 套的卡也全绿」的状态串台（非激活方案显示「未启用」）
 *
 * 用法：node scripts/verify-plan-rotation.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => v ? ok(label) : bad(label);

const rot = require(path.join(ROOT, 'utils', 'planRotation.js'));
const presets = require(path.join(ROOT, 'presets', 'plans.js'));

const P = (id, programId, dayIndex, name) => ({ id, programId, dayIndex, name: name || id });

/* ============ A. nextPlanId：同模板内轮转 ============ */
console.log('\n[A] nextPlanId —— 同模板内推进（A\u2192B\u2192C\u2192A）');
const abc = [
  P('pa', 'prog', 0, 'Prog \u00b7 A \u65e5'),
  P('pb', 'prog', 1, 'Prog \u00b7 B \u65e5'),
  P('pc', 'prog', 2, 'Prog \u00b7 C \u65e5')
];
eq('A \u2192 B', rot.nextPlanId(abc, 'pa'), 'pb');
eq('B \u2192 C', rot.nextPlanId(abc, 'pb'), 'pc');
eq('C \u2192 A（末尾回到首日）', rot.nextPlanId(abc, 'pc'), 'pa');
eq('未知 id \u2192 不轮转', rot.nextPlanId(abc, 'nope'), null);
eq('空列表不崩', [rot.nextPlanId([], 'pa'), rot.nextPlanId(undefined, 'pa'), rot.nextPlanId(abc, undefined)], [null, null, null]);

console.log('\n[A] nextPlanId —— 不该轮转的情形');
eq('手动计划（无 programId）\u2192 null', rot.nextPlanId([P('m1', '', 0, '\u6211\u7684\u80f8\u65e5')], 'm1'), null);
eq('单训练日模板 \u2192 null', rot.nextPlanId([P('s1', 'solo', 0, 'Solo \u00b7 \u5168\u8eab')], 's1'), null);

console.log('\n[A] nextPlanId —— 多模板混合 / 字段缺失');
const mixed = [
  P('a0', 'progA', 0), P('b0', 'progB', 0), P('a1', 'progA', 1), P('b1', 'progB', 1), P('a2', 'progA', 2)
];
eq('A 模板 a0 \u2192 a1（不串到 progB）', rot.nextPlanId(mixed, 'a0'), 'a1');
eq('B 模板 b1 \u2192 b0（自身长度 2 的环绕）', rot.nextPlanId(mixed, 'b1'), 'b0');
const noIdx = [P('x', 'g', undefined), P('y', 'g', undefined)];
eq('dayIndex 缺失视作 0（保持原序）', rot.nextPlanId(noIdx, 'x'), 'y');

/* ============ A. groupPlans：方案分组 + 组序 + 组内升序 ============ */
console.log('\n[A] groupPlans —— 一套方案一组、激活组置顶、组内 A\u2192B\u2192C');
const list = [
  P('m1', '', 0, '\u6211\u7684\u8ba1\u5212\u4e00'),
  P('pa', 'prog', 0, 'P \u00b7 A'), P('pb', 'prog', 1, 'P \u00b7 B'), P('pc', 'prog', 2, 'P \u00b7 C'),
  P('m2', '', 0, '\u6211\u7684\u8ba1\u5212\u4e8c')
];
const snap = list.slice();
const keysOf = (g) => g.map(b => b.key);
const idsOf = (g) => g.map(b => b.plans.map(p => p.id));

// 组键：模板按 programId；手动计划全部归入 MANUAL_KEY（不会每张手动卡各成一组）
eq('两组：prog + 手动组', keysOf(rot.groupPlans(list, 'pa')), ['prog', rot.MANUAL_KEY]);
eq('手动计划聚合在同组且保持原序', rot.groupPlans(list, 'pa')[1].plans.map(p => p.id), ['m1', 'm2']);

// 组序：激活组置顶；组内恒按 dayIndex 升序（A→B→C），与「激活的是哪天」无关
eq('激活 A \u2192 模板组在前，组内 A,B,C',
  idsOf(rot.groupPlans(list, 'pa')), [['pa', 'pb', 'pc'], ['m1', 'm2']]);
eq('激活 B \u2192 组内顺序不受影响（仍 A,B,C）',
  idsOf(rot.groupPlans(list, 'pb')), [['pa', 'pb', 'pc'], ['m1', 'm2']]);
eq('激活手动计划 \u2192 手动组置顶',
  idsOf(rot.groupPlans(list, 'm2')), [['m1', 'm2'], ['pa', 'pb', 'pc']]);
eq('无激活（activePlanId 空）\u2192 保持计划库原序（按组首次出现）',
  idsOf(rot.groupPlans(list, '')), [['m1', 'm2'], ['pa', 'pb', 'pc']]);

// 多套模板并存：各自成组、互不掺和，激活的那套置顶
const two = [
  P('s0', 'strength', 0), P('s1', 'strength', 1), P('s2', 'strength', 2),
  P('h0', 'ppl', 0), P('h1', 'ppl', 1), P('h2', 'ppl', 2)
];
eq('两套模板并存 \u2192 两组，激活组（ppl）置顶',
  idsOf(rot.groupPlans(two, 'h0')), [['h0', 'h1', 'h2'], ['s0', 's1', 's2']]);
eq('两套模板并存 \u2192 切到 strength 则它置顶',
  idsOf(rot.groupPlans(two, 's2')), [['s0', 's1', 's2'], ['h0', 'h1', 'h2']]);

isTrue('groupPlans 不改动入参数组', JSON.stringify(list) === JSON.stringify(snap));
eq('空入参不崩', rot.groupPlans([], 'x'), []);
eq('groupKeyOf：模板取 programId',
  [rot.groupKeyOf({ id: 'p', programId: 'g' }), rot.groupKeyOf({ id: 'm' }), rot.groupKeyOf(null)],
  ['g', rot.MANUAL_KEY, '']);

/* ============ A. 命名函数 ============ */
console.log('\n[A] dayFullName / dayLabel / programLabel');
const N1 = '\u529b\u91cf\u00b7\u57fa\u7840\u4e94\u5927\u9879 \u00b7 A \u65e5 \u00b7 \u4e0b\u80a2\u63a8 + \u4e0a\u80a2\u63a8';
eq('dayFullName 去模板前缀', rot.dayFullName(N1), 'A \u65e5 \u00b7 \u4e0b\u80a2\u63a8 + \u4e0a\u80a2\u63a8');
eq('dayLabel 取短标签', rot.dayLabel(N1, 0), 'A \u65e5');
eq('programLabel 取模板名', rot.programLabel(N1), '\u529b\u91cf\u00b7\u57fa\u7840\u4e94\u5927\u9879');
const N2 = '\u51cf\u8102\u00b7\u5168\u8eab\u5faa\u73af \u00b7 \u5168\u8eab\u5faa\u73af';
eq('单训练日：dayFullName', rot.dayFullName(N2), '\u5168\u8eab\u5faa\u73af');
eq('单训练日：dayLabel 即日名', rot.dayLabel(N2, 0), '\u5168\u8eab\u5faa\u73af');
eq('无分隔符：原样返回', rot.dayFullName('\u6211\u7684\u80f8\u65e5'), '\u6211\u7684\u80f8\u65e5');
eq('空名兜底 dayLabel', rot.dayLabel('', 1), '\u7b2c 2 \u5929');

/* ============ B. 真实模板数据端到端 ============ */
console.log('\n[B] presets/plans.js 数据契约');
const progs = presets.PROGRAMS || [];
isTrue('模板数量 \u2265 4', progs.length >= 4);
let dataOk = true, dataWhy = '';
progs.forEach(p => {
  if (!p.id || !p.name) { dataOk = false; dataWhy = p.name + ' 缺 id/name'; }
  if (!(Number(p.daysPerWeek) > 0)) { dataOk = false; dataWhy = p.name + ' daysPerWeek 非正整数'; }
  if (!Array.isArray(p.days) || !p.days.length) { dataOk = false; dataWhy = p.name + ' days 为空'; }
  (p.days || []).forEach(d => { if (!d.name || !Array.isArray(d.actions) || !d.actions.length) { dataOk = false; dataWhy = p.name + '/' + d.name + ' 训练日不完整'; } });
});
isTrue('每个模板都有 id/name/daysPerWeek>0/days 非空' + (dataOk ? '' : '（' + dataWhy + '）'), dataOk);

// 用真实模板构建 store 计划模型，模拟「连续完成训练」的指针推进
function buildPlans(program) {
  return program.days.map((d, di) => P('x' + di, program.id, di, program.name + ' \u00b7 ' + d.name));
}
const big5 = progs.find(p => p.id === 'strength-big5');
isTrue('存在「力量\u00b7基础五大项」模板', !!big5);
const bp = buildPlans(big5);
eq('五大项展开为 3 张计划卡', bp.length, 3);
eq('导入后默认激活第 0 天（A 日）', rot.dayFullName(bp[0].name), 'A \u65e5 \u00b7 \u4e0b\u80a2\u63a8 + \u4e0a\u80a2\u63a8');
let cur = bp[0].id;
const walk = [];
for (let i = 0; i < 4; i++) { walk.push(cur); cur = rot.nextPlanId(bp, cur); }
eq('连续 4 次完成训练的指针轨迹 = A,B,C,A', walk, ['x0', 'x1', 'x2', 'x0']);
eq('周目标口径 = 模板 daysPerWeek', Number(big5.daysPerWeek), 3);
eq('分组后组内卡片顺序 = A,B,C', idsOf(rot.groupPlans(bp, 'x0'))[0], ['x0', 'x1', 'x2']);

const single = progs.filter(p => p.days.length === 1);
isTrue('存在单训练日模板（减脂/新手）', single.length >= 1);
single.forEach(p => eq(p.name + ' 单训练日不轮转', rot.nextPlanId(buildPlans(p), 'x0'), null));

/* ============ C. 源码接线 ============ */
console.log('\n[C] 源码接线');
const store = read('utils/store.js');
isTrue('store.js 引入 planRotation', /require\(['"]\.\/planRotation\.js['"]\)/.test(store));
isTrue('store.js 定义 advanceActivePlan()', /advanceActivePlan\s*\(\s*\)\s*\{/.test(store));
isTrue('advanceActivePlan 走 planRotation.nextPlanId', /planRotation\.nextPlanId\(/.test(store));
isTrue('store.js 提供 getProgramPlans(programId)', /getProgramPlans\s*\(\s*programId\s*\)/.test(store));
isTrue('store.js 提供 setActiveProgram(programId)', /setActiveProgram\s*\(\s*programId\s*\)/.test(store));
isTrue('store.js 提供 removeProgramPlans(programId)', /removeProgramPlans\s*\(\s*programId\s*\)/.test(store));
isTrue('removeProgramPlans 会清空被删的激活指针', /removeProgramPlans[\s\S]{0,400}?activePlanId\s*=\s*''/.test(store));
isTrue('saveTrainingLog 写入 planId 归属', /planId:\s*log\.planId\s*\|\|\s*''/.test(store));
isTrue('saveTrainingLog 写入 programId 归属', /programId:\s*log\.programId\s*\|\|\s*''/.test(store));

const planJs = read('pages/plan/plan.js');
isTrue('plan.js 定义 importProgram()', /importProgram\s*\(\s*e\s*\)\s*\{/.test(planJs));
isTrue('importProgram 写 daysPerWeek', /daysPerWeek:\s*Number\(program\.daysPerWeek\)/.test(planJs));
isTrue('plan.js 有 ensureProgramPlans（整套展开）', /ensureProgramPlans\s*\(/.test(planJs));
isTrue('plan.js 用 planRotation.groupPlans 分组', /planRotation\.groupPlans\(/.test(planJs));
isTrue('plan.js 定义组头操作 useProgram/removeProgram',
  /useProgram\s*\(\s*e\s*\)\s*\{/.test(planJs) && /removeProgram\s*\(\s*e\s*\)\s*\{/.test(planJs));
isTrue('方案组头周目标取模板 daysPerWeek', /Number\(first\.daysPerWeek\)/.test(planJs));
isTrue('computeWeek 已随 Dashboard 一并移除', !/computeWeek/.test(planJs));
// 串台修复：非激活计划不得再套用「今日已完成」（旧 bug：trainedToday 全局判定 →
// 练了 A 套后 B 套的卡也全绿）。完成态必须由 lastDayByPlan（按 planId 归属）驱动。
isTrue('归属统计收敛到 planRotation 纯函数（weekDatesByKey/weekLastDay/weekDayCount）',
  /planRotation\.weekDatesByKey\(/.test(planJs) && /planRotation\.weekLastDay\(/.test(planJs)
  && /planRotation\.weekDayCount\(/.test(planJs));
isTrue('非激活计划已无「trainedToday ? 今日已完成」分支', !/else\s*\{[\s\S]{0,120}trainedToday[\s\S]{0,60}今日已完成/.test(planJs));
isTrue('未启用方案显示「未启用」', /'未启用'/.test(planJs));
isTrue('激活组内非当天卡显示「待轮换」', /'待轮换'/.test(planJs));

const wo = read('pages/workout/workout.js');
const iLog = wo.indexOf('store.saveTrainingLog(');
const iAdv = wo.indexOf('store.advanceActivePlan()');
isTrue('workout.js 调用 store.advanceActivePlan()', iAdv > 0);
isTrue('轮转发生在 saveTrainingLog 之后', iLog > 0 && iAdv > iLog);
isTrue('轮转仅限计划流（_woSource === "plan" 守卫）', /_woSource\s*===\s*['"]plan['"]/.test(wo));
isTrue('saveTrainingLog 带 planId 归属', /planId:\s*plan\s*\?\s*plan\.id\s*:\s*''/.test(wo));
isTrue('saveTrainingLog 带 programId 归属', /programId:\s*plan\s*\?\s*\(plan\.programId\s*\|\|\s*''\)\s*:\s*''/.test(wo));
isTrue('归属取值在 advanceActivePlan 之前', wo.indexOf('planId: plan ? plan.id') > 0 && wo.indexOf('planId: plan ? plan.id') < iAdv);

const homeJs = read('pages/home/home.js');
// 「今日推荐」的计划命名口径自 2026-09-15 起收进 utils/todayPlan.js（与「我的」页首行共用一份），
// 所以断言要看真源 + 首页的接线，而不是首页里的 planRotation 调用。
const todayPlanJs = read('utils/todayPlan.js');
isTrue('todayPlan.js 引入 planRotation（计划命名口径的真源）', /require\(['"]\.\/planRotation\.js['"]\)/.test(todayPlanJs));
isTrue('todayPlan.js 今日计划标题用 dayFullName', /planRotation\.dayFullName\(/.test(todayPlanJs));
isTrue('todayPlan.js 方案名用 programLabel', /planRotation\.programLabel\(/.test(todayPlanJs));
isTrue('home.js 今日推荐改为调用 todayPlan.resolveTodayPlan', /todayPlan\.resolveTodayPlan\(\)/.test(homeJs));
isTrue('home.js 不再自行解析计划命名（口径只此一份）', !/planRotation/.test(homeJs));

const wxml = read('pages/plan/plan.wxml');
isTrue('plan.wxml 有「导入整套」绑定 importProgram', /bindtap="importProgram"/.test(wxml));
isTrue('plan.wxml 按 groups 渲染方案分组', /wx:for="\{\{groups\}\}"/.test(wxml) && /wx:for-item="g"/.test(wxml));
isTrue('plan.wxml 组头显示方案名与训练日数', /\{\{g\.name\}\}/.test(wxml) && /g\.count/.test(wxml));
isTrue('plan.wxml 组头显示本周进度', /g\.weekTarget/.test(wxml) && /g\.weekDone/.test(wxml));
isTrue('plan.wxml 组头有「使用中」徽章与「设为使用中」',
  /wx:if="\{\{g\.isActive\}\}"[\s\S]{0,200}使用中/.test(wxml) && /tap="useProgram"/.test(wxml));
isTrue('plan.wxml 组头有「移除」整套绑定 removeProgram', /tap="removeProgram"/.test(wxml));
isTrue('plan.wxml 组内卡片用 g.plans', /wx:for="\{\{g\.plans\}\}"/.test(wxml));
isTrue('plan.wxml 卡片标题用 item.cardTitle', /\{\{item\.cardTitle\}\}/.test(wxml));
isTrue('plan.wxml 旧的分组行 item.showGroup 已移除', !/\{\{item\.showGroup\}\}/.test(wxml));
isTrue('菜单/详情文案改为「设为今日计划」（已导入的计划不该说「导入」）',
  !/导入今日训练/.test(wxml) && /设为今日计划/.test(wxml));
// 顶部「本周训练」Dashboard 已按需求整块移除（周进度改由各方案组头承载）
isTrue('plan.wxml 顶部 Dashboard 已移除', !/class="dash"/.test(wxml) && !/week\.barStyle/.test(wxml) && !/\{\{week\./.test(wxml));

const wxss = read('pages/plan/plan.wxss');
isTrue('plan.wxss 有 .tpl-import-all 主 CTA 样式', /\.tpl-import-all\s*\{/.test(wxss));
isTrue('plan.wxss 有方案组头样式 .groups/.group-head', /\.groups\s*\{/.test(wxss) && /\.group-head\s*\{/.test(wxss));
isTrue('plan.wxss 组头徽章/按钮走主题令牌',
  /\.gh-badge\s*\{[^}]*var\(--lime\)/.test(wxss) && /\.gh-btn\s*\{[^}]*var\(--bg\)/.test(wxss));
// --danger-text 已升为 app.wxss 根 token（口径单源）。浅色值不再存在本页，
// 所以这里校验「本页引用 + 本页深色值 + 根 token 提供浅色值」三者齐备。
isTrue('plan.wxss 移除红字走 --danger-text（双主题可达 AA）',
  /\.gh-del\s*\{[^}]*var\(--danger-text\)/.test(wxss) &&
  /theme-dark[\s\S]{0,900}--danger-text:\s*#FF6B70/.test(wxss) &&
  /--danger-text:\s*#C4363B/.test(read('app.wxss')));
isTrue('plan.wxss 旧 .plan-group 样式已移除', !/\.plan \.plan-group\s*\{/.test(wxss));
isTrue('plan.wxss Dashboard 样式已移除',
  !/\.dash\s*\{/.test(wxss) && !/\.dc-num\s*\{/.test(wxss) && !/\.ds-num\s*\{/.test(wxss) && !/dash-stat-sep/.test(wxss));
isTrue('plan.wxss CTA 用主题令牌（非硬编码底色）', /\.tpl-import-all\s*\{[^}]*var\(--primary\)/.test(wxss));

/* ============ D. 归属统计端到端（真实 store + 真实纯函数） ============ */
// 回答「计划页的『本周 0/3』能否正确记录到训练进度」：
// stub 掉 getApp() 后加载【真实 utils/store.js】，完整走一遍
// 导入整套模板 → 连续完成 3 次训练（写归属日志 + 推进指针）→ 用真实的
// planRotation.weekDatesByKey / weekDayCount / weekLastDay 统计，验证 0/3 → 3/3。
console.log('\n[D] 归属统计端到端（真实 store）');

const p2 = (n) => (n < 10 ? '0' + n : '' + n);
const fmtD = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
// 本周一 / 下周一（与 plan.js weekRange 同口径：周日归上一周）
const _mon = (() => {
  const x = new Date();
  const dw = x.getDay();
  x.setDate(x.getDate() + (dw === 0 ? -6 : 1 - dw));
  x.setHours(0, 0, 0, 0);
  return x;
})();
const MON = fmtD(_mon);
const SUN = fmtD(new Date(_mon.getFullYear(), _mon.getMonth(), _mon.getDate() + 7));
const dayInWeek = (i) => fmtD(new Date(_mon.getFullYear(), _mon.getMonth(), _mon.getDate() + i));

// stub getApp()：store.js 的读写全部经 getApp().globalData / getApp().persist()
const fakeApp = {
  globalData: {
    trainingPlans: [], trainingLogs: [], activePlanId: '', selectedActions: [],
    meals: [], weightRecords: [], profile: { fitnessDays: 0 }
  },
  persist() {}
};
global.getApp = () => fakeApp;
const realStore = require(path.join(ROOT, 'utils', 'store.js'));

// 按 plan.js ensurePlanForDay 落库的形状导入「力量·基础五大项」整套
big5.days.forEach((d, di) => {
  fakeApp.globalData.trainingPlans.push({
    id: 'e2e' + di, programId: big5.id, dayIndex: di,
    name: big5.name + ' \u00b7 ' + d.name,
    daysPerWeek: Number(big5.daysPerWeek) || 0,
    goal: big5.goal, level: big5.level, actions: d.actions || []
  });
});
realStore.setActivePlan('e2e0');

const weekByProgram = () => rot.weekDatesByKey(realStore.get().trainingLogs, 'programId', MON, SUN);
const weekDone = () => rot.weekDayCount(weekByProgram(), big5.id);

eq('导入后本周进度 = 0/3', weekDone(), 0);
eq('组头周目标 = 模板 daysPerWeek（3）', Number(big5.daysPerWeek), 3);

// 连续完成 3 次训练：取当前激活计划 → 写带归属的日志 → 推进指针（与 workout.saveWorkout 同序）
const walked = [];
for (let i = 0; i < 3; i++) {
  const p = realStore.getActivePlan();
  walked.push(p.id);
  realStore.saveTrainingLog({
    date: dayInWeek(i), actions: [], planId: p.id, programId: p.programId || ''
  });
  eq('完成第 ' + (i + 1) + ' 次后本周进度 = ' + (i + 1) + '/3', weekDone(), i + 1);
  realStore.advanceActivePlan();
}
eq('三次训练分别归属 A/B/C 三张卡', walked, ['e2e0', 'e2e1', 'e2e2']);
eq('三次落在三个不同训练日 → 计 3 天', weekDone(), 3);

// 同一天再练一次：不重复累加（口径 = 训练「日数」，与 fitnessDays 一致）
realStore.saveTrainingLog({ date: dayInWeek(0), actions: [], planId: 'e2e0', programId: big5.id });
eq('同一天再练一次仍是 3/3', weekDone(), 3);

// 自由训练（无 planId/programId）不污染任何方案进度
const nBefore = realStore.get().trainingLogs.length;
realStore.saveTrainingLog({ date: dayInWeek(1), actions: [], planId: '', programId: '' });
isTrue('自由训练日志仍会写入', realStore.get().trainingLogs.length === nBefore + 1);
eq('自由训练不计入方案进度', weekDone(), 3);

// 上周的归属日志不计入本周
realStore.saveTrainingLog({
  date: fmtD(new Date(_mon.getFullYear(), _mon.getMonth(), _mon.getDate() - 7)),
  actions: [], planId: 'e2e0', programId: big5.id
});
eq('上周日志不计入本周进度', weekDone(), 3);

// 单卡完成态：按 planId 归属取本周最近一次完成日
const byPlan = rot.weekDatesByKey(realStore.get().trainingLogs, 'planId', MON, SUN);
eq('A 日卡最近完成日 = 本周第 1 天', rot.weekLastDay(byPlan, 'e2e0'), dayInWeek(0));
eq('没训练过的计划无完成日', rot.weekLastDay(byPlan, 'nope'), '');

// 两套方案并存：进度互不掺和
realStore.get().trainingPlans.push({ id: 'h0', programId: 'other-prog', dayIndex: 0, name: 'Other \u00b7 X', daysPerWeek: 2, actions: [] });
eq('另一套方案进度独立为 0', rot.weekDayCount(weekByProgram(), 'other-prog'), 0);
eq('原方案进度不受影响', weekDone(), 3);

/* ============ 汇总 ============ */
console.log('\n' + '-'.repeat(52));
console.log('pass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

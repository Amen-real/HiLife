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
 *   A. 纯逻辑：utils/planRotation.js 的 nextPlanId / sortPlans / 命名函数（直接单测真实模块）
 *   B. 数据端到端：用真实 presets/plans.js 模拟连续训练，验证 A→B→C→A 轮转与周目标口径
 *   C. 接线：store / plan / workout / home / wxml / wxss 是否按约定接入（字符串结构断言）
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

/* ============ A. sortPlans：分组置顶 + 组内升序 ============ */
console.log('\n[A] sortPlans —— 激活组置顶、组内 A\u2192B\u2192C');
const list = [
  P('m1', '', 0, '\u6211\u7684\u8ba1\u5212\u4e00'),
  P('pa', 'prog', 0, 'P \u00b7 A'), P('pb', 'prog', 1, 'P \u00b7 B'), P('pc', 'prog', 2, 'P \u00b7 C'),
  P('m2', '', 0, '\u6211\u7684\u8ba1\u5212\u4e8c')
];
const snap = list.slice();
// 说明：激活「组」置顶后，组内仍按 dayIndex 升序（A→B→C）——用户要求卡片固定展示 A/B/C 顺序，
//      「今日」由卡片上的标签标识，而非把当天那张提到组内第一位。
eq('激活 B \u2192 组置顶且组内仍是 A,B,C，手动计划随后',
  rot.sortPlans(list, 'pb').map(p => p.id), ['pa', 'pb', 'pc', 'm1', 'm2']);
eq('激活 C \u2192 同上（组内顺序不受激活项影响）',
  rot.sortPlans(list, 'pc').map(p => p.id), ['pa', 'pb', 'pc', 'm1', 'm2']);
eq('激活 A \u2192 A,B,C,然后手动计划',
  rot.sortPlans(list, 'pa').map(p => p.id), ['pa', 'pb', 'pc', 'm1', 'm2']);
eq('激活手动计划 \u2192 手动优先、模板组仍连续',
  rot.sortPlans(list, 'm2').map(p => p.id), ['m2', 'm1', 'pa', 'pb', 'pc']);
isTrue('sortPlans 不改动入参数组', JSON.stringify(list) === JSON.stringify(snap));
eq('空入参不崩', rot.sortPlans([], 'x'), []);

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
eq('排序后卡片顺序 = A,B,C', rot.sortPlans(bp, 'x0').map(p => p.id), ['x0', 'x1', 'x2']);

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

const planJs = read('pages/plan/plan.js');
isTrue('plan.js 定义 importProgram()', /importProgram\s*\(\s*e\s*\)\s*\{/.test(planJs));
isTrue('importProgram 写 daysPerWeek', /daysPerWeek:\s*Number\(program\.daysPerWeek\)/.test(planJs));
isTrue('plan.js 有 ensureProgramPlans（整套展开）', /ensureProgramPlans\s*\(/.test(planJs));
isTrue('plan.js 用 planRotation.sortPlans 排卡片', /planRotation\.sortPlans\(/.test(planJs));
isTrue('computeWeek 目标仍取 active.daysPerWeek', /active\s*&&\s*active\.daysPerWeek/.test(planJs));

const wo = read('pages/workout/workout.js');
const iLog = wo.indexOf('store.saveTrainingLog(');
const iAdv = wo.indexOf('store.advanceActivePlan()');
isTrue('workout.js 调用 store.advanceActivePlan()', iAdv > 0);
isTrue('轮转发生在 saveTrainingLog 之后', iLog > 0 && iAdv > iLog);
isTrue('轮转仅限计划流（_woSource === "plan" 守卫）', /_woSource\s*===\s*['"]plan['"]/.test(wo));

const homeJs = read('pages/home/home.js');
isTrue('home.js 引入 planRotation', /require\(['"]\.\.\/\.\.\/utils\/planRotation\.js['"]\)/.test(homeJs));
isTrue('home.js 今日推荐标题用 dayFullName', /planRotation\.dayFullName\(/.test(homeJs));

const wxml = read('pages/plan/plan.wxml');
isTrue('plan.wxml 有「导入整套」绑定 importProgram', /bindtap="importProgram"/.test(wxml));
isTrue('plan.wxml 卡片渲染组名 item.showGroup', /\{\{item\.showGroup\}\}/.test(wxml));
isTrue('plan.wxml 卡片标题用 item.cardTitle', /\{\{item\.cardTitle\}\}/.test(wxml));

const wxss = read('pages/plan/plan.wxss');
isTrue('plan.wxss 有 .tpl-import-all 主 CTA 样式', /\.tpl-import-all\s*\{/.test(wxss));
isTrue('plan.wxss 有 .plan .plan-group 组名样式', /\.plan \.plan-group\s*\{/.test(wxss));
isTrue('plan.wxss CTA 用主题令牌（非硬编码底色）', /\.tpl-import-all\s*\{[^}]*var\(--primary\)/.test(wxss));

/* ============ 汇总 ============ */
console.log('\n' + '-'.repeat(52));
console.log('pass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

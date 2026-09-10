#!/usr/bin/env node
/**
 * verify-goal-vocab.cjs —— 身体目标词表一致性 + 行为回归（零依赖）
 *
 * 背景：历史上「减重」与「减脂」被两个模块分别使用（settings 用减重、计划库/营养用减脂），
 * 语义相同却让用户在两个页面看到两个词指同一件事。现已统一到 utils/nutrition.js 的
 * GOALS 单一真源，历史值经 normalizeGoal 归一。
 *
 * 本脚本防止回归，检查三项：
 *   A. 行为：别名归一后与规范词逐字段等价，且四个目标分支仍各自成立（容差 ±2 kcal）
 *   B. 一致性：settings 复用真源、无本地 GOALS、代码里无「减重」引号字面量（别名表除外）
 *   C. 映射完整性：plan 页 GOAL_THUMB 覆盖全部 goalOptions 与预设计划用到的 goal
 *
 * 用法：node scripts/verify-goal-vocab.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b)) ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const near = (label, got, want, tol) => (Math.abs(got - want) <= tol)
  ? ok(label + '（' + got + ' ≈ ' + Math.round(want) + '）')
  : bad(label + '  expect≈' + Math.round(want) + ' got=' + got);

const n = require(path.join(ROOT, 'utils', 'nutrition.js'));

/* ============ A. 行为回归 ============ */
console.log('\n[A] normalizeGoal 别名归一');
eq('减重 → 减脂', n.normalizeGoal('减重'), '减脂');
eq('减肥 → 减脂', n.normalizeGoal('减肥'), '减脂');
eq('增重 → 增肌', n.normalizeGoal('增重'), '增肌');
eq('规范词原样', [n.normalizeGoal('增肌'), n.normalizeGoal('塑形'), n.normalizeGoal('保持')], ['增肌', '塑形', '保持']);
eq('空值 → 空串', [n.normalizeGoal(''), n.normalizeGoal(undefined), n.normalizeGoal(null)], ['', '', '']);
eq('未知值不吞掉', n.normalizeGoal('自定义'), '自定义');

console.log('\n[A] goalDefault：减重/减脂 同值');
eq('减重 = 减脂 = 1800', [n.goalDefault('减重'), n.goalDefault('减脂')], [1800, 1800]);
eq('增肌 2400 / 塑形 2000 / 保持 2100', [n.goalDefault('增肌'), n.goalDefault('塑形'), n.goalDefault('保持')], [2400, 2000, 2100]);

const base = { gender: '男', currentWeight: 70, height: 175, age: 30, activityLevel: 'moderate' };
const intake = (g) => n.recommendIntake(Object.assign({}, base, { goal: g }));

console.log('\n[A] recommendIntake：减重 vs 减脂 逐字段一致');
const a = intake('减重'), b = intake('减脂');
eq('kcal/bmr/tdee/method 全等', [a.kcal, a.bmr, a.tdee, a.method], [b.kcal, b.bmr, b.tdee, b.method]);

console.log('\n[A] 四个目标分支仍各自成立（用未取整 TDEE 参与乘法，故留 ±2 容差）');
const gain = intake('增肌'), cut = intake('减脂'), shape = intake('塑形'), keep = intake('保持');
near('增肌 ≈ TDEE×1.10', gain.kcal, keep.tdee * 1.10, 2);
near('减脂 ≈ TDEE×0.80', cut.kcal, keep.tdee * 0.80, 2);
near('塑形 ≈ TDEE×0.90', shape.kcal, keep.tdee * 0.90, 2);
eq('保持 = TDEE', keep.kcal, keep.tdee);
eq('增肌 > 塑形 > 减脂', gain.kcal > shape.kcal && shape.kcal > cut.kcal, true);
eq('减脂 kcal ≥ BMR（护栏生效）', cut.kcal >= cut.bmr, true);

console.log('\n[A] recommendMacros：减重 vs 减脂 一致');
eq('蛋白/碳水/脂肪 全等', n.recommendMacros({ kcal: 1800, goal: '减重', weight: 70 }), n.recommendMacros({ kcal: 1800, goal: '减脂', weight: 70 }));

/* ============ B. 一致性 ============ */
console.log('\n[B] settings 复用单一真源');
const s = read('pages/settings/settings.js');
(/const GOALS = nutrition\.GOALS;/.test(s)) ? ok('从 nutrition 引入 GOALS') : bad('settings 未复用 nutrition.GOALS');
(/const GOALS = \[/.test(s)) ? bad('settings 仍本地定义 GOALS（双真源）') : ok('settings 无本地 GOALS 定义');
(/goalIndex:\s*Math\.max\(0, GOALS\.indexOf\(goal\)\)/.test(s)) ? ok('goalIndex 走归一后的 goal') : bad('goalIndex 未归一 → 历史「减重」会被兜到第一项');

console.log('\n[B] 代码里不得再出现「减重」引号字面量（别名表除外）');
['app.js', 'utils/store.js', 'pages/settings/settings.js', 'pages/profile/profile.js', 'pages/advice/advice.js', 'pages/home/home.js', 'pages/plan/plan.js'].forEach(f => {
  (/['"]减重['"]/.test(read(f))) ? bad(f + ' 仍含「减重」字面量') : ok(f + ' 无「减重」字面量');
});
(/GOAL_ALIAS[\s\S]{0,200}'减重': '减脂'/.test(read('utils/nutrition.js'))) ? ok('nutrition.js 保留别名表（兼容历史数据）') : bad('nutrition.js 别名表缺失');

/* ============ C. 映射完整性 ============ */
console.log('\n[C] GOAL_THUMB 覆盖全部 goalOptions');
const plan = read('pages/plan/plan.js');
const options = plan.match(/goalOptions:\s*\[([^\]]+)\]/)[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
const thumbKeys = [...plan.match(/const GOAL_THUMB = \{([\s\S]*?)\n\};/)[1].matchAll(/'([^']+)':\s*\{/g)].map(m => m[1]);
options.forEach(o => thumbKeys.includes(o) ? ok('「' + o + '」有缩略图') : bad('「' + o + '」缺缩略图 → 静默落到 DEFAULT_THUMB'));

console.log('\n[C] 预设计划 goal 全覆盖');
const presetGoals = [...new Set([...read('presets/plans.js').matchAll(/goal:\s*'([^']+)'/g)].map(m => m[1]))];
presetGoals.forEach(g => thumbKeys.includes(g) ? ok('预设「' + g + '」有缩略图') : bad('预设「' + g + '」缺缩略图'));

console.log('\n真源投影：GOALS(身体目标)=' + JSON.stringify(n.GOALS) + '  plan goals=' + JSON.stringify(options));
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

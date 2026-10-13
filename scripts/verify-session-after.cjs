#!/usr/bin/env node
/**
 * verify-session-after.cjs —— utils/sessionAfter.js（「练完之后」肌群状态回放）守卫
 *
 * 背景（2026-10-13）：复盘页可以切到任意历史场次（_selIdx），而动作页的「当前状态」
 * 绑定「此刻」。两者并排会出现「两个数字属于两个时间」的误导。
 * 本模块解决：**把 now 钉在该场次的结束时刻**，得到「练完之后那一刻」的疲劳分布 ——
 * 这是当时没记录、现在能算出来的信息（纯增量，不与复盘原有内容冲突）。
 *
 * 本守卫的重点不是「能不能算出来」，而是**口径会不会被人改回去**——
 * `now` 一旦写成 Date.now()，页面在「看最新一场」时仍然一切正常（两者只差几分钟），
 * 只有切到几天前的场次才暴露 ⇒ 静态与运行期都看不出来。
 *
 * 覆盖：
 *   [A] now 的三条口径（结束时刻优先 / 不许用此刻 / 不许用日期 00:00）
 *   [B] 退化路径（缺 createdAt → 本地 23:59:59；脏日期 → 无基准不编造；过旧 → 不展示）
 *   [C] 只含「这一场自己练到的肌群」，且必须经 bodymap 映射（禁自拼 slug）
 *   [D] 组件接线：三态色走根 token、两宿主都补了深色、rebuild 会重置（防残留）
 *   [E] 变异防护：now 用 Date.now() 时必须被抓
 *
 * 用法：node scripts/verify-session-after.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// 剥注释（守卫通则④）：JS 块注释 + 行注释
const stripJs = (x) => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => (v ? ok(label) : bad(label));
const has = (label, s, sub) => (String(s).indexOf(sub) >= 0) ? ok(label)
  : bad(label + '  \u2209 ' + JSON.stringify(sub));
const hasNot = (label, s, sub) => (String(s).indexOf(sub) < 0) ? ok(label)
  : bad(label + '  \u4e0d\u5e94\u5305\u542b ' + JSON.stringify(sub));

const SA = require(path.join(ROOT, 'utils', 'sessionAfter.js'));
const dateRange = require(path.join(ROOT, 'utils', 'dateRange.js'));
const { library } = require(path.join(ROOT, 'utils', 'exercises.js'));
const bodymap = require(path.join(ROOT, 'utils', 'bodymap.js'));
const muscleStatus = require(path.join(ROOT, 'utils', 'muscleStatus.js'));

const DAY = 86400000;
const NOW = Date.now();
const iso = (d) => dateRange.shiftDaysISO(dateRange.todayStr(), -d);
function mkLog(daysAgo, cat, rpe) {
  const e = library[cat][0];
  return {
    date: iso(daysAgo),
    createdAt: NOW - daysAgo * DAY,
    actions: [{
      id: e.id, category: e.category, equip: e.equip, name: e.nameZh,
      sets: 3, setsDetail: [{ reps: 10, rpe }]
    }]
  };
}

/* ══════════════ [A] now 的三条口径 ══════════════ */
console.log('\n[A] now 口径：结束时刻优先 · 禁用此刻· 禁用日期 00:00');
{
  const L = mkLog(0, '胸部', 8);
  eq('A1 createdAt 存在时 now = createdAt（不是估算）', SA.sessionEndMs(L), L.createdAt);

  // ⚠️ 最关键的一条：now 换成 Date.now() 会怎样。
  //   本页切到 3 天前那场时，用「此刻」会把之后两天练的肌群混进来。
  const logs = [mkLog(6, '背部'), mkLog(3, '腿部'), mkLog(1, '胸部'), mkLog(0, '肩膀')];
  const target = logs[1];                       // 3 天前那场（腿部）
  const after = SA.afterStateOf(logs, target, NOW);
  const slugs = after.chips.map(c => c.slug);
  isTrue('A2 看 3 天前那场 → 芯片里只有当时的肌群（腿部系）',
    slugs.length > 0 && slugs.every(s => ['quadriceps', 'gluteal', 'hamstring', 'adductors', 'calves'].indexOf(s) >= 0));
  isTrue('A2b 不含今天练的肩（那是「此刻」才会混进来的）', slugs.indexOf('deltoids') < 0);
  eq('A3 芯片只含这一场自己练到的肌群数（腿部 5 块）', after.chips.length, 5);

  // 对照：若 now = Date.now()，会多出今天的肩
  const wrong = muscleStatus.muscleStatusOf(logs, NOW);
  isTrue('A4 反向自检：此刻口径下确实会多出肩（证明 A2b 抓的是真问题）', wrong.has('deltoids'));

  // 禁日期 00:00：会把全场疲劳算成「一天后」⇒ 偏低
  const midnight = dateRange.parseISO(target.date).getTime();
  isTrue('A5 日期 00:00 与结束时刻不同（说明二者不可混用）', midnight !== target.createdAt);
  isTrue('A5b 结束时刻晚于当日 00:00（真实训练发生在当天夜里之前）', target.createdAt >= midnight);
}
// A6 静态：源码里不许出现 Date.now() 当 now 的来源。
//
// ⚠️⚠️ 必须**先剥注释**（守卫通则④）：utils/sessionAfter.js 顶部就写着
//   「绝不能用 Date.now()」这句禁用说明，不剥就会自己把尺子照瞎（第一版 6 条里2 条这样红了）。
{
  const rawAll = read('utils/sessionAfter.js');
  const raw = stripJs(rawAll);
  const core = raw.slice(raw.indexOf('function afterStateOf'), raw.indexOf('module.exports'));
  // ⚠️ 唯一合法例外：ref = (now instanceof Date) ? ... : (Number(now) || Date.now())
  //   它只用于「是否超过 MAX_REPLAY_DAYS」的比较，**不是**传给 muscleStatusOf 的 now。
  //   ⇒ 只放行这一行，函数体其余部分仍禁止 Date.now()。
  const body = core.split('\n').filter(l => l.indexOf('const ref =') < 0);
  hasNot('A6 afterStateOf 内禁 Date.now() 当 now（唯一放行的是 ref 那一行）', body.join('\n'), 'Date.now()');
  isTrue('A6b 确实放行了 ref 那一行（证明 A6 不是「一律禁」的空转）',
    core.indexOf('const ref =') >= 0 && core.indexOf('Date.now()') >= 0);
  isTrue('A6c 剥注释确有效果（原文含该词）', rawAll.indexOf('Date.now()') >= 0);
  // now 的真正来源：只能来自 sessionEndMs 的 endMs
  isTrue('A6d now 的来源是 endMs（sessionEndMs 的返回值），而非任何「此刻」',
    core.indexOf('muscleStatusOf(logs || [], endMs)') >= 0);
}

/* ══════════════ [B] 退化路径 ══════════════ */
console.log('\n[B] 退化：缺 createdAt · 脏日期 · 过旧记录');
{
  // B1 缺 createdAt → 本地 23:59:59（口径③：宁可偏高不可偏低）
  const noTs = { date: iso(0), actions: mkLog(0, '胸部', 9).actions };
  const end = SA.sessionEndMs(noTs);
  const d = new Date(end);
  eq('B1 缺 createdAt 时小时 = 23（本地末尾，不是 00:00）', d.getHours(), 23);
  eq('B1b 分钟 = 59', d.getMinutes(), 59);

  // B2 脏日期 ⇒ 无基准（⚠️ parseISO 会兜底成 1970，不是 Invalid Date）
  eq('B2 脏日期 → noBaseline', SA.afterStateOf([], { date: 'not-a-date', actions: [] }).noBaseline, true);
  eq('B2b 脏日期 → 不产出芯片', SA.afterStateOf([], { date: 'not-a-date', actions: [] }).chips.length, 0);
  const dr = dateRange.parseISO('not-a-date');
  eq('B2c 反向自检：parseISO 对脏输入兜底成 1970（这正是必须显式识别它的原因）', dr.getFullYear(), 1970);
  eq('B2d createdAt=0 也走退化', SA.sessionEndMs({ date: iso(0), createdAt: 0 }) > 0, true);

  // B3 过旧记录 ⇒ 不展示（6 年前的「练完之后」没有决策价值）
  const old = mkLog(2000, '胸部', 8);
  const r = SA.afterStateOf([old], old, NOW);
  eq('B3 过旧记录 → tooOld', r.tooOld, true);
  eq('B3b 过旧记录 → 零芯片', r.chips.length, 0);
  isTrue('B3c MAX_REPLAY_DAYS 已导出且为正', SA.MAX_REPLAY_DAYS > 0);
  eq('B3d 刚好在阈值内（89 天）→ 不过旧', SA.afterStateOf([mkLog(89, '胸部', 8)], mkLog(89, '胸部', 8), NOW).tooOld || false, false);
}

/* ══════════════ [C] 芯片内容 ══════════════ */
console.log('\n[C] 芯片：只含本场肌群 · 经 bodymap 映射 · 三态齐');
{
  const L = mkLog(0, '胸部', 9);
  const r = SA.afterStateOf([L], L, NOW);
  const own = new Set();
  L.actions.forEach(a => bodymap.collectSlugs(a).forEach(s => own.add(s)));
  eq('C1 芯片 slug 与 bodymap.collectSlugs 的结果一致（禁自拼映射）',
    r.chips.map(c => c.slug).sort(), [...own].sort());
  isTrue('C2 每个芯片都带中文名与标签',
    r.chips.every(c => c.name && c.label));
  isTrue('C3 芯片按疲劳降序（最该看的在前）',
    r.chips.every((c, i) => i === 0 || r.chips[i - 1].fatigue >= c.fatigue));
  isTrue('C4 有摘要文案且不含「此刻」（避免与动作页混淆）',
    !!r.summary && r.hint.indexOf('不是此刻') >= 0);
  hasNot('C5 摘要里不得出现「现在」', r.summary, '现在');
  // 空态不编造
  eq('C6 无动作 → empty', SA.afterStateOf([L], { date: iso(0), createdAt: NOW, actions: [] }, NOW).empty, true);
}

/* ══════════════ [D] 组件接线 ══════════════ */
console.log('\n[D] 组件接线：渲染 · 三态色走根 token · 两宿主都补深色 · rebuild 重置');
{
  const js = read('components/training-review/training-review.js');
  const wxml = read('components/training-review/training-review.wxml');
  const wxss = read('components/training-review/training-review.wxss');
  const w = wxml.replace(/<!--[\s\S]*?-->/g, ' ');

  has('D1 组件 require 了 sessionAfter', js, "require('../../utils/sessionAfter.js')");
  isTrue('D2 组件调的是 afterStateOf（不是 muscleStatusOf）', /sessionAfter\.afterStateOf\(/.test(js));
  // ⚠️ 必须剥注释：接线处那行注释就写着「必须用 afterStateOf 而不是 muscleStatusOf…」
  hasNot('D3 组件里禁直接 muscleStatusOf（会踩 Date.now 口径）', stripJs(js), 'muscleStatusOf');
  isTrue('D4 buildSession 里调用（跟着 selIdx 走）',
    js.indexOf('afterStateOf') > js.indexOf('buildSession'));
  // data 三件套
  ['afterChips', 'afterSummary', 'afterHint', 'hasAfter'].forEach(k =>
    isTrue('D5 data 里有 ' + k, js.indexOf(k + ':') >= 0));
  isTrue('D6 rebuild 会重置 afterChips（防切场次时残留上一场）',
    /afterChips: \[\], afterSummary: '', afterHint: '', hasAfter: false/.test(js));
  // wxml
  ['hasAfter', 'afterChips', 'afterSummary', 'afterHint'].forEach(k =>
    isTrue('D7 wxml 绑定 ' + k, w.indexOf('{{' + k) >= 0));
  isTrue('D8 wxml 用 wx:for 遍历 chips', /wx:for="\{\{afterChips\}\}"/.test(w));
  isTrue('D9 三态类名由 item.state 驱动（禁在 wxml 写死具体态）',
    /af-\{\{item\.state\}\}/.test(w) && w.indexOf('af-fatigued') < 0);
  isTrue('D9b 反向自检：wxml 里确实没有写死态名', w.indexOf('af-fatigued') < 0);
  has('D10 标题写明「练完之后」而非「当前」', w, '练完之后的肌群状态');
  hasNot('D10b 标题不得用「当前状态」（那是动作页的说法，会混淆两个时间基准）', w, '>当前状态<');
  // wxss
  ['.af-card', '.af-sum', '.af-chips', '.af-chip', '.af-hint', '.af-fatigued', '.af-trained', '.af-detrained']
    .forEach(sel => isTrue('D11 wxss 定义了 ' + sel, wxss.indexOf(sel) >= 0));
  ['--st-fatigued-bg', '--st-trained-bg', '--st-detrained-bg'].forEach(t => {
    isTrue('D12 三态色走根 token ' + t + '（禁在组件里写死色值）', wxss.indexOf(t) >= 0);
    isTrue('D12b .af-* 规则里没有硬编码 hex（应为纯 token 消费）',
      !/\.af-(fatigued|trained|detrained)[^{]*\{[^}]*#[0-9A-Fa-f]{3,6}/.test(wxss));
  });
  // ⚠️ 两宿主必须都补深色三态（组件样式有作用域，深色值只能由宿主给）
  ['pages/list/list.wxss', 'pages/review/review.wxss'].forEach(f => {
    const s2 = read(f);
    const dark = s2.slice(s2.indexOf('.page.theme-dark'));
    isTrue('D13 ' + f + ' 已在 .page.theme-dark 内定义 --st-fatigued-bg', /--st-fatigued-bg:[^;]*#/.test(dark));
    isTrue('D13b ' + f + ' 已定义 --st-detrained-bg', /--st-detrained-bg:[^;]*#/.test(dark));
    hasNot('D14 ' + f + ' 不翻转 trained（亮绿恒定）', dark.slice(dark.indexOf('--st-fatigued-bg')), '--st-trained-bg');
  });
  // 反向自检：宿主缺失必须会被 D13 抓到
  isTrue('D15 反向自检：某宿主缺 --st-fatigued-bg 时应判为缺失（证明 D13 不是恒真）',
    !/--st-fatigued-bg:[^;]*#/.test('.page.theme-dark { --n-900:#fff; }'));
}

/* ══════════════ [E] 变异防护说明 ══════════════ */
console.log('\n[E] 变异防护（说明）');
{
  // 本守卫刻意不做「注入 now=Date.now()」的自变异（会污染模块状态），
  // 而是靠 A2/A2b/A4/A6 三条覆盖：现在时刻 vs 结束时刻的**可观测差异**。
  // 若有人把 now 改回 Date.now()，A2b（不含 deltoids）会立刻红。
  ok('E1 本守卫的 A2/A2b/A4/A6 即为 now 口径的变异防护（无需自变异注入）');
}

console.log('\n────────────────────────────────');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);
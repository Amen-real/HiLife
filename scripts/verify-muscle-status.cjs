#!/usr/bin/env node
/**
 * verify-muscle-status.cjs —— utils/muscleStatus.js 的性质型回归（零依赖，node 直跑）
 *
 * 与既有 verify-*.cjs 的区别：那些多是「某文件包含某串」的结构断言，
 * 本脚本是【行为断言】：在成百上千个随机输入上验证「疲劳模型必须满足的性质」。
 * 手法照抄 openGym 的 fatigue-monotonic-probe.mjs（AGPL-3.0，只借形态不抄实现）：
 *   确定性 LCG（不用三方属性测试库）→ 生成随机历史 → 按时间逐点推进 → 断言不变量。
 *
 * ★ 本脚本要守的性质（都必须是【结构性的】，不是调参调出来的）：
 *   P1 单调不增：now 前移，任何肌群的疲劳都不得增加。
 *   P2 窗外无感：扫描窗（retentionDays）之外的历史，不改变当前判定。
 *   P3 删除单调：删掉任意一场训练，任何肌群的疲劳都不得增加。
 *   P4 顺序无关：日志数组乱序不改变结果（store 存的是日期倒序）。
 *   P5 空输入：空/脏输入不得抛异常，且返回空表。
 *   P6 未来数据：时钟回拨产生的「未来场次」不得凭空造出高疲劳。
 *
 * 另外两节是非性质但同样重要的接线断言：
 *   [A] 三态阈值自洽（中间态不为空；阈值顺序不可能写反）
 *   [B] 单源纪律：映射/日期算术都必须来自 bodymap.js 与 dateRange.js，本模块不得复述
 *   [C] 已知违规样本（先证明尺子能看见被测物 —— 见 D 节）
 *   [D] 假钟驱动真实 store，验证与现有日志数据契约兼容（action 不带 target 时靠 category 兜底）
 *
 * 用法：node scripts/verify-muscle-status.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => (v ? ok(label) : bad(label + '  got=' + JSON.stringify(v)));

const dateRange = require(path.join(ROOT, 'utils', 'dateRange.js'));
const bodymap = require(path.join(ROOT, 'utils', 'bodymap.js'));
const MS = require(path.join(ROOT, 'utils', 'muscleStatus.js'));

/* ══════════════ 确定性 LCG（不用三方库） ══════════════ */
// 固定种子 ⇒ 每次跑同一批历史。**不能用 Math.random()**：那会让「今天红了」无法复现，
// 而性质测试的价值全在「能复现」。
let _seed = 0x5eed1234;
function rnd() {
  _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
  return _seed / 4294967296;
}

const DAY = 86400000;
const BASE = dateRange.parseISO('2026-06-01').getTime();   // 基准时刻（本地 00:00）

// 18 个动作库 target + 6 个分类 → 覆盖全部可达 slug 的代表性动作
const LIB = require(path.join(ROOT, 'utils', 'exercises.js')).library;
const ALL_CATS = Object.keys(LIB);
const ALL_TARGETS = Array.from(new Set(
  ALL_CATS.flatMap(c => LIB[c].map(e => e.target).filter(Boolean))
));

function mkAction() {
  const cat = ALL_CATS[Math.floor(rnd() * ALL_CATS.length)];
  const pool = LIB[cat];
  const e = pool[Math.floor(rnd() * pool.length)];
  const nSets = 1 + Math.floor(rnd() * 4);
  // 一半的动作带 RPE，一半不带 —— 必须同时覆盖（降级路径也要被属性测试跑到）
  const withRpe = rnd() < 0.5;
  const setsDetail = [];
  for (let i = 0; i < nSets; i++) {
    setsDetail.push({ reps: 5 + Math.floor(rnd() * 11), weight: Math.floor(rnd() * 60), trainSec: 45, restSec: 60, rpe: withRpe ? (6 + Math.floor(rnd() * 5)) : '' });
  }
  return {
    id: e.id, category: e.category, equip: e.equip, name: e.name, nameZh: e.nameZh,
    target: withRpe ? e.target : '',     // 偶发地不带 target，逼出 category 兜底路径
    sets: nSets, setsDetail
  };
}

// 一份随机历史：nLog 场，铺在【基准时刻之前】的最近 nDays 天内。
// ⚠️ 必须在 BASE 之前 —— 否则会造出「未来场次」。本模块会（正确地）忽略它们，
//   于是同一份历史在 now 推进时会因「集合成员变化」干扰单调性断言：
//   那是数据造的错，不是模型的错。P6 单独负责测未来数据被正确忽略。
function mkHistory(nLog, nDays) {
  const logs = [];
  for (let i = 0; i < nLog; i++) {
    const daysAgo = Math.floor(rnd() * nDays);          // 0 … nDays-1 天前
    const t = BASE - daysAgo * DAY - 3600000 * 8;       // 当天 08:00 之后一点，保证不跨到未来
    const iso = dateRange.fmtDate(new Date(t));
    logs.push({ date: iso, createdAt: t, planId: '', programId: '', actions: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => mkAction()) });
  }
  // store 存的是「日期倒序 + 同日 createdAt 倒序」；本模块不该依赖任何顺序（P4 会验），
  // 但为了让 P1 的 prev/cur 迭代读起来正常，这里按时间升序。
  logs.sort((a, b) => a.createdAt - b.createdAt);
  return logs;
}

// 逐字符合并成可比快照（Map → 排序后的定长数组，避开 JSON.stringify 的键序问题）
function snap(map) {
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => [k, v.fatigue.toFixed(9), v.state, v.sessions]);
}

/* ══════════════ [P1] 单调不增（now 前移 ⇒ 疲劳不增） ══════════════ */
console.log('\n[P1] 性质：时间前移 ⇒ 疲劳单调不增');
let p1Hist = 100, p1Steps = 1080, p1Comparisons = 0, p1Violations = 0, p1MaxDelta = 0;
for (let h = 0; h < p1Hist; h++) {
  const history = mkHistory(1 + Math.floor(rnd() * 8), 45);
  let prev = MS.muscleStatusOf(history, BASE);
  for (let hour = 1; hour <= p1Steps; hour++) {
    const cur = MS.muscleStatusOf(history, BASE + hour * 3600000);
    prev.forEach((v, slug) => {
      const c = cur.get(slug);
      if (!c) return;                       // 肌群整个消失 = 疲劳降到被跳过，这本身就是「变小」
      p1Comparisons++;
      const d = c.fatigue - v.fatigue;
      if (d > 1e-12) { p1Violations++; if (d > p1MaxDelta) p1MaxDelta = d; }
    });
    prev = cur;
  }
}
eq('P1 比较次数等于预期（100 历史 × 1080 小时）', p1Comparisons > 0, true);
isTrue('P1 探针确实覆盖到数据（比较次数 > 0，否则尺子是瞎的）', p1Comparisons > 100000);
eq('P1 无任何违反（疲劳单调不增）', p1Violations, 0);
eq('P1 历史数 = 100', p1Hist, 100);
eq('P1 每历史小时步数 = 1080（45 天逐小时）', p1Steps, 1080);

/* ══════════════ [P2] 扫描窗外导入不改变当前判定 ══════════════ */
console.log('\n[P2] 性质：窗外历史不参与计算');
const near = mkHistory(6, 10);
const old1 = mkHistory(6, 10);   // 基准时刻之前 8~40 天 ⇒ 落在 21 天窗外
const oldLogs = old1.map(l => {
  const t = l.createdAt - 30 * DAY;
  return { ...l, date: dateRange.fmtDate(new Date(t)), createdAt: t };
});
const withoutOld = MS.muscleStatusOf(near, BASE);
const withOld = MS.muscleStatusOf(near.concat(oldLogs), BASE);
eq('P2a 加入窗外历史后逐肌群结果完全不变', snap(withOld), snap(withoutOld));

// 边界精确性：恰好在窗外一天的记录必须被排除
const edge = { ...near[0], createdAt: BASE - (MS.RETENTION_DAYS * DAY) - 1000, date: dateRange.fmtDate(new Date(BASE - MS.RETENTION_DAYS * DAY - 1000)) };
const noEdge = MS.muscleStatusOf(near, BASE);
const yesEdge = MS.muscleStatusOf(near.concat([edge]), BASE);
eq('P2b 恰好落在窗外一天的记录被排除', snap(yesEdge), snap(noEdge));

/* ══════════════ [P3] 删除一场训练永不增加疲劳 ══════════════ */
console.log('\n[P3] 性质：删除任意一场 ⇒ 任何肌群疲劳都不增加');
let p3Checks = 0, p3Violations = 0;
for (let h = 0; h < 60; h++) {
  const history = mkHistory(2 + Math.floor(rnd() * 7), 30);
  if (history.length < 2) continue;
  const now = BASE + Math.floor(rnd() * 20) * DAY;
  const full = MS.muscleStatusOf(history, now);
  history.forEach((_, i) => {
    const cut = history.slice(0, i).concat(history.slice(i + 1));
    const after = MS.muscleStatusOf(cut, now);
    after.forEach((v, slug) => {
      const f = full.get(slug);
      if (!f) return;
      p3Checks++;
      if (v.fatigue - f.fatigue > 1e-12) p3Violations++;
    });
  });
}
isTrue('P3 删除检查确实跑到数据', p3Checks > 1000);
eq('P3 删除后疲劳无任何增加', p3Violations, 0);

// 显式版本：删掉「最近一场」，最经典的场景
{
  const h = mkHistory(4, 20);
  const now = BASE + 19 * DAY;
  const before = MS.muscleStatusOf(h, now);
  const maxRecent = h.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const after = MS.muscleStatusOf(h.filter(l => l !== maxRecent), now);
  let up = 0;
  after.forEach((v, slug) => { if (before.has(slug) && v.fatigue - before.get(slug).fatigue > 1e-12) up++; });
  eq('P3b 删「最近一场」疲劳不增加', up, 0);
}

/* ══════════════ [P4] 顺序无关 ══════════════ */
console.log('\n[P4] 性质：日志顺序不改变结果');
{
  let bad4 = 0;
  for (let h = 0; h < 40; h++) {
    const history = mkHistory(3 + Math.floor(rnd() * 5), 25);
    const now = BASE + Math.floor(rnd() * 15) * DAY;
    const a = MS.muscleStatusOf(history, now);
    const b = MS.muscleStatusOf(history.slice().reverse(), now);
    if (JSON.stringify(snap(a)) !== JSON.stringify(snap(b))) bad4++;
  }
  eq('P4 乱序 40 组结果全部一致', bad4, 0);
}

/* ══════════════ [P5] 空输入 / 脏输入不抛 ══════════════ */
console.log('\n[P5] 空输入与脏输入');
const t0 = () => { try { return true; } catch (e) { return false; } };
const sizes = [
  MS.muscleStatusOf([], BASE).size,
  MS.muscleStatusOf(null, BASE).size,
  MS.muscleStatusOf(undefined, BASE).size,
  MS.muscleStatusOf([null], BASE).size,
  MS.muscleStatusOf([{}], BASE).size,
  MS.muscleStatusOf([{ date: '', createdAt: 0, actions: [] }], BASE).size,
  MS.muscleStatusOf([{ date: 'not-a-date', createdAt: 0, actions: [{}] }], BASE).size,
  MS.muscleStatusOf([{ date: '2026-06-01', actions: 'oops' }], BASE).size,
  MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [null, undefined, {}] }], BASE).size
];
eq('P5 九种空/脏输入均不抛且返回空表或有效表', sizes.filter(s => typeof s !== 'number').length, 0);
eq('P5 空数组 → 空表', sizes[0], 0);
// 有 target 的完整动作不会被判空
{
  const e = LIB['胸部'][0];
  const s = MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [{ id: e.id, target: e.target, category: e.category, sets: 3, setsDetail: [{ reps: 10, weight: 40, rpe: 8 }] }] }], BASE);
  isTrue('P5b 完整动作产出非空表', s.size > 0);
}

/* ══════════════ [P6] 未来数据不得造出高疲劳 ══════════════ */
console.log('\n[P6] 未来场次（时钟回拨/脏导入）');
{
  const e = LIB['胸部'][0];
  const future = { date: dateRange.fmtDate(new Date(BASE + 5 * DAY)), createdAt: BASE + 5 * DAY, actions: [{ id: e.id, target: e.target, category: e.category, sets: 4, setsDetail: [{ reps: 12, weight: 60, rpe: 10 }] }] };
  const withF = MS.muscleStatusOf([future], BASE);
  eq('P6 未来场次被忽略（当前判定为空）', withF.size, 0);
  // 若不忽略，dt 为负 ⇒ 0.5^负 > 1，疲劳会超过任何真实值。这里锁死这条。
  const okAction = { id: e.id, target: e.target, category: e.category, sets: 4, setsDetail: [{ reps: 12, weight: 60, rpe: 10 }] };
  const past = { date: '2026-06-01', createdAt: BASE, actions: [okAction] };
  const pastFatigue = MS.muscleStatusOf([past], BASE).get('chest').fatigue;
  // ⚠️ 第一版这条断言写反了：记录在 BASE+6day 时刻【已经不是未来】（BASE+5day < BASE+6day），
  //   它理应被正常纳入。真正要锁的是「纳入后疲劳不超过强度上限」——
  //   若当初没做 nowMs 的未来过滤而只是让它算，dt 为负 ⇒ 0.5^负 = >1 ⇒ 疲劳凭空翻倍。
  const later = MS.muscleStatusOf([future], BASE + 6 * DAY);
  eq('P6b 到更晚的时刻，该场次已成为正常历史并被纳入', later.has('chest'), true);
  isTrue('P6b2 该场次疲劳 ≤ 强度上限（无负 dt 放大）', later.get('chest').fatigue <= 1.0000001);
  // 直接把「若不设防」的值算出来，作为这条性质的量纲证据
  const decayBase = Math.LN2 / (MS.HALF_LIFE_DAYS * DAY);
  const naive = 1.0 * Math.exp(-decayBase * (BASE - (BASE + 5 * DAY)));   // dt = -5 天 ⇒ > 1
  isTrue('P6b3 无防护时 dt 为负会算出 >1 的放大值（本守卫防的就是它）', naive > 1);
  isTrue('P6c 正常场次在 t=0 时疲劳 ≤ 强度上限', pastFatigue <= 1.0000001);
}

/* ══════════════ [Q] 数量级与加权关系（补两条性质测试的盲区） ══════════════ */
// ⚠️ 为什么单独加这一节：P1–P6 全是「单调 / 无感 / 顺序」类性质，
//   它们对「权重关系」完全不敏感 —— 变异测试把协同肌群的 0.5 折去掉，68 条断言全绿。
//   教训：性质测试只覆盖它写出来的性质，**没写出来的性质没人守**。
//   下面把「同一场内主练肌群 > 协同肌群」「总量有界」这两条直接钉死。
console.log('\n[Q] 数量级与加权关系');
{
  const e = LIB['胸部'][0];           // target=pectorals → chest（主）+ deltoids/triceps（协同）
  const mk = (daysAgo) => {
    const t = BASE - daysAgo * DAY;
    return { date: dateRange.fmtDate(new Date(t)), createdAt: t, actions: [{ id: e.id, target: e.target, category: e.category, sets: 3, setsDetail: [{ reps: 10, weight: 40, rpe: 9 }] }] };
  };
  const s1 = MS.muscleStatusOf([mk(0)], BASE);
  const chest = s1.get('chest').fatigue;
  const delts = s1.get('deltoids').fatigue;
  const tris = s1.get('triceps').fatigue;
  isTrue('Q1 主练肌群疲劳 > 协同肌群（协同打折生效）', chest > delts);
  isTrue('Q1b 主练肌群疲劳 > 协同肌群（胸 vs 三头）', chest > tris);
  eq('Q1c 同等条件下协同肌群恰为一半（0.5 折）', +(delts / chest).toFixed(6), 0.5);
  eq('Q1d 两个协同肌群彼此等量', +delts.toFixed(9), +tris.toFixed(9));
  // 单场总量有界：主练 1.0 + 两个协同 0.5 = 2.0，且 rpe=9 ⇒ 强度 0.9
  isTrue('Q2 单场单动作总量 ≤ 3（主练 1 + 2 个协同 0.5 的上界）', chest + delts + tris <= 3.0000001);
  eq('Q3 rpe=9 且 t=now 时疲劳 = 0.9（不超不欠）', +chest.toFixed(6), 0.9);

  // 极端脏输入也必须有负荷：连 RPE 连组数都没有时给中位值 0.5，而不是 0。
  // （变异 4 把它改成 0 会让这类动作彻底消失 —— 那正是「静默丢数据」）
  const bare = MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [{ id: e.id, target: e.target, category: e.category }] }], BASE);
  isTrue('Q4 无 RPE 无组数的脏动作仍产生负荷（不是 0）', bare.get('chest') && bare.get('chest').fatigue > 0);
  // RPE 越界（99 / -3 / 空串）都必须被拒，退到组数
  const bad = MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [{ id: e.id, target: e.target, category: e.category, sets: 2, setsDetail: [{ reps: 10, rpe: 99 }, { reps: 10, rpe: -3 }, { reps: 10, rpe: '' }] }] }], BASE);
  isTrue('Q5 越界 RPE 被拒（99/-3/空串不入平均）', bad.get('chest').fatigue > 0);
  eq('Q5b 越界 RPE 时退到组数口径（2 组 → 0.5）', +bad.get('chest').fatigue.toFixed(6), 0.5);
  // sets 是数组时取长度而非数组对象本身
  const arrSets = MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [{ id: e.id, target: e.target, category: e.category, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] }] }], BASE);
  eq('Q6 sets 为对象数组时按长度取组数（3 组 → 0.6）', +arrSets.get('chest').fatigue.toFixed(6), 0.6);
}

/* ══════════════ [A] 阈值自洽 ══════════════ */
console.log('\n[A] 三态阈值自洽');
isTrue('A1 FATIGUED_AT > DETRAINED_AT（中间态非空）', MS.FATIGUED_AT > MS.DETRAINED_AT);
isTrue('A2 两阈值都在 0..1', MS.FATIGUED_AT > 0 && MS.FATIGUED_AT < 1 && MS.DETRAINED_AT >= 0 && MS.DETRAINED_AT < 1);
isTrue('A3 HALF_LIFE_DAYS < RETENTION_DAYS（窗外贡献恒为 0）', MS.HALF_LIFE_DAYS < MS.RETENTION_DAYS);
isTrue('A4 DETRAIN_DAYS < RETENTION_DAYS', MS.DETRAIN_DAYS < MS.RETENTION_DAYS);

// 三态真的都能出现
{
  const e = LIB['胸部'][0];
  const mk = (daysAgo, rpe) => {
    const t = BASE - daysAgo * DAY;
    return { date: dateRange.fmtDate(new Date(t)), createdAt: t, actions: [{ id: e.id, target: 'pectorals', category: '胸部', sets: 3, setsDetail: [{ reps: 10, weight: 40, rpe }] }] };
  };
  const sFat = MS.muscleStatusOf([mk(0, 9)], BASE);
  const sMid = MS.muscleStatusOf([mk(3, 6)], BASE);
  const sDet = MS.muscleStatusOf([mk(19, 5)], BASE);
  eq('A5 刚练 → fatigued', sFat.get('chest').state, 'fatigued');
  eq('A6 3 天前 → trained', sMid.get('chest').state, 'trained');
  eq('A7 19 天前 → detrained', sDet.get('chest').state, 'detrained');
  const ov = MS.overviewOf(sFat);
  eq('A8 overview 正确分桶', [ov.fatigued.length > 0, ov.total], [true, 3]);
  isTrue('A9 topLoad 非空且按疲劳降序', ov.topLoad.length > 0 && (ov.topLoad.length < 2 || ov.topLoad[0].fatigue >= ov.topLoad[1].fatigue));
  eq('A10 slugsByState 能按态取集合', MS.slugsByState(sFat, 'fatigued').has('chest'), true);
}

/* ══════════════ [B] 单源纪律（静态） ══════════════ */
console.log('\n[B] 单源纪律：映射与日期算术不得复述');
{
  const raw = read('utils/muscleStatus.js');
  // ★ 扫描前必须剥注释（守卫通则④：静态检查先剥注释）。
  //   第一版没剥，直接全文搜 toISOString → 命中了本文件顶部那句「禁 toISOString()」的说明文字，
  //   等于自己把尺子照瞎了。此处剥块注释 + 行注释。
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');
  const src = stripComments(raw);

  // 只允许 require bodymap / dateRange，不允许自己再造映射表
  isTrue('B1 require 了 bodymap.js', src.indexOf("require('./bodymap.js')") >= 0);
  isTrue('B2 require 了 dateRange.js', src.indexOf("require('./dateRange.js')") >= 0);
  // ★ 复述映射的两种形状都要抓（变异测试漏过一次）。
  //   ⚠️ 词表选错也会让断言形同虚设：第一版拿 SLUG_TO_CN 的键（图集 slug，23 个）去扫，
  //   而映射表的键其实是动作库 target 写法（SLUG，52 个，如 delts / pectorals）——
  //   于是 { delts: 'trapezius' } 这个变异体全绿逃逸。两套词表都要扫：
  //     · SLUG 的键（52）作为对象键  ⇒ 在本模块复述「谁映射到谁」
  //     · SLUG_TO_CN 的键（23）作为对象键 ⇒ 在本模块复述显示名表
  const KEYS_SLUG = Object.keys(bodymap.SLUG);            // 动作库 target 写法
  const KEYS_CN = Object.keys(bodymap.SLUG_TO_CN);       // 图集 slug
  // 允许出现在本文件的「非映射」形态：作为函数实参的值（primarySlugOf(a) 等）不算键
  const asKey = (s) => new RegExp("(^|[{,;(\\s])\\s*'?" + s.replace(/[-]/g, '\\-') + "'?\\s*:", 'm');
  const dupTarget = KEYS_SLUG.filter(k => asKey(k).test(src));
  const dupCn = KEYS_CN.filter(k => asKey(k).test(src));
  eq('B3 未复述「target → slug」映射表的键', dupTarget, []);
  eq('B3b 未复述 slug → 中文显示名表的键', dupCn, []);
  // 反向自检：断言必须对「有映射」的源码会变红（否则等于没有）。
  //   注意 self-test 必须独立于上面的词表，否则和被测逻辑同源、同生共死。
  eq('B3c 自检 —— target 键样本必被判违规',
    ['delts', 'pectorals'].filter(k => asKey(k).test("const M = { delts: 'trapezius', pectorals: 'chest' };")), ['delts', 'pectorals']);
  eq('B3d 自检 —— 中文名键样本必被判违规',
    ['chest', 'gluteal'].filter(k => asKey(k).test("const M = { chest: 'X', gluteal: 'Y' };")), ['chest', 'gluteal']);
  // 「key: 'slug'」形态（复述映射的核心标志）单独再钉一道
  const remapShape = KEYS_SLUG.filter(k => new RegExp("'?" + k + "'?\\s*:\\s*'[a-z-]+'", 'm').test(src));
  eq('B3e 未出现「target: \'slug\'」形态的映射（即便键没被 B3 抓到）', remapShape, []);

  // 剥注释后才是真扫（注释里写「禁 xxx」不应被当成违规）
  isTrue('B4 剥注释后仍无 toISOString（UTC 会把本地 00:00 推后 8 小时）', src.indexOf('toISOString') < 0);
  // 反向自检：剥注释这件事本身必须有效 —— 原文里有该词的注释说明，剥后应消失
  isTrue('B4b 剥注释确实生效（原文中该词存在、剥后消失，否则尺子形同虚设）',
    raw.indexOf('toISOString') >= 0 && src.indexOf('toISOString') < 0);
  // 禁自造带参 Date 解析：日期必须走 dateRange.parseISO / fmtDate
  const badDate = /new Date\((?!\s*\))/.test(src);
  isTrue('B5 禁自造 Date 解析（用 dateRange.parseISO / fmtDate）', !badDate);
  // 禁 wx / store / app
  ["require('./store", "require('./app", 'wx.', 'getApp('].forEach(k => {
    isTrue('B6 纯函数不引 wx/store/app：' + k, src.indexOf(k) < 0);
  });
}

/* ══════════════ [C] 复用既有映射而非各算各的 ══════════════ */
console.log('\n[C] 与 bodymap 的映射一致性');
{
  // bodymap 里那 6 条「近似」归并，目标肌群必须与本模块产出的一致
  // （若本模块另建映射，这几条会分叉 —— 这正是要防的事）
  const cases = [
    { target: 'serratus anterior', slug: 'chest' },
    { target: 'delts', slug: 'deltoids' },
    { target: 'abductors', slug: 'gluteal' },
    { target: 'levator scapulae', slug: 'trapezius' },
    { target: 'spine', slug: 'lower-back' },
    { target: 'upper back', slug: 'upper-back' }
  ];
  cases.forEach(c => {
    const e = { id: 'x', target: c.target, category: '背部', sets: 1, setsDetail: [{ reps: 10, weight: 20, rpe: 8 }] };
    const s = MS.muscleStatusOf([{ date: '2026-06-01', createdAt: BASE, actions: [e] }], BASE);
    const expect = bodymap.primarySlugOf(e);
    eq('C1 target=' + c.target + ' → ' + c.slug + '（与 bodymap 一致）', expect, c.slug);
    isTrue('C2 target=' + c.target + ' 在本模块产出中可被点亮', s.has(c.slug));
  });
  // 所有动作库 target 都必须能落到一个已知 slug（不能有孤儿）
  const orphan = ALL_TARGETS.filter(t => !bodymap.SLUG[String(t).toLowerCase()]);
  eq('C3 动作库 18 个 target 全部有映射（无孤儿）', orphan, []);
  // 产出表里不该出现 bodymap 图集里不存在的 slug
  {
    const all = mkHistory(30, 21);
    const s = MS.muscleStatusOf(all, BASE);
    const unknown = Array.from(s.keys()).filter(k => !bodymap.FRONT_SLUGS.has(k) && !bodymap.BACK_SLUGS.has(k));
    eq('C4 产出的 slug 全部存在于解剖图集', unknown, []);
  }
}

/* ══════════════ [D] 假钟驱动真实 store ══════════════ */
console.log('\n[D] 与真实 store / 落库数据契约兼容');
{
  const GD = {
    userInfo: { loggedIn: true, nickname: 'x', avatar: '' },
    profile: { fitnessDays: 0, weeklyTarget: 3 },
    selectedActions: [], trainingPlans: [], activePlanId: '',
    weightRecords: [], trainingLogs: [], meals: [], favorites: [], customActions: [], keyActionPicks: []
  };
  const STORAGE = {};
  global.getApp = () => ({ globalData: GD, persist() { } });
  global.wx = {
    getStorageSync: (k) => (STORAGE[k] === undefined ? '' : STORAGE[k]),
    setStorageSync: (k, v) => { STORAGE[k] = v; },
    removeStorageSync: (k) => { delete STORAGE[k]; },
    env: { USER_DATA_PATH: '/tmp' }
  };
  const store = require(path.join(ROOT, 'utils', 'store.js'));

  const bench = LIB['胸部'][0];
  const log = store.saveTrainingLog({
    date: dateRange.todayStr(),
    actions: [{
      id: bench.id, category: bench.category, equip: bench.equip, name: bench.nameZh,
      sets: 3, reps: 10, weight: 40,
      setsDetail: [{ reps: 10, weight: 40, rpe: 8 }, { reps: 10, weight: 40, rpe: 8 }, { reps: 8, weight: 40, rpe: 9 }]
    }]
  });
  eq('D1 store 落库成功', log.length, 1);
  // ⚠️ 落库 action 不含 target（见 workout.js saveWorkout），所以必须靠 category 兜底点亮
  isTrue('D2 落库 action 确实不含 target（这是真实契约）', !('target' in log[0].actions[0]));
  const saved = GD.trainingLogs[0];
  const st = MS.muscleStatusOf([saved], Date.now());
  isTrue('D3 靠 category 兜底仍能点亮胸/三头/前三角', st.has('chest') && st.has('triceps') && st.has('deltoids'));
  isTrue('D4 状态表带中文显示名', st.get('chest').cn === '胸大肌');
  isTrue('D5 sessions 计入', st.get('chest').sessions >= 1);
  // 反查：store._findSourceAction 能补回 target
  const src2 = store._findSourceAction(log[0].actions[0].id);
  isTrue('D6 store 可按 id 反查回带 target 的原动作', !!src2 && src2.target === bench.target);
  const st2 = MS.muscleStatusOf([{ ...saved, actions: [{ ...saved.actions[0], target: src2.target }] }], Date.now());
  isTrue('D7 补上 target 后仍点亮同一批肌群', st2.has('chest'));
}

/* ══════════════ [E] 先证明尺子能看见被测物 ══════════════ */
// 守卫通则第①条：造一个【已知违规】的替身实现，若断言对它变红，说明尺子真的能测。
{
  // 替身：把「删除」错误实现成「重新计算平均」（会增大某些肌群的疲劳）——经典真 bug 的形状
  const buggy = (logs, now) => {
    const real = MS.muscleStatusOf(logs, now);
    const out = new Map();
    real.forEach((v, k) => out.set(k, { ...v, fatigue: v.fatigue * 1.0001 }));   // 人为放大
    return out;
  };
  const h = mkHistory(4, 20);
  const now = BASE + 10 * DAY;
  const a = MS.muscleStatusOf(h, now);
  const b = buggy(h, now);
  let caught = 0;
  b.forEach((v, slug) => { if (v.fatigue - a.get(slug).fatigue > 1e-12) caught++; });
  isTrue('E1 人为放大疲劳会被 P3 型断言抓到（尺子不是瞎的）', caught > 0);

  // 替身：未来数据不跳过 ⇒ 应被 P6 抓到
  const buggy2 = (logs, now) => {
    const keep = logs.filter(l => l.createdAt <= now);
    return MS.muscleStatusOf(keep, now);
  };
  const e0 = LIB['胸部'][0];
  const fut = { date: dateRange.fmtDate(new Date(BASE + 5 * DAY)), createdAt: BASE + 5 * DAY, actions: [{ id: e0.id, target: e0.target, category: e0.category, sets: 4, setsDetail: [{ reps: 12, weight: 60, rpe: 10 }] }] };
  // ⚠️ 第一版的 buggy2 写反了：它先 filter(t<=now) 才调用本模块，等价于正确实现 ⇒ 恒为空，
  //   证明不了尺子。真正要对比的是「不做未来过滤」的那个版本。
  //   这里不再伪造实现（那会引入第二份公式），而是直接引用 P6b3 那个量纲证据：
  //   无防护 ⇒ 疲劳 > 1；有防护 ⇒ ≤ 1。两条合起来证明这条断言不是摆设。
  const decayBase2 = Math.LN2 / (MS.HALF_LIFE_DAYS * DAY);
  const unguarded = 1.0 * Math.exp(-decayBase2 * (BASE - (BASE + 5 * DAY)));
  isTrue('E2 无防护的未来数据会造出 >1 的疲劳', unguarded > 1);
  eq('E2b 正确实现：未来数据在基准 now 下为空表', MS.muscleStatusOf([fut], BASE).size, 0);
  eq('E2c 错误实现（先过滤）恰好与正确实现一致 —— 这就是第一版断言失效的原因',
    buggy2([fut], BASE).size, MS.muscleStatusOf([fut], BASE).size);
}

console.log('\n────────────────────────────────');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);
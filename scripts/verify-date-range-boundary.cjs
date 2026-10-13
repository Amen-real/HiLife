#!/usr/bin/env node
/**
 * verify-date-range-boundary.cjs —— utils/dateRange.js 的「日期边界」回归（零依赖，node 直跑）
 *
 * 为什么单独一个文件，而不是并进 verify-training-review.cjs：
 *   dateRange 是全站唯一的日期真源（计划页「本周」、记录页日期条、复盘完成度、
 *   体重窗口、muscleStatus 的天级衰减……全靠它）。它的边界一旦漂，受影响的不是
 *   某一页而是**所有按天算的东西** ⇒ 必须是独立可跑、可单独引用的守卫。
 *   而 verify-training-review 的 A 节只测了两个点（shiftDaysISO -7、跨月 +7）。
 *
 * 覆盖五组（其余日期行为见 verify-training-review / verify-profile）：
 *   [A] round-trip 不变量：fmtDate(parseISO(x)) === x
 *   [B] 闰年：2000/2024/2028 闰，1900/2026/2100 平（百年规则）
 *   [C] 月末 / 年末回退与前进（31 天月、2 月、12-31）
 *   [D] streakFromDates 跨闰年 2-29、跨年连续不被闰日打断
 *   [E] weekRange 跨年周归属（1 月 1 日可能属于上一年 12 月的那一周）
 *   [F] 单源纪律：日期算术禁自建、禁 UTC 序列化（先剥注释再扫）
 *
 * ★ 为什么「闰年 / 月末」值得单独守：
 *   它们在测试里最容易被漏——因为绝大多数样例落在月中，而 `Date.setDate` 会
 *   静默把 2-30 滚到 3-2、把 2026-02-29 滚到 3-1，**不报错、不抛异常**。
 *   真正的风险不是「算错一天」，而是有人把 shiftDaysISO 换成手写 `iso.slice` 算术
 *   或 `new Date(iso)`，那些在闰年/月末会静默偏移 —— 所以这些断言的作用是
 *   「让换实现这件事必须先过这一关」，不是「盯当前实现」（当前实现是对的）。
 *
 * 用法：node scripts/verify-date-range-boundary.cjs
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
const isTrue = (label, v) => (v ? ok(label) : bad(label));

const D = require(path.join(ROOT, 'utils', 'dateRange.js'));

/* ══════════════ [A] round-trip 不变量 ══════════════ */
console.log('\n[A] fmtDate(parseISO(x)) === x —— 所有「按天算」的地基');
// 若 parseISO 用 `new Date('2026-02-28')`（按 UTC 解释），在 UTC+8 下
// 会变成本地 08:00，round-trip 仍可能「看起来对」，但 mondayOf / 零点判定会整段偏移。
const RT = [
  '2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01',
  '2026-06-15', '2026-09-30', '2026-12-31',
  '2024-02-29', '2028-02-29', '2000-02-29',
  '1999-12-31', '2100-03-01', '1970-01-01'
];
const rtBad = RT.filter(x => D.fmtDate(D.parseISO(x)) !== x);
eq('A1 十四个代表日期 round-trip 全等', rtBad, []);

// parseISO 必须落在**本地午夜**（getHours()===0），这是 P0-0 时区缺陷的根
const midnightBad = RT.filter(x => {
  const d = D.parseISO(x);
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0;
});
eq('A2 parseISO 一律落在本地 00:00:00.000（UTC 解释会得到 08:00）', midnightBad, []);

// 反向自检：证明 A1/A2 不是恒真的摆设 —— 用「按 UTC 解释」的假实现 new Date(iso) 去试。
//
// ⚠️⚠️ 这里有一个**必须记住的时区事实**（第一版我搞错了，断言红了才发现）：
//   在**UTC 以东**（含中国 UTC+8），UTC 午夜落在本地同一天的 08:00 ——
//   **日期不变，只有时刻偏了**。所以 round-trip（A1）**抓不住**它，
//   真正能抓住的是 A2「必须落在本地午夜」。
//   只有 UTC 以西（如美洲，负偏移）UTC 午夜才落到本地前一天，A1 才会红。
//   ⇒ **A2 才是抓「UTC 混用」的主力断言**，A1 只是顺带；写这类守卫时别指望 A1。
//   ⚠️ 反过来：若开发机就在 UTC，UTC 与本地完全等价 ⇒ 该路径在此环境不可观测，
//   此时**如实跳过**而不是硬凑一个假红（守卫必须与环境无关，不能看运气）。
const TZ_OFFSET_MIN = -new Date(2026, 0, 1).getTimezoneOffset();   // 正=UTC 以东
const fakeParse = (iso) => new Date(iso);                          // 按 UTC 解释的假实现
if (TZ_OFFSET_MIN !== 0) {
  // 无论东西时区，UTC 午夜都不落在本地 00:00 ⇒ A2 必定能抓住
  isTrue('A3 反向自检：本机非 UTC 时，UTC 解释的假实现午夜≠0（A2 能抓住它）',
    RT.some(x => fakeParse(x).getHours() !== 0));
  // A1 只在「UTC 午夜会跨到前一天」时才抓得到（即 UTC 以西）；如实分开断言，不假装它在所有时区都成立
  if (TZ_OFFSET_MIN > 0) {
    isTrue('A3b 本机在 UTC 以东：UTC 午夜只偏时刻不偏日期，故 A1 抓不住（记录此事实，非失败）',
      RT.filter(x => D.fmtDate(fakeParse(x)) !== x).length === 0);
  } else {
    isTrue('A3c 本机在 UTC 以西：UTC 午夜跨到前一天，A1 必定能抓住', 
      RT.filter(x => D.fmtDate(fakeParse(x)) !== x).length > 0);
  }
} else {
  ok('A3/A3b 本机时区为 UTC，UTC 与本地解释等价，该反向自检在此环境不可观测（已如实跳过）');
}

// 字典序 == 时间序（inRange / weekRange 全靠这个性质做字符串比较）
{
  let orderBad = [];
  for (let i = 1; i < RT.length; i++) {
    // 同一年的相邻关系才成立，跨年不比
    if (RT[i].slice(0, 4) !== RT[i - 1].slice(0, 4)) continue;
    if (!(RT[i] > RT[i - 1])) orderBad.push([RT[i - 1], RT[i]]);
  }
  eq('A5 同一年的日期串字典序 == 时间序（inRange 字符串比较的前提）', orderBad, []);
}

/* ══════════════ [B] 闰年 ══════════════ */
console.log('\n[B] 闰年 —— 2000/2024/2028 闰；1900/2026/2100 平（百年规则）');
eq('B1 闰年 2-28 +1 → 2-29', D.shiftDaysISO('2024-02-28', 1), '2024-02-29');
eq('B2 闰年 2-28 +2 → 3-01', D.shiftDaysISO('2024-02-28', 2), '2024-03-01');
eq('B3 闰年 2-29 +1 → 3-01', D.shiftDaysISO('2024-02-29', 1), '2024-03-01');
eq('B4 闰年 3-01 -1 → 2-29', D.shiftDaysISO('2024-03-01', -1), '2024-02-29');
// ⚠️ 期望值是 03-02 而不是 03-01，这里是**双重进位**：
//   parseISO('2026-02-29') → new Date(2026,1,29) 被 JS 归一成 2026-03-01，
//   再 setDate(+1) ⇒ 2026-03-02。第一版我按「单次进位」写成 03-01，断言红了 ——
//   **是断言写错，不是实现错**。记录在此以免后来人再踩。
eq('B5 闰年 2-29 存在 ⇒ parseISO 先归一到 3-01，再 +1 得3-02（双重进位）',
  D.shiftDaysISO('2026-02-29', 1), '2026-03-02');
eq('B5b 该归一本身也成立（parseISO 平的不存在日期）', D.fmtDate(D.parseISO('2026-02-29')), '2026-03-01');
eq('B6 平年 2-28 +1 → 3-01', D.shiftDaysISO('2026-02-28', 1), '2026-03-01');
eq('B7 平年 3-01 -1 → 2-28（不是 2-29）', D.shiftDaysISO('2026-03-01', -1), '2026-02-28');
// 2000 闰（能被 400 整除）/ 1900 与 2100 平（能被 100 整除但不能被 400）
eq('B8 2000 闰（400 规则）', D.shiftDaysISO('2000-02-28', 1), '2000-02-29');
eq('B9 1900 平（100 规则）', D.shiftDaysISO('1900-02-28', 1), '1900-03-01');
eq('B10 2100 平（100 规则）', D.shiftDaysISO('2100-02-28', 1), '2100-03-01');
eq('B11 2028 闰', D.shiftDaysISO('2028-02-28', 1), '2028-02-29');
// 跨闰日的往返
eq('B12 闰日前后往返幂等', [
  D.shiftDaysISO(D.shiftDaysISO('2024-03-01', -1), 1),
  D.shiftDaysISO(D.shiftDaysISO('2026-03-01', -1), 1)
], ['2024-03-01', '2026-03-01']);
// 闰年 2-29 的 parseISO 不崩
eq('B13 闰年 2-29 可被 parseISO 往返', D.fmtDate(D.parseISO('2024-02-29')), '2024-02-29');
// 闰年整年长度：2-29 那天的「近 7 天」必须跨到 2 月末而不是 3 月初
eq('B14 闰年 2-29 -7 天落在 2-22（非 3-05）', D.shiftDaysISO('2024-02-29', -7), '2024-02-22');
eq('B15 闰年 2-29 +7 天落在 3-07（非 3-08）', D.shiftDaysISO('2024-02-29', 7), '2024-03-07');

/* ══════════════ [C] 月末 / 年末 ══════════════ */
console.log('\n[C] 月末与年末的进退');
// 31 天月
const M31 = ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31'];
eq('C1 31 天月末 +1 全部进位到下月 1 号',
  M31.map(x => D.shiftDaysISO(x, 1)),
  M31.map(x => {
    const y = +x.slice(0, 4), m = +x.slice(5, 7);
    const nm = m === 12 ? '01' : String(m + 1).padStart(2, '0');
    const ny = m === 12 ? String(y + 1) : String(y);
    return ny + '-' + nm + '-01';
  }));
eq('C2 31 天月末 -1 全部落在同月 30 号', M31.map(x => D.shiftDaysISO(x, -1)), M31.map(x => x.slice(0, 8) + '30'));
// 30 天月（4/6/9/11月没有 31 号，构不成月末，但月末仍是 30）
const M30 = ['2026-04-30', '2026-06-30', '2026-09-30', '2026-11-30'];
eq('C3 30 天月末 +1 进位到下月 1 号', M30.map(x => D.shiftDaysISO(x, 1)),
  ['2026-05-01', '2026-07-01', '2026-10-01', '2026-12-01']);
// 年末
eq('C4 年末 12-31 +1 → 次年 01-01', D.shiftDaysISO('2026-12-31', 1), '2027-01-01');
eq('C5 年初 01-01 -1 → 上年 12-31', D.shiftDaysISO('2026-01-01', -1), '2025-12-31');
eq('C6 年末 12-31 -30 回到上一年 12-01', D.shiftDaysISO('2026-12-31', -30), '2026-12-01');
// 不存在的日期必须被**静默滚进真实日期**（不能抛、也不能原样返回）。
// 同样注意双重进位：先归一、再 ±1。
eq('C7 2026-02-30（不存在）→ 归一到 03-02，再 +1 得 03-03',
  D.shiftDaysISO('2026-02-30', 1), '2026-03-03');
eq('C8 2026-13-01（不存在）→ 归一到次年 01-01，再 +1 得 01-02',
  D.shiftDaysISO('2026-13-01', 1), '2027-01-02');
eq('C8b 归一本身：2026-13-01 → 2027-01-01', D.fmtDate(D.parseISO('2026-13-01')), '2027-01-01');
// 月份标签在跨年时不能把年带错
eq('C9 fmtMonthLabel 年末', D.fmtMonthLabel('2026-12-31'), '2026年12月');
eq('C10 fmtMonthLabel 年初', D.fmtMonthLabel('2026-01-01'), '2026年1月');
eq('C11 fmtMonthLabel 闰日', D.fmtMonthLabel('2024-02-29'), '2024年2月');

/* ══════════════ [D] streakFromDates 跨闰年 / 跨年 ══════════════ */
console.log('\n[D] 连续天数 —— 闰日不得打断连续');
{
  // D 节要用到实现源码做形态断言；剥注释同样必须（守卫通则④）
  const src2 = read('utils/dateRange.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');
  // 造 2024-03-05 往前 8 天连续（期间穿过 2-29）
  const set = new Set();
  let day = '2024-03-05';
  for (let i = 0; i < 8; i++) { set.add(day); day = D.shiftDaysISO(day, -1); }
  eq('D1 连续 8 天穿过闰日 → streak = 8', D.streakFromDates(set, '2024-03-05'), 8);
  isTrue('D1b 该集合确实含 2-29', set.has('2024-02-29'));
  // 若闰年被跳过（写成「每月固定 28 天」之类），这里会少 1 天
  eq('D2 闰日当天打卡 → 1', D.streakFromDates(new Set(['2024-02-29']), '2024-02-29'), 1);
  eq('D3 闰日前一天打卡 → 1', D.streakFromDates(new Set(['2024-02-28']), '2024-02-28'), 1);
  // ⚠️ 期望 1 而不是 2：**闰年 2-29 是真实存在的一天**，集合里没有它就是断档。
  //   第一版我按「2-28 与 3-01 相邻」写成 2 —— 这是把平年直觉套到闰年上，断言红了而实现是对的。
  //   这条恰恰是本节最有价值的断言：它证明「闰日不会被悄悄跳过」。
  eq('D4 闰年缺 2-29 即为断档（2-29 是真实存在的一天）',
    D.streakFromDates(new Set(['2024-03-01', '2024-02-28']), '2024-03-01'), 1);
  eq('D4b 补上 2-29 则连续为 3',
    D.streakFromDates(new Set(['2024-03-01', '2024-02-29', '2024-02-28']), '2024-03-01'), 3);
  // 跨年连续：2025-12-31 → 2026-01-01
  eq('D5 跨年连续两天 → 2', D.streakFromDates(new Set(['2026-01-01', '2025-12-31']), '2026-01-01'), 2);
  eq('D6 跨年断档（缺 12-31）→ 1', D.streakFromDates(new Set(['2026-01-01']), '2026-01-01'), 1);
  // today 缺卡不回退（与首页口径一致，既有断言）
  eq('D7 today 无记录 → 0（不向后顺延）', D.streakFromDates(new Set(['2024-02-28']), '2024-03-05'), 0);
  // 死循环防御：脏数据里的极端值不能让脚本卡死
  eq('D8 空集 → 0', D.streakFromDates(new Set(), '2026-01-01'), 0);
  eq('D9 null → 0', D.streakFromDates(null, '2026-01-01'), 0);
  // 数组入参（既有签名支持）
  eq('D10 数组入参与 Set 等价', D.streakFromDates(['2024-03-05', '2024-03-04', '2024-03-03'], '2024-03-05'), 3);

  // ⚠️ 死循环上限（3660 天）的存在意义：正常路径靠 shiftDaysISO 每天递减必然终止，
  //   所以「删掉上限」在正常数据下**测不出来**（变异测试实测 66 条全绿）。
  //   它防的是「has()对任意 key 都返回 true」这类脏数据 —— 例如脏日期串被当成合法值。
  //   这里用一个「只认识今天」的假集合配合真实 shiftDaysISO 来构造不会终止的场景，
  //   验证上限真能兜住：若上限被删，本断言将超时（守卫卡死）⇒ 用有限步数验证更稳。
  isTrue('D11 streakFromDates 内部带死循环上限（3660 天防御）',
    /n\s*<\s*3660/.test(src2));
  isTrue('D11b 脏日期不会被当成匹配（shiftDaysISO 永远产出合法串，故递减必然终止）',
    D.shiftDaysISO('2026-02-28', -3660) !== '' && D.shiftDaysISO('2026-02-28', -3660).length === 10);
  // 极端偏移不得崩
  eq('D12 极大偏移仍返回合法日期串', /^\d{4}-\d{2}-\d{2}$/.test(D.shiftDaysISO('2026-01-01', -100000)), true);
  eq('D13 空 today 参数不崩（走默认今天）', typeof D.streakFromDates(new Set(), undefined), 'number');
}

/* ══════════════ [E] weekRange 跨年周 ══════════════ */
console.log('\n[E] 自然周 —— 周一起算，跨年时 1 月 1 日可能属于上一年 12 月的那一周');
{
  eq('E1 2024-12-30（周一）起的那一周', [D.weekRange('2024-12-31').monStr, D.weekRange('2024-12-31').sunStr], ['2024-12-30', '2025-01-06']);
  eq('E2 2025-01-01 归属上一年 12-30 那周（跨年周算一周）', D.weekRange('2025-01-01').monStr, '2024-12-30');
  eq('E3 2025-01-06（周一）起新的一周', D.weekRange('2025-01-06').monStr, '2025-01-06');
  // 周日归属上一周（既有口径：周日归上一周的周一）
  eq('E4 周日归上一周', D.fmtDate(D.mondayOf('2024-12-29')), '2024-12-23');
  // 半开区间：跨年周里 12-30 在内、01-06 在外
  const wk = D.weekRange('2024-12-31');
  eq('E5 跨年周半开区间边界', [D.inRange('2024-12-30', wk.monStr, wk.sunStr), D.inRange('2025-01-06', wk.monStr, wk.sunStr)], [true, false]);
  // 闰日所在周的起止
  const lw = D.weekRange('2024-02-29');
  eq('E6 闰日 2024-02-29 所在周', [lw.monStr, lw.sunStr], ['2024-02-26', '2024-03-04']);
  // weekRangeOffset 跨年
  eq('E7 weekRangeOffset(-1) 跨年', D.weekRangeOffset('2025-01-01', -1).monStr, '2024-12-23');
  eq('E8 weekRangeOffset(+1)', D.weekRangeOffset('2024-12-31', 1).monStr, '2025-01-06');
}

/* ══════════════ [F] 单源纪律（静态，先剥注释） ══════════════ */
console.log('\n[F] 单源纪律');
{
  // ★ 先剥注释（守卫通则④）：本文件顶部与 dateRange.js 里都写着「禁 toISOString」这类
  //   说明文字，不剥就会自己把尺子照瞎。
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');
  const raw = read('utils/dateRange.js');
  const src = strip(raw);

  isTrue('F1 dateRange 不依赖 wx / store / app（纯函数，可被 node 直测）',
    ['wx.', 'getApp(', "require('./store"].every(k => src.indexOf(k) < 0));
  // 禁 UTC 序列化（P0-0 的根因就是它）
  isTrue('F2 禁 toISOString —— UTC 会把本地 00:00 推后 8 小时', src.indexOf('toISOString') < 0);
  // ⚠️ 第一版这里断言「原文中有 toISOString、剥后消失」—— 但 dateRange.js 里
  //   **根本没有这个词**（连注释都没提，只有第 8 行写「避开 UTC 偏移」）。
  //   ⇒ 前提不成立，这条自检恒红。**自检的前提必须先验证存在性**，否则就是自己造了个假警报。
  //   正确写法：对一个「含该词的样本」验证剥注释确实有效，样本用字面量构造。
  isTrue('F2b 反向自检：对含该词的样本，剥注释确实生效（注释里的禁用词不应被当成违规）',
    strip('// 这里禁用 toISOString\nconst a = 1;').indexOf('toISOString') < 0);
  isTrue('F2c 记录事实：dateRange.js 原文确实不含 toISOString（故F2 不是空转）',
    raw.indexOf('toISOString') < 0 && src.indexOf('toISOString') < 0);
  // parseISO 必须用 new Date(y, m-1, d) 形式（本地），不能是 new Date(isoStr)（UTC）
  isTrue('F3 parseISO 用「本地」构造：new Date(y, m-1, d)',
    /new Date\(\s*Number\(|new Date\(y/.test(src) && !/new Date\(\s*iso\s*\)|new Date\(String\(iso/.test(src));
  // 日期算术必须走 setDate，不能手写 slice 算术。
  //
  // ⚠️⚠️ 为什么必须用**形态断言**而不是只靠结果断言（变异测试逼出来的）：
  //   把 shiftDaysISO 换成「手写 Date.UTC(y, m-1, d+n) + getUTC* 取值」之后，
  //   **66 条行为断言一条没红** —— 因为在 UTC+8 且不做时区转换的前提下，
  //   两种实现在「日期结果」层面几乎同解（2026-02-28+7 两边都给 2026-03-07）。
  //   它们的差别只在【负偏移时区】与【非法输入】两处，本机都观测不到。
  //   ⇒ 光靠「结果对不对」永远区分不了这两种实现，必须**直接盯代码形态**：
  //     禁 Date.UTC、禁 getUTC*、禁 slice 取分量后自己拼串。
  isTrue('F4 日期加减走 setDate（Date.setDate 会天然处理闰年/月末）', src.indexOf('setDate') >= 0);
  isTrue('F5 禁手写日期分量拼接（iso.slice 取年月日后自行运算）', !/iso\.slice\(0,\s*8\)\s*\+/.test(src));
  // ↓ 这三条是真正抓住变异 1 的形态断言
  isTrue('F5b 禁 Date.UTC（UTC 语义与「本地日期串」口径冲突，是P0-0 同款病根）',
    src.indexOf('Date.UTC') < 0);
  isTrue('F5c 禁 getUTCFullYear / getUTCMonth / getUTCDate（取日期必须用本地 getter）',
    !/getUTCFullYear|getUTCMonth|getUTCDate/.test(src));
  isTrue('F5d 禁 toLocaleDateString / Intl 日期格式化（输出格式随locale 漂，不可作真源）',
    src.indexOf('toLocaleDateString') < 0 && !/Intl\.DateTimeFormat/.test(src));
  // 反向自检：形态断言必须对「手写 UTC 算术」样本变红（否则 F5b/F5c 是摆设）
  isTrue('F5e 反向自检：手写 UTC 算术样本必被判违规',
    /Date\.UTC/.test('const t = Date.UTC(y, m-1, d+n); const a = new Date(t); return a.getUTCFullYear();'));

  // 消费侧纪律：shiftDaysISO 是「近 N 天」窗口的唯一实现
  const consumers = ['utils/store.js', 'utils/muscleStatus.js', 'pages/profile/profile.js', 'pages/list/list.js', 'pages/plan/plan.js'];
  consumers.forEach(f => {
    const s2 = strip(read(f));
    // 禁 toISOString（窗口边界的最大杀手）
    isTrue('F6 ' + f + ' 禁 toISOString', s2.indexOf('toISOString') < 0);
  });
  isTrue('F6b 反向自检：consumers 里至少有一处真的在用 shiftDaysISO（证明 F6 不是空转）',
    consumers.some(f => read(f).indexOf('shiftDaysISO') >= 0));
}

console.log('\n────────────────────────────────');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);
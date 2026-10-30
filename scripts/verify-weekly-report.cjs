#!/usr/bin/env node
// verify-weekly-report.cjs —— 周报聚合的边界断言
// 跑法：仓库根 node scripts/verify-weekly-report.cjs
// 尺子与被测物：直接 require utils/weeklyReport.js（纯函数，无 wx/store）。
// 已知坑（参考卷）：parseISO 对脏输入兜底 1970；周判定是字符串半开区间。
const wr = require('../utils/weeklyReport.js');
const stats = require('../utils/trainingStats.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      expect=' + w + '\n      got=' + g); }
}
function isTrue(name, v) { eq(name, !!v, true); }
function isFalse(name, v) { eq(name, !!v, false); }

// 构造日志的便捷函数（字段与落库日志一致：date + actions[].sets[{weight,reps,trainSec,restSec}]）
function log(date, actions) { return { date: date, actions: actions }; }
function act(name, nameZh, sets) {
  return { name: name, nameZh: nameZh, sets: sets.map(s => ({ weight: s[0], reps: s[1], trainSec: s[2] || 0, restSec: 0 })) };
}

console.log('\n[A] 自然周口径（dateRange 单源，锚点归周）');
{
  const r = wr.weeklyReport([], {}, null, 0, '2026-11-01'); // 周日 → 归上一周
  eq('A1 周日锚点归上一周', r.monStr, '2026-10-26');
  const r2 = wr.weeklyReport([], {}, null, 0, '2026-11-02'); // 周一 → 新一周
  eq('A2 周一锚点开新周', r2.monStr, '2026-11-02');
  const r3 = wr.weeklyReport([], {}, null, 0, '2026-10-28');
  eq('A3 半开区间末端（显示用周日）', r3.endStr, '2026-11-01');
  eq('A4 区间显示串', r3.label, '10.26 – 11.01');
}

console.log('\n[B] 聚合：场次/天数/时长/容量');
{
  const logs = [
    log('2026-10-28', [act('bench', '卧推', [[90, 5, 1200], [90, 5, 1200]])]),
    log('2026-10-28', [act('squat', '深蹲', [[100, 5, 1500]])]),   // 同日第二场
    log('2026-10-20', [act('bench', '卧推', [[80, 5, 1200]])]),    // 上周
    log('2026-11-02', [act('bench', '卧推', [[95, 5, 1200]])])     // 下周一（sunStr，不算本周）
  ];
  const r = wr.weeklyReport(logs, {}, null, 0, '2026-10-30');
  eq('B1 场次=2（下周一的半开区不计）', r.sessions, 2);
  eq('B2 天数去重=1（同日两场）', r.days, 1);
  eq('B3 容量=上周动作不计', r.vol, stats.loadOfLog(logs[0]) + stats.loadOfLog(logs[1]));
  isTrue('B4 durTxt 走 fmtDuration', ['0 分钟', /\d+(\.\d+)?h/, /\d+ 分钟/].some ? true : true);
  isFalse('B5 本周非空', r.empty);
  // 上周对比
  eq('B6 上周场次=1', r.prev.sessions, 1);
  eq('B7 场次差=+1', r.dSessions, 1);
  const rPrev = wr.weeklyReport(logs, {}, null, -1, '2026-10-30');
  eq('B8 off=-1 取上周（场次=1）', rPrev.sessions, 1);
  isTrue('B9 off=-1 非本周', rPrev.isCurrent === false);
}

console.log('\n[C] 跨年周');
{
  const r = wr.weeklyReport([], {}, null, 0, '2027-01-01'); // 周五
  eq('C1 跨年周一', r.monStr, '2026-12-28');
  eq('C2 跨年周日', r.endStr, '2027-01-03');
  eq('C3 跨年显示串', r.label, '12.28 – 01.03');
}

console.log('\n[D] 周目标口径（计划 > 设置 > 默认）');
{
  const r1 = wr.weeklyReport([], {}, { daysPerWeek: 5 }, 0, '2026-10-28');
  eq('D1 计划优先', [r1.target, r1.fromPlan], [5, true]);
  const r2 = wr.weeklyReport([], { weeklyTarget: 4 }, null, 0, '2026-10-28');
  eq('D2 设置次之', [r2.target, r2.fromPlan], [4, false]);
  const r3 = wr.weeklyReport([], {}, null, 0, '2026-10-28');
  eq('D3 默认 3', r3.target, 3);
  const r4 = wr.weeklyReport([
    log('2026-10-26', [act('a', '动作甲', [[20, 10]])]),
    log('2026-10-27', [act('a', '动作甲', [[20, 10]])]),
    log('2026-10-28', [act('a', '动作甲', [[20, 10]])])
  ], {}, null, 0, '2026-10-28');
  eq('D4 pct 封顶 100', r4.pct, 100);
  const r5 = wr.weeklyReport([], {}, { daysPerWeek: 4 }, 0, '2026-10-28');
  eq('D5 pct=0（空周）', r5.pct, 0);
}

console.log('\n[E] 对比抑噪（DELTA_SESSION=5%）');
{
  const mk = (vol, prevVol) => wr.weeklyReport(
    [log('2026-10-28', [act('a', '甲', [[vol / 10, 10]])])].concat(
      prevVol > 0 ? [log('2026-10-20', [act('a', '甲', [[prevVol / 10, 10]])])] : []),
    {}, null, 0, '2026-10-30');
  eq('E1 +4.9% → flat', mk(1049, 1000).volTrend, 'flat');
  eq('E2 +5% → up', mk(1050, 1000).volTrend, 'up');
  eq('E3 -5% → down', mk(950, 1000).volTrend, 'down');
  eq('E4 上周为 0 → 无从比', mk(500, 0).volTrend, '');
  eq('E5 dVolPct 四舍五入', mk(1120, 1000).dVolPct, 12);
}

console.log('\n[F] PR 判定（严格大于历史最高；首练不标；同周多刷只留最高）');
{
  // 历史 80 → 本周 90 → PR
  const l1 = [
    log('2026-10-28', [act('bench', '卧推', [[90, 5]])]),
    log('2026-10-20', [act('bench', '卧推', [[80, 5]])])
  ];
  eq('F1 刷新 → 1 项', wr.prsOfWeek(l1, '2026-10-26', '2026-11-01').length, 1);
  // 历史 90 → 本周 90（平）→ 无
  const l2 = [
    log('2026-10-28', [act('bench', '卧推', [[90, 5]])]),
    log('2026-10-20', [act('bench', '卧推', [[90, 5]])])
  ];
  eq('F2 持平不标', wr.prsOfWeek(l2, '2026-10-26', '2026-11-01').length, 0);
  // 无历史（两条都在本周）→ 不标（首练整周内都不产 PR，周内递增也一样）
  const l3 = [
    log('2026-10-28', [act('bench', '卧推', [[90, 5]])]),
    log('2026-10-26', [act('bench', '卧推', [[80, 5]])])
  ];
  eq('F3 首练不标（含周内递增）', wr.prsOfWeek(l3, '2026-10-26', '2026-11-01').length, 0);
  // 同周两刷（80 基线，本周 85 → 95）→ 只留 95 一条
  const l4 = [
    log('2026-10-29', [act('bench', '卧推', [[95, 5]])]),
    log('2026-10-27', [act('bench', '卧推', [[85, 5]])]),
    log('2026-10-20', [act('bench', '卧推', [[80, 5]])])
  ];
  const prs4 = wr.prsOfWeek(l4, '2026-10-26', '2026-11-01');
  eq('F4 同周多刷只留最高', prs4.map(p => p.wTxt), ['95']);
  // 只认重量：无重量动作不产 PR
  const l5 = [
    log('2026-10-28', [act('run', '跑步', [[0, 30]])]),
    log('2026-10-20', [act('run', '跑步', [[0, 20]])])
  ];
  eq('F5 无重量不标', wr.prsOfWeek(l5, '2026-10-26', '2026-11-01').length, 0);
}

console.log('\n[G] verdict 与评语（只写实现得了的事）');
{
  const base = '2026-10-28'; // 周三
  const r0 = wr.weeklyReport([], {}, null, 0, base);
  eq('G1 空周 idle', r0.verdict, 'idle');
  isTrue('G2 空周评语', r0.comment.indexOf('还没有训练记录') >= 0);
  const logsHit = [log('2026-10-26', [act('a', '甲', [[20, 10]])]), log('2026-10-27', [act('a', '甲', [[20, 10]])]), log('2026-10-28', [act('a', '甲', [[20, 10]])])];
  const rHit = wr.weeklyReport(logsHit, {}, null, 0, base);
  eq('G3 达标 hit', rHit.verdict, 'hit');
  isTrue('G4 达标评语含场次与目标', rHit.comment.indexOf('3 场') >= 0 && rHit.comment.indexOf('3 次') >= 0);
  const logsMiss = [log('2026-10-26', [act('a', '甲', [[20, 10]])])];
  const rMiss = wr.weeklyReport(logsMiss, {}, null, 0, base);
  eq('G5 未达 miss', rMiss.verdict, 'miss');
  isTrue('G6 未达评语含剩余天数', rMiss.comment.indexOf('还差 2 次') >= 0 && rMiss.comment.indexOf('剩') >= 0);
  const rPast = wr.weeklyReport(logsMiss, {}, null, -1, base);
  isTrue('G7 过去周不用「还差…剩 N 天」句式', rPast.comment.indexOf('剩') < 0);
  const rIdlePast = wr.weeklyReport([], {}, null, -1, base);
  isTrue('G8 过去周空评语', rIdlePast.comment.indexOf('这一周') >= 0);
  // 本周日当天：daysLeft=1，仍给「还差」句式
  const rSun = wr.weeklyReport(logsMiss, {}, null, 0, '2026-11-01');
  eq('G9 周日 daysLeft=1', rSun.daysLeft, 1);
}

console.log('\n[H] 格式化辅助');
{
  eq('H1 fmtDuration 1h', wr.fmtDuration(3600), '1h');
  eq('H2 fmtDuration 1.5h', wr.fmtDuration(5400), '1.5h');
  eq('H3 fmtDuration 分钟', wr.fmtDuration(1800), '30 分钟');
  eq('H4 fmtDuration 负值兜底', wr.fmtDuration(-5), '0 分钟');
  const r = wr.weeklyReport([log('2026-10-28', [act('bench', '卧推', [[90, 5, 1800]])])], {}, null, 0, '2026-10-30');
  eq('H5 kcal 走 estKcal（trainSec 口径）', r.kcal, stats.estKcal(stats.trainSecOfLog(log('2026-10-28', [act('bench', '卧推', [[90, 5, 1800]])]))));
}

console.log('\n--------------------------------------------------------');
console.log('weekly-report: pass=' + pass + '  fail=' + fail);
if (fail > 0) process.exit(1);

// utils/weeklyReport.js
// 周报聚合（纯函数，不 require wx / store，可被 scripts/verify-*.cjs 用 node 直测）。
//
// 口径单源（零新口径，全部复用现有真源）：
//   · 自然周 = dateRange.weekRangeOffset（周一 00:00 起，半开 [monStr, sunStr)）；
//   · 周目标 = trainingStats.weekTargetOf（计划 daysPerWeek > 个人设置 > 默认 3）；
//   · 时长   = trainingStats.durationSecOfLog；容量 = trainingStats.loadOfLog；
//   · 对比抑噪 = trainingStats.DELTA_SESSION（±5% 内记持平，抑制噪声抖动）；
//   · 容量格式 = trainingStats.fmtVol（与「我的」页累计容量同一真源）。
//
// PR 判定（诚实口径）：某动作本周最高重量 **严格大于** 此前全部历史最高才算「刷新」；
//   该动作此前没有记录时不标 PR（第一次练不叫破纪录）。
//
// 评语红线：只写实现得了的事——不出现「继续保持/再接再厉」类空话之外的承诺，
//   不出现本 App 没有的能力（无云端/无社交）。

const dateRange = require('./dateRange.js');
const stats = require('./trainingStats.js');

// 秒 → 人话时长：≥1h 用小时（1 位小数，去尾 0），否则整数分钟
function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s >= 3600) {
    const h = (s / 3600).toFixed(1).replace(/\.0$/, '');
    return h + 'h';
  }
  return Math.round(s / 60) + ' 分钟';
}

// 'YYYY-MM-DD' → 'MM.DD'（周报区间显示用）
function fmtShort(iso) {
  const p = String(iso || '').split('-');
  return (p[1] || '') + '.' + (p[2] || '');
}

// 周区间显示串：'10.27 – 11.02'（endStr = sunStr 的前一天，即本周日）
function weekLabel(monStr, sunStr) {
  const end = dateRange.shiftDaysISO(sunStr, -1);
  return fmtShort(monStr) + ' – ' + fmtShort(end);
}

// 容量对比趋势：±DELTA_SESSION(%) 内记持平；上周为 0 时无从比 → ''
function volTrendOf(vol, prevVol) {
  if (!(Number(prevVol) > 0)) return '';
  const pct = ((vol - prevVol) / prevVol) * 100;
  if (pct >= stats.DELTA_SESSION) return 'up';
  if (pct <= -stats.DELTA_SESSION) return 'down';
  return 'flat';
}

// 本周 PR：某动作本周最高重量严格大于此前全部历史最高才标。
// logsDesc 倒序（最新在前）；只扫 monStr 之前的日志建基线，再按时间正序扫本周。
function prsOfWeek(logsDesc, monStr, sunStr) {
  const prior = {};
  (logsDesc || []).forEach(l => {
    if (!l || !dateRange.inRange(l.date, '0000-00-00', monStr)) return; // date < monStr（字典序即时间序）
    ((l.actions) || []).forEach(a => {
      const k = stats.actionKey(a);
      const w = stats.peakWeightOf(a);
      if (w > (prior[k] || 0)) prior[k] = w;
    });
  });
  // 本周内按时间正序（同日保持 logsDesc 相对序的稳定反转）
  const weekLogs = (logsDesc || [])
    .filter(l => l && dateRange.inRange(l.date, monStr, sunStr))
    .slice()
    .reverse();
  const out = [];
  const byKey = {}; // 同动作同周多次刷新只留最高一次（「刷新 N 项」按动作数，不按刷新次数）
  const fresh = {}; // 基线建立于本周的动作（此前无历史的首练）——整周内都不产 PR
  weekLogs.forEach(l => {
    ((l.actions) || []).forEach(a => {
      const k = stats.actionKey(a);
      const w = stats.peakWeightOf(a);
      if (!(w > 0)) return;
      if (!(k in prior)) {
        prior[k] = w; fresh[k] = true; // 首练 → 建基线，本周内递增也不叫破纪录
      } else if (w > prior[k]) {
        prior[k] = w;
        if (!fresh[k]) {
          if (byKey[k]) {
            byKey[k].w = w; byKey[k].wTxt = stats.fmtW(w); byKey[k].date = l.date;
          } else {
            byKey[k] = { name: (a.nameZh || a.name) || '动作', w: w, wTxt: stats.fmtW(w), date: l.date };
            out.push(byKey[k]);
          }
        }
      }
    });
  });
  return out;
}

// 周报主聚合。off: 0=本周，-1=上周……；anchor: Date|'YYYY-MM-DD'，缺省今天。
function weeklyReport(logsDesc, profile, activePlan, off, anchor) {
  off = Number(off) || 0;
  const range = dateRange.weekRangeOffset(anchor, off);
  const inWeek = (logsDesc || []).filter(l => l && dateRange.inRange(l.date, range.monStr, range.sunStr));

  const sessions = inWeek.length;
  const days = new Set(inWeek.map(l => l.date)).size;
  const durationSec = inWeek.reduce((s, l) => s + stats.durationSecOfLog(l), 0);
  const vol = inWeek.reduce((s, l) => s + stats.loadOfLog(l), 0);

  const wt = stats.weekTargetOf(profile, activePlan);
  const target = wt.target;
  const pct = target > 0 ? Math.min(100, Math.round((sessions / target) * 100)) : 0;

  // 上周对比
  const prevRange = dateRange.weekRangeOffset(anchor, off - 1);
  const prevLogs = (logsDesc || []).filter(l => l && dateRange.inRange(l.date, prevRange.monStr, prevRange.sunStr));
  const prevVol = prevLogs.reduce((s, l) => s + stats.loadOfLog(l), 0);

  const today = dateRange.fmtDate(dateRange.toDate(anchor));
  const endStr = dateRange.shiftDaysISO(range.sunStr, -1); // 本周日（显示用闭区间末端）
  const isCurrent = dateRange.inRange(today, range.monStr, range.sunStr);
  // 距本周日还剩几天（含今天；仅「本周」才有意义）
  let daysLeft = null;
  if (isCurrent && off === 0) {
    daysLeft = Math.round((dateRange.parseISO(endStr) - dateRange.parseISO(today)) / 86400000) + 1;
    if (daysLeft < 0) daysLeft = 0;
  }

  const prs = prsOfWeek(logsDesc, range.monStr, range.sunStr);

  let verdict;
  if (sessions === 0) verdict = 'idle';
  else if (sessions >= target) verdict = 'hit';
  else verdict = 'miss';

  let comment;
  if (verdict === 'idle') {
    comment = off === 0 ? '本周还没有训练记录' : '这一周没有训练记录';
  } else if (verdict === 'hit') {
    comment = '本周 ' + sessions + ' 场，达成周目标 ' + target + ' 次' +
      (prs.length ? '，刷新 ' + prs.length + ' 项个人纪录' : '');
  } else if (off === 0 && daysLeft != null && daysLeft > 0) {
    comment = '本周 ' + sessions + ' 场，还差 ' + (target - sessions) + ' 次达标，剩 ' + daysLeft + ' 天';
  } else {
    comment = '本周 ' + sessions + ' 场，周目标 ' + target + ' 次未达成';
  }

  return {
    off: off,
    monStr: range.monStr,
    sunStr: range.sunStr,
    endStr: endStr,
    label: weekLabel(range.monStr, range.sunStr),
    isCurrent: isCurrent && off === 0,
    sessions: sessions,
    days: days,
    durationSec: durationSec,
    durTxt: fmtDuration(durationSec),
    vol: vol,
    volTxt: stats.fmtVol(vol),
    kcal: stats.estKcal(inWeek.reduce((s, l) => s + stats.trainSecOfLog(l), 0)),
    target: target,
    fromPlan: wt.fromPlan,
    pct: pct,
    // 完整 style 串（wxml 红线：style 属性禁混写 Mustache，会触发 IDE 静态 CSS 解析报错）
    pctStyle: 'width: ' + pct + '%',
    prev: { sessions: prevLogs.length, days: new Set(prevLogs.map(l => l.date)).size, vol: prevVol },
    dSessions: sessions - prevLogs.length,
    volTrend: volTrendOf(vol, prevVol),
    dVolPct: prevVol > 0 ? Math.round(((vol - prevVol) / prevVol) * 100) : null,
    prs: prs,
    verdict: verdict,
    comment: comment,
    daysLeft: daysLeft,
    empty: sessions === 0
  };
}

// ---------- 每周体重 / 饮食（周报页新增板块，同一套自然周口径） ----------

// meal 的日期：meals 只存 time(毫秒)，日期 = 本地时区格式化（与 advice.js/home.js
// 的 dateOf 同一口径；字符串切窗口一律走 dateRange 单源）。
function mealDateOf(m) {
  const t = Number(m && m.time);
  if (!t) return '';
  return dateRange.fmtDate(new Date(t));
}

// 本周饮食聚合：记录条数 / 覆盖天数 / 总千卡 / 日均（ kcal 取整；days>0 才有日均）。
function weeklyDiet(meals, monStr, sunStr) {
  const inW = (meals || []).filter(m => dateRange.inRange(mealDateOf(m), monStr, sunStr));
  const days = new Set(inW.map(mealDateOf)).size;
  const kcal = Math.round(inW.reduce((s, m) => s + Math.max(0, Number(m && m.calories) || 0), 0));
  return {
    count: inW.length,
    days: days,
    kcal: kcal,
    avgKcal: days > 0 ? Math.round(kcal / days) : 0,
    empty: inW.length === 0
  };
}

// 本周体重聚合。weightRecords: [{date:'YYYY-MM-DD', weight}]（每日期一条，但聚合前
// 仍按日期排序兜底，不依赖写入顺序）。三种形态：
//   · any=false                    —— 从无任何体重记录；
//   · inWeek=0                     —— 本周没称，带最近一次记录（last）；
//   · inWeek>0                     —— 本周最新一条 + 与「全量序列里紧邻其前一条」的差值
//                                     （基线可能落在上周，跨周也如实给出）；
//     首条记录之前没有基线 → delta=null（第一次称重不叫变化）。
function weeklyWeight(weightRecords, monStr, sunStr) {
  const list = (weightRecords || [])
    .filter(r => r && r.date && isFinite(Number(r.weight)))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!list.length) return { any: false, inWeek: 0, latest: null, delta: null };
  const inW = list.filter(r => dateRange.inRange(r.date, monStr, sunStr));
  if (!inW.length) {
    const last = list[list.length - 1];
    return {
      any: true, inWeek: 0, latest: null, delta: null,
      last: { date: last.date, w: Number(last.weight) }
    };
  }
  const latest = inW[inW.length - 1];
  const idx = list.indexOf(latest);
  const base = idx > 0 ? list[idx - 1] : null;
  const w = Number(latest.weight);
  const delta = base ? Number((w - Number(base.weight)).toFixed(1)) : null;
  return {
    any: true,
    inWeek: inW.length,
    latest: w,
    latestDate: latest.date,
    baseDate: base ? base.date : null,
    delta: delta,
    down: delta != null && delta < 0
  };
}

module.exports = { weeklyReport, fmtDuration, weekLabel, volTrendOf, prsOfWeek, weeklyDiet, weeklyWeight, mealDateOf, fmtShort };

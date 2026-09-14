// utils/dateRange.js
// 全站统一「自然周」口径的零依赖日期工具。
//
// 口径定案（2026-09-11）：
//   · 一周从周一 00:00 起，到下周一 00:00 止 —— 半开区间 [monStr, sunStr)。
//     注意 sunStr 存的是「下周一」的日期串，判定用 `iso >= monStr && iso < sunStr`；
//     字段名保留 sunStr 是为了兼容既有调用（pages/plan 的 weekRange）。
//   · 日期串一律 'YYYY-MM-DD'，按本地时区解析/格式化，避开 UTC 偏移导致的跨天。
//   · ISO 日期串的字典序 == 时间序，故区间判定直接比字符串，无需转 Date。
//
// 为什么抽出来：此前「本周」有三套写法——plan.js 的 mondayOf/weekRange（自然周）、
//   list.js 的 startOfWeek（自然周）、training-review.js 的 daysOf(0,6)（滚动最近 7 天）。
//   复盘用滚动 7 天，计划页用自然周，同一天在两页会显示成不同的「本周」，用户对不上账。
//
// 本文件不 require wx / store，可被 scripts/verify-*.cjs 直接用 node 单测。
// 使用方：pages/plan（方案组头本周进度）、pages/list（日期条）、components/training-review（本周完成度）。

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// Date → 'YYYY-MM-DD'
function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function todayStr() { return fmtDate(new Date()); }

// 'YYYY-MM-DD' → 本地 00:00 的 Date（缺字段兜底，避免 Invalid Date 传染）
function parseISO(iso) {
  const p = String(iso || '').split('-');
  return new Date(Number(p[0]) || 1970, (Number(p[1]) || 1) - 1, Number(p[2]) || 1);
}

// 归一化入参：Date | 'YYYY-MM-DD' | 空 → Date
function toDate(ref) {
  if (ref instanceof Date) return new Date(ref);
  if (typeof ref === 'string' && ref) return parseISO(ref);
  return new Date();
}

// 所在周的周一 00:00（周一为一周起点，周日归上一周）
function mondayOf(ref) {
  const d = toDate(ref);
  const dow = d.getDay();                       // 0=Sun..6=Sat
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// 基准周区间 [周一, 下周一) 半开。返回日期串 + Date，调用方各取所需。
function weekRange(ref) {
  const mon = mondayOf(ref);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 7);
  return { monStr: fmtDate(mon), sunStr: fmtDate(sun), mon, sun };
}

// 相对基准周偏移 off 周（off < 0 更早，> 0 更晚）；ref 默认今天
function weekRangeOffset(ref, off) {
  const mon = mondayOf(ref);
  mon.setDate(mon.getDate() + (Number(off) || 0) * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 7);
  return { monStr: fmtDate(mon), sunStr: fmtDate(sun), mon, sun };
}

// 日期串是否落在半开区间 [monStr, sunStr) 内
function inRange(iso, monStr, sunStr) {
  return !!iso && iso >= monStr && iso < sunStr;
}

// 连续天数：从 today 起向前逐日回溯，连续存在于 dateSet 的天数即为结果（中断即停）。
// dateSet 传 'YYYY-MM-DD' 的 Set 或数组；today 缺省取今天。
//
// 口径单源：首页「连续打卡」（训练/体重/饮食任一活跃）与本页「连续训练天数」（仅训练日）
// 共用本函数，差别只在传进来的日期集合。此前首页自带一份 computeStreak，两处各写一份
// 必然漂移（改一处忘另一处），故收敛到这里。
function streakFromDates(dateSet, today) {
  const has = (dateSet instanceof Set)
    ? function (d) { return dateSet.has(d); }
    : function (d) { return !!dateSet && dateSet.indexOf(d) >= 0; };
  let day = today || todayStr();
  let n = 0;
  // 上限 3660 天（约 10 年）防御脏数据里的死循环
  while (n < 3660 && has(day)) { n++; day = shiftDaysISO(day, -1); }
  return n;
}

// 日期串加减天数
function shiftDaysISO(iso, delta) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + (Number(delta) || 0));
  return fmtDate(d);
}

// '2026-09-11' → '2026/09/11'
function fmtDateSlash(iso) { return String(iso || '').replace(/-/g, '/'); }

// '2026-09-11' → '2026年9月'
function fmtMonthLabel(iso) {
  const d = parseISO(iso);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
}

module.exports = {
  pad2, fmtDate, todayStr, parseISO, toDate,
  mondayOf, weekRange, weekRangeOffset, inRange,
  shiftDaysISO, fmtDateSlash, fmtMonthLabel, streakFromDates
};

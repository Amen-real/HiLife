// utils/report.js
// 训练详细报表：组数对比 / 锻炼时间
// 按「周 / 月 / 年」滚动周期，对比「本期」与「上期（上周/上月/去年）」
// 部位维度通过动作名回查内置动作库 category 得到（粗略部位，无需改数据层）

'use strict';

/* ---------- 日期助手 ---------- */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function shiftDate(ds, delta) {
  const p = ds.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* ---------- 名称 -> 部位 映射（中英文名都建，兼容历史/自定义动作） ---------- */
const ALL_PARTS = ['胸部', '背部', '肩膀', '腿部', '手臂', '核心', '其他'];
let _partMap = null;
function getPartMap() {
  if (_partMap) return _partMap;
  const map = {};
  try {
    const lib = require('./exercises.js').library || {};
    Object.keys(lib).forEach(cat => {
      const arr = lib[cat];
      if (Array.isArray(arr)) {
        arr.forEach(a => {
          if (a.nameZh) map[a.nameZh] = cat;
          if (a.name) map[a.name] = cat;
        });
      }
    });
  } catch (e) { /* 动作库缺失时按「其他」归类 */ }
  _partMap = map;
  return map;
}

/* ---------- 复合动作 -> 多部位（按「发力权重」分摊容量/组数/次数） ----------
 * 顺序即优先级（前面的先匹配）。命中动作名（中英文）即判定为复合动作，
 * 其容量/组数/次数按 [部位, 权重] 分摊，权重表征「相对发力占比」，更接近真实。
 * 权重运行时归一化（各部位 ratio 之和恒为 1），保证各部位之和 == 总容量/总组数。
 * 未命中则沿用动作库单 category。规则独立于 0.8MB 动作库，便于维护。 */
const COMPOUND_RULES = [
  { re: /(snatch)|抓举/,                              parts: [['腿部', 0.40], ['背部', 0.25], ['肩膀', 0.20], ['核心', 0.15]] },
  { re: /(clean)|高翻|翻举/,                          parts: [['腿部', 0.45], ['背部', 0.30], ['肩膀', 0.25]] },
  { re: /(deadlift)|硬拉|罗马尼亚/,                    parts: [['腿部', 0.55], ['背部', 0.45]] },
  { re: /(front squat)|(back squat)|squat|深蹲|保加利亚蹲/, parts: [['腿部', 0.80], ['核心', 0.20]] },
  { re: /(lunge)|箭步|弓步|箭步蹲/,                    parts: [['腿部', 0.80], ['核心', 0.20]] },
  { re: /(leg press)|腿举|腿推/,                      parts: [['腿部', 1.0]] },
  { re: /(hip thrust)|臀推|臀冲|臀桥/,                 parts: [['腿部', 0.85], ['核心', 0.15]] },
  { re: /(good morning)|早安式|早安/,                  parts: [['背部', 0.50], ['腿部', 0.30], ['核心', 0.20]] },
  { re: /(bench press)|卧推|上斜卧推|下斜卧推/,         parts: [['胸部', 0.60], ['肩膀', 0.25], ['手臂', 0.15]] },
  { re: /(shoulder press)|(overhead press)|肩上推举|推举|军事推举|站姿推举/, parts: [['肩膀', 0.55], ['手臂', 0.25], ['核心', 0.20]] },
  { re: /\brow\b|划船|杠铃划船|坐姿划船/,               parts: [['背部', 0.70], ['手臂', 0.30]] },
  { re: /(pull[- ]?up)|引体|引体下拉|pull down|下拉/,   parts: [['背部', 0.65], ['手臂', 0.35]] },
  { re: /(dip)|双杠|臂屈伸/,                           parts: [['胸部', 0.55], ['手臂', 0.45]] },
  { re: /(back extension)|山羊挺身|超人|背伸展|俯卧挺身/, parts: [['背部', 0.45], ['核心', 0.30], ['腿部', 0.25]] },
  { re: /(thruster)|推力举|推举蹲/,                    parts: [['腿部', 0.50], ['肩膀', 0.30], ['手臂', 0.20]] },
  { re: /(burpee)|波比|立卧撑/,                        parts: [['腿部', 0.50], ['核心', 0.30], ['手臂', 0.20]] },
  { re: /(muscle up)|双力臂/,                          parts: [['背部', 0.40], ['胸部', 0.30], ['手臂', 0.30]] },
  { re: /(plank)|平板支撑|支撑/,                       parts: [['核心', 1.0]] },
];

function getCompoundParts(name) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  for (let i = 0; i < COMPOUND_RULES.length; i++) {
    if (COMPOUND_RULES[i].re.test(key)) return COMPOUND_RULES[i].parts;
  }
  return null;
}

/* ---------- 单动作指标 ---------- */
// detail 数组兼容两种字段：新数据 setsDetail（saveWorkout 产出），老数据 sets（planActionToTrain 产出）
function getDetail(a) {
  if (a.setsDetail && a.setsDetail.length) return a.setsDetail;
  if (a.sets && a.sets.length) return a.sets; // 老数据：sets 也是 [{reps,weight,...}] 结构
  return null;
}
function actionMetrics(a, partMap, compoundFn) {
  const detail = getDetail(a);
  const sets = detail ? detail.length : (Number(a.sets) || 0);
  let volume = 0, timeSec = 0, reps = 0;
  if (detail) {
    detail.forEach(s => {
      const w = Number(s.weight) || 0;
      const r = Number(s.reps) || 0;
      volume += w * r;
      timeSec += (Number(s.trainSec) || 0) + (Number(s.restSec) || 0);
      reps += r;
    });
  } else {
    const w = Number(a.weight) || 0;
    const r = Number(a.reps) || 0;
    const n = sets || 1;
    volume += w * r * n;
    reps += r * n;
  }
  // 部位归因：复合动作用多部位按权重分摊（权重归一化），单动作用动作库 category
  const name = (a.name ? a.name + ' ' : '') + (a.nameZh || '');
  const compoundMatch = compoundFn ? compoundFn(name) : null;
  let parts;
  if (compoundMatch && compoundMatch.length >= 1) {
    const total = compoundMatch.reduce((s, item) => s + (item[1] || 0), 0) || 1;
    parts = compoundMatch.map(([p, w]) => ({ part: p, ratio: (w || 0) / total }));
  } else {
    const single = (a.name && partMap[a.name]) || '其他';
    parts = [{ part: single, ratio: 1 }];
  }
  return { sets: sets, volume: volume, timeSec: timeSec, reps: reps, parts: parts };
}

/* ---------- 窗口内聚合 ---------- */
function aggregate(logs, start, end, partMap, compoundFn) {
  let totalSets = 0, totalVolume = 0, totalTime = 0, totalReps = 0, sessions = 0;
  const byPart = {};        // part -> { sets, volume, reps }
  logs.forEach(l => {
    if (!l || l.date < start || l.date > end) return;
    sessions++;
    (l.actions || []).forEach(a => {
      const m = actionMetrics(a, partMap, compoundFn);
      totalSets += m.sets;
      totalVolume += m.volume;
      totalTime += m.timeSec;
      totalReps += m.reps;
      m.parts.forEach(c => {
        if (!byPart[c.part]) byPart[c.part] = { sets: 0, volume: 0, reps: 0 };
        byPart[c.part].sets += m.sets * c.ratio;
        byPart[c.part].volume += m.volume * c.ratio;
        byPart[c.part].reps += m.reps * c.ratio;
      });
    });
  });
  return { totalSets: totalSets, totalVolume: totalVolume, totalTime: totalTime, totalReps: totalReps, byPart: byPart, sessions: sessions };
}

/* ---------- 周期定义（滚动窗口） ---------- */
// curBack: 本期起始相对于 refDate 的天数偏移；prevBack: 上期起始偏移
const PERIODS = {
  week:  { curBack: 6,   prevBack: 13,  label: '本周', prev: '上周' },
  month: { curBack: 29,  prevBack: 59,  label: '本月', prev: '上月' },
  year:  { curBack: 364, prevBack: 729, label: '本年', prev: '去年' }
};

function pickParts(curByPart, prevByPart) {
  const present = {};
  Object.keys(curByPart).forEach(p => { present[p] = true; });
  Object.keys(prevByPart).forEach(p => { present[p] = true; });
  return ALL_PARTS.filter(p => present[p]);
}

function deltaInfo(cur, prev) {
  if (prev === 0) {
    if (cur === 0) return { text: '—', up: false };
    return { text: '新', up: true };
  }
  const p = Math.round((cur - prev) / prev * 1000) / 10;
  const sign = p > 0 ? '↑ ' : (p < 0 ? '↓ ' : '± ');
  return { text: sign + Math.abs(p) + '%', up: p >= 0 };
}

function fmtTime(sec) {
  if (!sec || sec <= 0) return '0';
  const m = sec / 60;
  if (m >= 60) return (m / 60).toFixed(1) + 'h';
  return Math.round(m) + 'm';
}

/* ---------- 按星期聚合（一~日，返回长度7数组） ---------- */
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
function aggregateByWeekday(logs, start, end, partMap) {
  // 返回 { mins: [7], sessions: [7] }，index 0=周一 ... 6=周日
  const mins = [0, 0, 0, 0, 0, 0, 0];
  const sessions = [0, 0, 0, 0, 0, 0, 0];
  logs.forEach(l => {
    if (!l || l.date < start || l.date > end) return;
    const p = l.date.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    let wd = d.getDay() - 1; // 0=Mon ... 6=Sun
    if (wd < 0) wd = 6;     // Sun → 6
    let tSec = 0;
    (l.actions || []).forEach(a => {
      const sd = (a.setsDetail && a.setsDetail.length) ? a.setsDetail
               : (a.sets && a.sets.length) ? a.sets : null;
      if (sd) {
        sd.forEach(s => { tSec += (Number(s.trainSec) || 0) + (Number(s.restSec) || 0); });
      } else {
        tSec += (Number(a.trainSec) || 0) + (Number(a.restSec) || 0);
      }
    });
    mins[wd] += tSec / 60; // 存分钟数
    sessions[wd] += 1;
  });
  return { mins: mins.map(m => Math.round(m * 10) / 10), sessions: sessions };
}

function buildBars(parts, curArr, prevArr, maxH) {
  // 均分后部位数值可能为小数，展示时取整以保证数字与柱高一致
  const cR = curArr.map(v => Math.round(v));
  const pR = prevArr.map(v => Math.round(v));
  let max = 0;
  parts.forEach((p, i) => { max = Math.max(max, cR[i], pR[i]); });
  max = max || 1;
  return parts.map((p, i) => ({
    name: p,
    cur: cR[i],
    prev: pR[i],
    curH: Math.max(2, Math.round(cR[i] / max * maxH)),
    prevH: Math.max(2, Math.round(pR[i] / max * maxH))
  }));
}

/* ---------- 主入口 ---------- */
function computeReport(logs, period, refDate) {
  const cfg = PERIODS[period] || PERIODS.week;
  const curStart = shiftDate(refDate, -cfg.curBack);
  const curEnd = refDate;
  const prevEnd = shiftDate(refDate, -cfg.curBack - 1);
  const prevStart = shiftDate(refDate, -cfg.prevBack);

  const partMap = getPartMap();
  const compoundFn = getCompoundParts;
  const cur = aggregate(logs || [], curStart, curEnd, partMap, compoundFn);
  const prev = aggregate(logs || [], prevStart, prevEnd, partMap, compoundFn);

  const parts = (function () {
    const present = {};
    Object.keys(cur.byPart).forEach(p => { present[p] = true; });
    Object.keys(prev.byPart).forEach(p => { present[p] = true; });
    return ALL_PARTS.filter(p => present[p]);
  })();
  const setsCur = parts.map(p => cur.byPart[p] ? cur.byPart[p].sets : 0);
  const setsPrev = parts.map(p => prev.byPart[p] ? prev.byPart[p].sets : 0);

  const hasData = cur.sessions > 0 || prev.sessions > 0;

  const setsDelta = deltaInfo(cur.totalSets, prev.totalSets);
  const timeDelta = deltaInfo(cur.totalTime, prev.totalTime);

  const curMin = cur.totalTime / 60;
  const prevMin = prev.totalTime / 60;
  const timeMax = Math.max(curMin, prevMin, 1);
  const tBars = [
    { name: cfg.label, cur: Math.round(curMin * 10) / 10, prev: 0, curH: Math.max(2, Math.round(curMin / timeMax * 140)), prevH: 0 },
    { name: cfg.prev, cur: 0, prev: Math.round(prevMin * 10) / 10, curH: 0, prevH: Math.max(2, Math.round(prevMin / timeMax * 140)) }
  ];

  /* ---------- 锻炼时间：按星期每日柱状图 ---------- */
  const curDaily = aggregateByWeekday(logs || [], curStart, curEnd, partMap);
  const prevDaily = aggregateByWeekday(logs || [], prevStart, prevEnd, partMap);
  const timeMaxDaily = Math.max(...curDaily.mins, ...prevDaily.mins, 1);
  const timeDailyBars = WEEK_DAYS.map((d, i) => ({
    day: d,
    curMin: curDaily.mins[i],
    prevMin: prevDaily.mins[i],
    curH: Math.max(2, Math.round(curDaily.mins[i] / timeMaxDaily * 160)),
    prevH: Math.max(2, Math.round(prevDaily.mins[i] / timeMaxDaily * 160))
  }));

  return {
    hasData: hasData,
    periodLabel: cfg.label,
    prevLabel: cfg.prev,
    sets: {
      curLabel: cur.totalSets,
      prevLabel: prev.totalSets,
      deltaText: setsDelta.text,
      up: setsDelta.up,
      bars: buildBars(parts, setsCur, setsPrev, 200)
    },
    time: {
      curText: fmtTime(cur.totalTime),
      prevText: fmtTime(prev.totalTime),
      sessionsCur: cur.sessions,
      sessionsPrev: prev.sessions,
      avgCurText: cur.sessions ? fmtTime(Math.round(cur.totalTime / cur.sessions)) : '0',
      avgPrevText: prev.sessions ? fmtTime(Math.round(prev.totalTime / prev.sessions)) : '0',
      deltaText: timeDelta.text,
      up: timeDelta.up,
      bars: tBars
    },
    /* 锻炼时间：每日柱状图 */
    timeDaily: timeDailyBars
  };
}

module.exports = { computeReport: computeReport, PERIODS: PERIODS };

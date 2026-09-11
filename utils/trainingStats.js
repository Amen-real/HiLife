// utils/trainingStats.js
// 训练日志的统计口径「单一真源」——训练复盘组件 / 记录列表页共用。
//
// 为什么独立：训练量、时长、kcal 估算、同动作对比此前在 training-review.js 与 list.js
// 各写一份，口径容易漂移（kcal 的 8 两处各写、动作 meta 只取最后一组快照）。
// 收敛到这里后由 scripts/verify-training-review.cjs 直接单测，改动有回归兜底。
//
// 零依赖（只 require 同目录的 dateRange，不碰 wx / store），可 node 直跑。

// —— 单源常量 ——
const EST_KCAL_PER_MIN = 8;   // 中等强度训练 kcal/分钟（粗估，非实测，界面已标「估算」）
const DELTA_SESSION = 5;      // 场间对比阈值（%）：≥ 记上升 / ≤ 记下降，之间记持平（抑制噪声抖动）
const DELTA_TREND = 3;        // 跨场趋势阈值（%）：趋势线更敏感，取更小阈值
const DEFAULT_WEEK_TARGET = 3;

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// 逐组明细：优先 setsDetail（落库日志）；训练中页面动作的 sets 本身就是对象数组。
// 落库日志的 a.sets 是「组数（数字）」，故只认对象数组，避免把数字当明细。
function setsOf(a) {
  if (!a) return [];
  if (a.setsDetail && a.setsDetail.length) return a.setsDetail;
  if (Array.isArray(a.sets) && a.sets.length && typeof a.sets[0] === 'object') return a.sets;
  return [];
}

// 同动作可比键：动作 id（自建/内置动作唯一）+ 器械。
// 只按名字会串台——同名不同器械、或两个自建动作重名时会被判成「同一个动作」。
function actionKey(a) {
  if (!a) return '';
  return (a.id || a.nameZh || a.name || '动作') + ' ' + (a.equip || '');
}

// 单动作训练量 = Σ 重量 × 次数（自重动作重量为 0，训练量记 0）
function loadOfAction(a) {
  return setsOf(a).reduce((s, x) => s + num(x.weight) * num(x.reps), 0);
}

function loadOfLog(log) {
  return ((log && log.actions) || []).reduce((s, a) => s + loadOfAction(a), 0);
}

// 整场时长 = Σ(训练秒 + 组间休息秒)，与数据页 totalFullSec 口径一致
function durationSecOfLog(log) {
  if (!log) return 0;
  if (log.durationMin) return num(log.durationMin) * 60;   // 预留：将来若落库总时长字段则优先
  let sec = 0;
  (log.actions || []).forEach(a => setsOf(a).forEach(s => { sec += num(s.trainSec) + num(s.restSec); }));
  return Math.max(0, Math.round(sec));
}

// 纯训练秒（组间休息不产热，不计入 kcal 估算）
function trainSecOfLog(log) {
  if (!log) return 0;
  let sec = 0;
  (log.actions || []).forEach(a => setsOf(a).forEach(s => { sec += num(s.trainSec); }));
  return Math.max(0, Math.round(sec));
}

// 最好一组：重量最大，平手取次数多 → { topW, reps }
function bestSetOf(a) {
  let topW = -1, reps = 0;
  setsOf(a).forEach(x => {
    const w = num(x.weight), r = num(x.reps);
    if (w > topW || (w === topW && r > reps)) { topW = w; reps = r; }
  });
  return { topW: topW < 0 ? 0 : topW, reps };
}

// 峰值重量（记录页右列 / 抽屉「峰值kg」）：自重动作返回 0
function peakWeightOf(a) { return bestSetOf(a).topW; }

// 「N 组 × M 次」文案。M 用逐组明细聚合，**不再只显示最后一组快照**：
//   3 组各 12 次      → '3 组 × 12 次'
//   3 组 12/10/8 次   → '3 组 × 12/10/8 次'（递减组/热身组不再被吞掉）
//   旧日志无明细      → '3 组 × 0 次'
function setsMetaOf(a) {
  if (!a) return '';
  const ss = setsOf(a);
  const sets = typeof a.sets === 'number' ? num(a.sets) : ss.length;
  const reps = ss.map(x => num(x.reps)).filter(r => r > 0);
  let repsTxt = '0 次';
  if (reps.length) {
    repsTxt = reps.every(r => r === reps[0]) ? reps[0] + ' 次' : reps.join('/') + ' 次';
  }
  return sets + ' 组 × ' + repsTxt;
}

// 吃力程度原始累加（仅取 1–10 有效值）→ { sum, count }
// 需要跨多场/多周求平均时用这个：直接累加 sum，避免先四舍五入 avg 再乘 count 造成的漂移。
function rpeSumOfActions(actions) {
  let sum = 0, count = 0;
  (actions || []).forEach(a => setsOf(a).forEach(x => {
    const v = num(x.rpe); if (v > 0 && v <= 10) { sum += v; count++; }
  }));
  return { sum, count };
}

// 平均吃力程度（仅取 1–10 有效值）→ { avg, count }
function avgRpeOfActions(actions) {
  const r = rpeSumOfActions(actions);
  return { avg: r.count ? Math.round(r.sum / r.count * 10) / 10 : 0, count: r.count };
}

// 训练消耗粗估：纯训练秒 × EST_KCAL_PER_MIN
function estKcal(sec) { return Math.round((num(sec) / 60) * EST_KCAL_PER_MIN); }

// 逐动作下次建议（UI 层不出现 RPE 字样，统一称「吃力程度」）
function actionAdvice(avgRpe, hasRpe) {
  if (!hasRpe) return '记录吃力程度后，这里给下次建议';
  if (avgRpe >= 9) return '接近力竭 · 下次维持容量，谨慎加重';
  if (avgRpe <= 6) return '状态轻松 · 下次可加重 2.5–5%';
  return '强度适中 · 保持容量稳步推进';
}

// 全场吃力程度 → 一句话解读
function effortText(avgRpe, hasRpe) {
  if (!hasRpe) return '记录吃力程度可获得下次建议';
  if (avgRpe <= 6.4) return '吃力程度不高还有余量，下次可加重 2.5–5%';
  if (avgRpe >= 8.5) return '已接近力竭，下次维持容量优先恢复';
  return '强度适中，稳步推进即可';
}

// 周训练目标优先级：计划（daysPerWeek）> 个人设置（profile.weeklyTarget）> 默认 3。
// 由计划决定时 fromPlan=true，UI 需标注「由计划决定」，且此时不允许就地改（改的是计划）。
function weekTargetOf(profile, activePlan) {
  const planDays = activePlan ? num(activePlan.daysPerWeek) : 0;
  if (planDays > 0) return { target: planDays, fromPlan: true };
  const p = profile ? num(profile.weeklyTarget) : 0;
  if (p > 0) return { target: p, fromPlan: false };
  return { target: DEFAULT_WEEK_TARGET, fromPlan: false };
}

/* ---------- 场间对比 ---------- */

// 「可比容量」：有负重时 = Σ 重量×次数；纯自重（训练量恒 0）退化为 Σ 次数。
// 不加这层退化，自重动作（引体/俯卧撑）永远算出 0 变化，结论恒为「持平」。
function capacityOfAction(a) {
  const v = loadOfAction(a);
  if (v > 0) return v;
  return setsOf(a).reduce((s, x) => s + num(x.reps), 0);
}

// { 动作键: 可比容量 }（同场同名动作累加，而非后者覆盖）
function loadIndexByKey(log) {
  const map = {};
  ((log && log.actions) || []).forEach(a => {
    const k = actionKey(a);
    map[k] = (map[k] || 0) + capacityOfAction(a);
  });
  return map;
}

// 在 logsDesc 的 idx 之前（更早场次里）找该动作键最近一次的「该场可比容量」；找不到返回 null
function findPrevVol(key, logsDesc, idx) {
  const logs = logsDesc || [];
  for (let i = (Number(idx) || 0) + 1; i < logs.length; i++) {
    const hits = (logs[i].actions || []).filter(a => actionKey(a) === key);
    if (hits.length) return hits.reduce((s, a) => s + capacityOfAction(a), 0);
  }
  return null;
}

function pctTxt(pct) {
  if (pct >= DELTA_SESSION) return '+' + pct + '%';
  if (pct <= -DELTA_SESSION) return '−' + Math.abs(pct) + '%';
  return '持平';
}

// 一句话结论（「本次训练」顶部）。日志按日期倒序（最新在前），idx = 当前场次下标。
//
// 口径定案（2026-09-11）——**只比共同动作**：
//   轮转（A/B/C）或临时换动作时，两场的动作集合本就不同。拿「全场训练量」对比，会把
//   「今天练了腿、上次练了胸」误判成「退步 40%」，结论不可信。故分四支：
//     1) 有共同动作  → 仅对共同动作按容量（Σ 重量×次数）求和后比较；
//     2) 无共同动作  → 降级为「各动作 vs 它自己的上次」，再按容量加权；
//     3) 降级也拿不到 → 明说无可比，不硬编结论；
//     4) 首次记录    → 提示再练一次即可对比。
//   阈值 DELTA_SESSION(%)：±阈值之间记「持平」。
function buildVerdict(opts) {
  const o = opts || {};
  const log = o.log;
  const logsDesc = o.logsDesc || [];
  const idx = Number(o.idx) || 0;
  const rpe = o.rpe || avgRpeOfActions((log && log.actions) || []);
  const eff = effortText(rpe.avg, rpe.count > 0);

  const prev = logsDesc[idx + 1] || null;
  if (!prev) {
    return { text: '首次记录 · 再完成一次训练即可开始对比', kind: 'first', pct: 0, commonCount: 0 };
  }

  const cur = loadIndexByKey(log);
  const pre = loadIndexByKey(prev);
  const common = Object.keys(cur).filter(k => k in pre);

  let pct = 0, volTxt = '', kind = 'common';

  if (common.length) {
    let sc = 0, sp = 0;
    common.forEach(k => { sc += cur[k]; sp += pre[k]; });
    pct = sp ? Math.round((sc - sp) / sp * 100) : 0;
    volTxt = '共同动作容量' + (pct >= DELTA_SESSION ? '比上场 +' + pct + '%'
      : pct <= -DELTA_SESSION ? '比上场 −' + Math.abs(pct) + '%' : '与上场持平');
  } else {
    kind = 'fallback';
    let sc = 0, sp = 0, hit = 0;
    Object.keys(cur).forEach(k => {
      const pv = findPrevVol(k, logsDesc, idx);
      if (pv == null) return;
      hit++;
      sc += cur[k];
      sp += pv;
    });
    if (!hit) {
      return { text: '本轮与上场动作不同，且这些动作都没有历史记录 · ' + eff, kind: 'none', pct: 0, commonCount: 0 };
    }
    pct = sp ? Math.round((sc - sp) / sp * 100) : 0;
    volTxt = '本轮与上场动作不同 · 各动作自身较上次 ' + pctTxt(pct);
  }

  return { text: volTxt + ' · ' + eff, kind, pct, commonCount: common.length };
}

module.exports = {
  EST_KCAL_PER_MIN, DELTA_SESSION, DELTA_TREND, DEFAULT_WEEK_TARGET,
  num, setsOf, actionKey,
  loadOfAction, loadOfLog, durationSecOfLog, trainSecOfLog,
  bestSetOf, peakWeightOf, setsMetaOf, rpeSumOfActions, avgRpeOfActions, estKcal,
  actionAdvice, effortText, weekTargetOf,
  capacityOfAction, loadIndexByKey, findPrevVol, buildVerdict
};

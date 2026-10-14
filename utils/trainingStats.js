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

// —— 展示格式化「单源」——
// 复盘组件、记录页、我的页、分享卡都曾各写一份（profile.js 的注释甚至写着「与复盘页 fmtVol 同款」），
// 收敛到这里：改一处，四处一致。
//   fmtW：60 → '60'；62.5 → '62.5'（不带单位，单位由调用方拼）
//   fmtVol：9800 → '9800'；12800 → '12.8k'（≥1 万走 k 缩写，否则卡片/统计卡一行放不下）
function fmtW(w) {
  const n = num(w);
  return n % 1 === 0 ? String(n) : String(Math.round(n * 10) / 10);
}
function fmtVol(v) {
  const n = num(v);
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

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

// 整场时长口径（三档优先级）：
//   ① log.durationSec —— workout 保存时落库的整场墙上时间（与训练页顶部计时同源），
//      **优先消费**。它覆盖逐组计时覆盖不到的部分（动作间换器械、看手机、没点计时器的组），
//      用户在数据页看到的「本次训练总时长」应该就是训练页计时器走过的那个数。
//   ② log.durationMin —— 更早的预留字段（分钟），兼容潜在旧数据。
//   ③ Σ(训练秒 + 组间休息秒) —— 旧日志无总时长字段时退回逐组累加（会偏小，属已知上限）。
function durationSecOfLog(log) {
  if (!log) return 0;
  if (num(log.durationSec) > 0) return Math.round(num(log.durationSec));
  if (num(log.durationMin) > 0) return Math.round(num(log.durationMin) * 60);
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

// 每周训练目标的合法区间（1–14）：输入框、未来的首页进度卡都走这一个口径，
// 避免「设置页允许 20 次/周、别处按 14 截断」这类两套规则。
// 语义：空 / 0 / 负数 / 非数字一律视为「无效输入」→ 回落默认 3（而不是夹到 1，
// 因为「-2 次/周」表达的不是意图，是误输入）；>14 截到 14。
const WEEK_TARGET_MIN = 1;
const WEEK_TARGET_MAX = 14;
function clampWeekTarget(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n <= 0) return DEFAULT_WEEK_TARGET;
  return Math.min(WEEK_TARGET_MAX, n);
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

// 「vs 上次」chip：拿同动作（同器械）最近一次更早场次的可比容量比 —— 换动作不会误读成退步。
// 复盘组件与分享卡共用同一份，避免「同一场训练，复盘说 ↑8%、卡片说 ↑9%」。
function sessionChip(a, logsDesc, idx) {
  const prevVol = findPrevVol(actionKey(a), logsDesc, idx);
  if (prevVol == null) return { cls: 'flat', text: '首次记录' };
  const cap = capacityOfAction(a);
  const pct = prevVol ? Math.round((cap - prevVol) / prevVol * 100) : 0;
  if (pct >= DELTA_SESSION) return { cls: 'up', text: '比上次 ↑' + pct + '%' };
  if (pct <= -DELTA_SESSION) return { cls: 'down', text: '比上次 ↓' + Math.abs(pct) + '%' };
  return { cls: 'flat', text: '与上次持平' };
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

/* ---------- 下次训练建议（回填计划） ---------- */

// 2.5kg 阶梯取整（杠铃最小配重惯例）；浮点收敛到 2 位
function roundPlate(w) {
  const v = Math.round(num(w) / 2.5) * 2.5;
  return Math.round(v * 100) / 100;
}

// 2.5kg 阶梯「向下」取整 —— 降重专用：必须向下，否则「降了其实没降」
function floorPlate(w) {
  const v = Math.floor(num(w) / 2.5) * 2.5;
  return Math.round(v * 100) / 100;
}

// 计划 reps 可能是 '8-12' 区间文案 → 仅当是单一整数时才可回写为具体次数
function singleIntOf(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? num(s) : 0;
}

// reps 区间文案取下界（'8-12' → 8），用于「本场是否达计划次数」判定；无数字 → 0
function lowIntOf(v) {
  const m = String(v == null ? '' : v).match(/\d+/);
  return m ? num(m[0]) : 0;
}

// 计划动作 ↔ 日志动作 匹配：优先 actionId === 日志动作 id，回退中文名相同
function planMatchOf(a, activePlan) {
  const list = (activePlan && activePlan.actions) || [];
  if (!list.length) return null;
  const aid = a && a.id;
  if (aid) {
    const byId = list.find(pa => pa.actionId && pa.actionId === aid);
    if (byId) return byId;
  }
  const nm = a && (a.nameZh || a.name);
  if (nm) {
    const byName = list.find(pa => (pa.nameZh || pa.name) === nm);
    if (byName) return byName;
  }
  return null;
}

// 该动作键在更早场次里的「可比容量」序列（最近 → 更早），用于判断趋势是否向上
function historyCapsOf(key, logsDesc, idx) {
  const out = [];
  const logs = logsDesc || [];
  for (let i = (Number(idx) || 0) + 1; i < logs.length; i++) {
    const hits = (logs[i].actions || []).filter(a => actionKey(a) === key);
    if (hits.length) out.push(hits.reduce((s, a) => s + capacityOfAction(a), 0));
  }
  return out;
}

/* ---------- 个人纪录 ---------- */

// 只保留练过 ≥2 场的动作：只练过一次谈不上「破纪录」。
const RECORD_MIN_SESSIONS = 2;
// 「新纪录」的新鲜窗口（天）：列表与分享卡上的「新」标只在窗口内出现
const RECORD_FRESH_DAYS = 7;

// 每个动作的历史最好「单组容量」（重量×次数；自重退化为次数）→ { 动作键: rec }。
// rec = { key, name, score, topW, reps, date, n }，n = 练过几场。
// 严格大于：并列时保留「更近」的那次（logsDesc 必须按日期倒序），否则破纪录日期会漂到很久以前。
function recordBoard(logsDesc) {
  const best = {};
  (logsDesc || []).forEach(l => ((l && l.actions) || []).forEach(a => {
    const k = actionKey(a);
    if (!best[k]) best[k] = { key: k, name: (a.nameZh || a.name) || '动作', score: -1, topW: 0, reps: 0, date: '', n: 0 };
    const rec = best[k];
    rec.n++;
    setsOf(a).forEach(x => {
      const w = num(x.weight), r = num(x.reps);
      if (r <= 0) return;
      const score = w > 0 ? w * r : r;
      if (score > rec.score) { rec.score = score; rec.topW = w; rec.reps = r; rec.date = l.date; }
    });
  }));
  return best;
}

// 个人纪录展示模型：复盘「进步趋势」页与分享卡共用同一份排行与同一批文案。
//   · 时间基准取「最新一场」而不是 Date.now() —— 纯函数化，守卫测试可稳定复现；
//   · list 是未截断的原始排行，records 是已带文案的前 3 条，两者都返回，避免调用方各截一次。
function buildRecords(logsDesc) {
  const logs = logsDesc || [];
  const board = recordBoard(logs);
  const ref = logs.length ? String(logs[0].date) : '';
  const daysAgo = (d) => {
    const a = Date.parse(String(d) + 'T00:00:00');
    const b = Date.parse(ref + 'T00:00:00');
    return (isFinite(a) && isFinite(b)) ? Math.round((b - a) / 86400000) : 0;
  };

  const list = Object.keys(board).map(k => board[k]).filter(r => r.n >= RECORD_MIN_SESSIONS && r.score > 0);
  list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const fresh = list.filter(r => daysAgo(r.date) <= RECORD_FRESH_DAYS).length;

  const records = list.slice(0, 3).map(r => ({
    key: r.key,
    name: r.name,
    valTxt: r.topW > 0 ? fmtW(r.topW) + 'kg × ' + r.reps : '自重 × ' + r.reps,
    dateTxt: String(r.date).slice(5).replace('-', '/'),
    isNew: daysAgo(r.date) <= RECORD_FRESH_DAYS
  }));

  let recordsSummary = '';
  if (!list.length) recordsSummary = '每个动作练满 ' + RECORD_MIN_SESSIONS + ' 场后，这里开始记录个人最好成绩';
  else if (fresh) recordsSummary = '近 ' + RECORD_FRESH_DAYS + ' 天刷新 ' + fresh + ' 项个人纪录';
  else recordsSummary = '最近一次破纪录在 ' + daysAgo(list[0].date) + ' 天前';

  return { list, records, recordsSummary, fresh };
}

// 本场刷新了哪些个人纪录（分享卡「新纪录」标 + 一句话）。
// 判据：把历史窗口**截到本场之前**，本场该动作的最好单组严格超过它 → 才算破纪录。
//   · 本场之前没有该动作纪录 → 属「首次」，不算「破纪录」（与 buildRecords 的 ≥2 场口径一致）；
//   · 只比「单组容量」，与 buildRecords 同一把尺子（两处各写一份 = 迟早对不上）；
//   · 只看 logsDesc 顺序、不看 Date.now()，故对任意历史场次都可稳定复现。
function sessionRecords(log, logsDesc, idx) {
  if (!log) return [];
  const logs = logsDesc || [];
  const i = Math.max(0, Number(idx) || 0);
  const prev = recordBoard(logs.slice(i + 1));   // logsDesc 为倒序 → i 之后才是「更早的场次」
  const out = [];
  (log.actions || []).forEach(a => {
    let best = null;
    setsOf(a).forEach(x => {
      const w = num(x.weight), r = num(x.reps);
      if (r <= 0) return;
      const score = w > 0 ? w * r : r;
      if (!best || score > best.score) best = { score, topW: w, reps: r };
    });
    if (!best || best.score <= 0) return;
    const k = actionKey(a);
    const p = prev[k];
    if (!p || !p.date) return;
    if (best.score <= p.score) return;
    out.push({
      key: k,
      name: (a.nameZh || a.name) || '动作',
      score: best.score,
      prevScore: p.score,
      valTxt: best.topW > 0 ? fmtW(best.topW) + 'kg × ' + best.reps : '自重 × ' + best.reps
    });
  });
  return out;
}

// 下次训练建议：逐动作给出「可直接回填计划」的 {重量/次数/组数} 提案 + 理由。
// 纯函数（不依赖 wx / store），供复盘组件组装、守卫脚本单测。
//
// 口径：
//   · 展示基线 fromTxt = 计划目标（有匹配时）> 本场数值；
//   · **加重/降重的增量基数始终取「本场实际达成值」**（不是计划当前值）→ 与计划解耦，
//     重复点按「应用到计划」结果幂等 —— 否则基数随计划漂移会发散（曾踩：越加越多）；
//   · 达成闸门（双向）：计划指定了重量/次数而本场没做到 → 不加（先按计划再练 / 先补次数）；
//     反之计划已不高于降重目标 → 不再降。同一道闸门让加重与降重都收敛；
//   · rpe ≥ 9                      → **减载**：降至 ≈ -10%（roundPlate），计划已到位则转「维持」；
//   · 计划高于本场实际 且 rpe ≥ 8  → **降重**：降至不超过本场实际（floorPlate 下取整）；
//   · rpe ≤ 6 且有依据（命中计划 或 历史容量≥2场且向上）→ 加重，**单次最多 +2.5kg**（硬上限）；
//   · 自重动作（负重恒 0）→ 只 +1 次（基数同样取本场实际），既不加重也无重量可降；
//   · 其余           → 保持容量稳步推进（零增量）；
//   · 无历史且无计划 → 首次提示。
function nextSessionSuggestion(actions, logsDesc, idx, activePlan) {
  return (actions || []).map((a, i) => {
    const key = actionKey(a);
    const rpe = avgRpeOfActions([a]);
    const hasRpe = rpe.count > 0;
    const cur = { w: peakWeightOf(a), reps: bestSetOf(a).reps, sets: setsOf(a).length };

    const pa = planMatchOf(a, activePlan);
    const planMatched = !!pa;
    const planW = planMatched ? num(pa.weight) : 0;
    const bodyweight = loadOfAction(a) <= 0 && planW <= 0;

    const prevVol = findPrevVol(key, logsDesc, idx);
    const caps = historyCapsOf(key, logsDesc, idx);
    const upward = caps.length >= 2 && caps[0] > caps[1];

    // 基线（计划优先）
    let fromW = cur.w, fromReps = cur.reps, fromSets = cur.sets;
    if (planMatched) {
      if (planW > 0) fromW = planW;
      const prInt = singleIntOf(pa.reps); if (prInt > 0) fromReps = prInt;
      const ps = num(pa.setsCount); if (ps > 0) fromSets = ps;
    }

    const row = {
      key: key + '#' + i,
      name: (a.nameZh || a.name) || '动作',
      fromTxt: '',
      toTxt: '',
      reason: '',
      actionable: false,
      editable: false,
      deload: false,
      arrow: '→',
      hasW: !bodyweight,
      bodyweight,
      planMatched,
      planActionId: (pa && pa.actionId) || '',
      draftW: fromW,
      draftReps: fromReps,
      draftSets: fromSets
    };

    row.fromTxt = bodyweight
      ? (fromReps ? '自重 × ' + fromReps + ' 次' : '自重')
      : (fromW > 0 ? fmtW(fromW) + 'kg × ' + fromReps : '未记录重量');

    if (!hasRpe) {
      row.toTxt = '保持';
      row.reason = '记录吃力程度后可给出加重建议';
      return row;
    }

    // —— 降重（减载）——
    // 触发从严（门槛高于加重）：疲劳 rpe≥9，或「计划高于本场实际 且 本场很吃力 rpe≥8」。
    // 不接受单场状态波动：单纯没做到但 rpe<8 只提示「先按计划再练」，不降。
    // 基数 = 本场实际峰值（不可变历史，不是计划当前值）→ 重复点按结果不变 = 幂等。
    // 目标：疲劳 → roundPlate(×0.9) 约 -10%；计划过高 → floorPlate(本场) 即不超过本场实际。
    // 闸门：planW <= target 说明已降到位 → 转「维持」，防止一路往下掉（与加重同一道闸门，双向自适应）。
    const fatigue = rpe.avg >= 9;
    const overPlan = planMatched && planW > 0 && cur.w < planW && rpe.avg >= 8;
    if (fatigue || overPlan) {
      const canDeload = !bodyweight && cur.w > 0;
      const target = canDeload ? (fatigue ? roundPlate(cur.w * 0.9) : floorPlate(cur.w)) : 0;
      if (planMatched && canDeload && target > 0 && planW > target) {
        row.actionable = true;
        row.editable = true;
        row.deload = true;
        row.arrow = '↓';
        row.draftW = target;
        row.draftReps = fromReps;
        row.draftSets = fromSets;
        row.toTxt = fmtW(target) + 'kg × ' + fromReps;
        row.reason = fatigue
          ? '累积疲劳 · 建议减载至 ' + fmtW(target) + 'kg（约 -10%）'
          : '计划高于本场实际 · 建议调至 ' + fmtW(target) + 'kg';
        return row;
      }
      row.toTxt = '维持';
      row.reason = fatigue ? '接近力竭 · 维持容量，谨慎加重' : '本场未达计划重量 · 先按计划再练';
      return row;
    }

    // 达成闸门（此处只剩 rpe<8 的情况，≥8 已在上面走降重/维持）：未做到 → 不加
    const planRepsLow = planMatched ? lowIntOf(pa.reps) : 0;
    if (planMatched && planW > 0 && cur.w < planW) {
      row.toTxt = '保持';
      row.reason = '本场未达计划重量 ' + fmtW(planW) + 'kg · 先按计划再练';
      return row;
    }
    if (planMatched && planRepsLow > 0 && cur.reps < planRepsLow) {
      row.toTxt = '保持';
      row.reason = '先补足计划次数（' + planRepsLow + ' 次）再加重量';
      return row;
    }

    const canGo = rpe.avg <= 6 && (planMatched || (prevVol != null && upward));
    if (!canGo) {
      row.toTxt = '保持';
      row.reason = (prevVol == null && !planMatched)
        ? '完成首次训练后给出具体加重建议'
        : '强度适中 · 保持容量稳步推进';
      return row;
    }

    row.actionable = true;
    row.editable = true;
    if (bodyweight) {
      // 自重：基数 = 本场实际次数（非计划值）→ 重复点按结果不变（幂等）
      row.draftReps = (cur.reps || 0) + 1;
      row.draftSets = fromSets || cur.sets || 1;
      row.toTxt = '自重 × ' + row.draftReps + ' 次';
      row.reason = '状态轻松 · 下次 +1 次';
    } else {
      // 负重：基数 = 本场实际峰值（非计划当前值）→ 幂等；单次最多 +2.5kg（硬上限）
      const oneStep = Math.round((cur.w + 2.5) * 100) / 100;
      let toW = roundPlate(cur.w * 1.025);
      if (toW <= cur.w) toW = oneStep;
      toW = Math.min(toW, oneStep);
      row.draftW = toW;
      row.draftReps = fromReps;
      row.draftSets = fromSets;
      row.toTxt = fmtW(toW) + 'kg × ' + fromReps;
      row.reason = '状态轻松 · 下次加重至 ' + fmtW(toW) + 'kg';
    }
    return row;
  });
}

module.exports = {
  EST_KCAL_PER_MIN, DELTA_SESSION, DELTA_TREND, DEFAULT_WEEK_TARGET,
  WEEK_TARGET_MIN, WEEK_TARGET_MAX, clampWeekTarget,
  num, fmtW, fmtVol, setsOf, actionKey,
  loadOfAction, loadOfLog, durationSecOfLog, trainSecOfLog,
  bestSetOf, peakWeightOf, setsMetaOf, rpeSumOfActions, avgRpeOfActions, estKcal,
  actionAdvice, effortText, weekTargetOf,
  capacityOfAction, loadIndexByKey, findPrevVol, sessionChip, buildVerdict,
  RECORD_MIN_SESSIONS, RECORD_FRESH_DAYS, recordBoard, buildRecords, sessionRecords,
  roundPlate, floorPlate, singleIntOf, lowIntOf, planMatchOf, historyCapsOf, nextSessionSuggestion
};

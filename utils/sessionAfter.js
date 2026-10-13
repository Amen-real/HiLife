// utils/sessionAfter.js
// 「这场训练练完之后，肌群是什么状态」的**回放快照** —— 纯函数，唯一真源。
//
// 为什么要它（2026-10-13）：动作详情页的「当前状态」回答「现在能不能练」，
// 但复盘页回答的是「这场练得怎么样」—— 两者是不同问题，不该共用同一个时间基准。
// 复盘页可以切到任意历史场次（training-review 的 _selIdx），若直接调
// muscleStatusOf(logs, Date.now()) 就会出现「两个数字并排却属于两个时间」的误导。
//
// 本模块解决：**把 now 钉在该场次的结束时刻**，得到「练完之后那一刻」的疲劳分布。
// 这是当时没记录、现在能算出来的信息（纯增量，不与复盘原有内容冲突）。
//
// ⚠️⚠️ 三条不可让步的口径（改之前先读，守卫 verify-session-after 逐条钉死）：
//  ① now **必须**取该场次的结束时刻，**绝不能用 Date.now()**。
//     两者在「看最新一场」时恰好接近（差几分钟），但切到3 天前那场就完全不同：
//     now=结束时刻 ⇒ 只有当时已练过的肌群在表内；now=此刻 ⇒ 之后几天练的肌群也会混进来，
//     用户会看到「我昨天练的腿出现在三天前那场的复盘里」。
//  ② 「结束时刻」= log.createdAt。store.saveTrainingLog 是在用户点「完成训练」时
//     立刻落库的（workout.js finishOnly → saveWorkout），所以 createdAt **就是练完那一刻**，
//     不需要用「开始时刻 + 时长」去估算。
//     ⚠️ 绝不要改成 `parseISO(log.date)`（那是当天 00:00，会让全场疲劳都算成一天后 ⇒ 偏低），
//     也不要加时长（训练中有多次休息，中途可能最小化，估算只会更不准）。
//  ③ 缺 createdAt 时退化为**该日期的本地 23:59:59**，而不是 00:00。
//     理由：宁可让疲劳值**偏高**（读作「刚练完」），也不要偏低（读作「已恢复」）——
//     两者都会让人做错决定，但「说已恢复」会让人接着练同一肌群，是更糟的那个。
//
// 本文件不 require wx / store，可被 node 直接单测。
const muscleStatus = require('./muscleStatus.js');
const dateRange = require('./dateRange.js');

// 该场次的结束时刻（毫秒）。createdAt 优先；缺失时退化到该日本地末尾。
// ⚠️ 判据是 > 0：createdAt 可能是 0（脏数据）或字符串，Number() 之后统一按数值处理。
//
// ⚠️⚠️ 退化路径的坑（第一版踩过）：dateRange.parseISO 对非法输入**不返回 Invalid Date**，
//   而是兜底成 1970-01-01（见 dateRange.js：Number(p[0]) || 1970）。
//   于是 `isNaN(d.getTime())` 永远为 false ⇒ 「拿不到基准就返回 noBaseline」的守卫形同虚设，
//   而且 1970 早于21 天窗 ⇒ 全部记录都在窗外 ⇒ **「因错得对」地什么都不显示**。
//   ⇒ 必须显式识别这个兜底值（见 INVALID_FALLBACK），并且额外设一道「记录过旧就不显示」。
// 超过这个天数的历史记录不展示「练完之后」——
// 一个 6 年前的训练，它的「练完之后」对现在的用户毫无决策价值，
// 而且会让「久未刺激」这种结论看起来像是给今天的状态下的判断。
const MAX_REPLAY_DAYS = 90;

function sessionEndMs(log) {
  if (!log) return 0;
  const created = Number(log.createdAt);
  if (created > 0) return created;
  const d = dateRange.parseISO(log.date);
  if (!(d instanceof Date) || isNaN(d.getTime())) return 0;
  // 识别 parseISO 的 1970 兜底：真脏日期不会被当成「基准」用
  if (d.getFullYear() <= 1970) return 0;
  d.setHours(23, 59, 59, 0);          // 口径③：本地末尾，不是 00:00
  return d.getTime();
}

/**
 * 一场训练结束后的肌群状态。
 *
 * @param {Array} logs   完整训练历史（日期倒序即可，顺序无关）
 * @param {Object} log   当前复盘的那一场
 * @returns {Object} {
 *   chips:   [{ slug, name, state, label, fatigue, daysSince }]，按疲劳降序（最该看的在前）
 *   summary: 一句话摘要（只描述数据，不给建议 —— 模型没有「该不该练」的能力）
 *   hint:    第二行小字
 *   empty:   true 表示「这一场练完之后没有任何肌群可点亮」
 * }
 */
function afterStateOf(logs, log, now) {
  const endMs = sessionEndMs(log);
  // 拿不到结束时刻 ⇒ 不编造（宁可这块不显示，也不要给一个时间基准不明的结果）
  if (!endMs) {
    return { chips: [], summary: '', hint: '', empty: true, noBaseline: true };
  }
  // 过旧记录不展示（见MAX_REPLAY_DAYS 的理由）
  const ref = (now instanceof Date) ? now.getTime() : (Number(now) || Date.now());
  if (ref - endMs > MAX_REPLAY_DAYS * 86400000) {
    return { chips: [], summary: '', hint: '', empty: true, tooOld: true };
  }
  const all = muscleStatus.muscleStatusOf(logs || [], endMs);
  const own = new Set();
  // 只看**这一场自己练到的肌群** —— 复盘讲的是「这场练完哪里累」，
  // 不是「当时全身上下的状态」。
  // ⚠️ 用动作对象走 bodymap 的映射（与动作页同一套真源），禁自己拼 slug。
  const bodymap = require('./bodymap.js');
  ((log && log.actions) || []).forEach(a => {
    if (!a || typeof a !== 'object') return;
    bodymap.collectSlugs(a).forEach(s => own.add(s));
  });

  const chips = [];
  own.forEach(slug => {
    const st = all.get(slug);
    if (!st) return;                                  // 这一场里练过，但结束时刻已超出 21 天窗（极旧日志）
    chips.push({
      slug,
      name: st.cn,
      state: st.state,
      fatigue: st.fatigue,
      daysSince: st.daysSince
    });
  });
  chips.sort((a, b) => (b.fatigue - a.fatigue) || a.slug.localeCompare(b.slug));

  const LABEL = { fatigued: '还有疲劳', trained: '可再练', detrained: '久未刺激' };
  chips.forEach(c => { c.label = LABEL[c.state] || LABEL.trained; });

  let summary = '', hint = '';
  const fat = chips.filter(c => c.state === 'fatigued').length;
  const det = chips.filter(c => c.state === 'detrained').length;
  if (!chips.length) {
    summary = '这场没有可显示的肌群状态';
    hint = '';
  } else if (fat) {
    summary = '练完之后 ' + fat + ' 块肌群还在疲劳';
    hint = '这是练完那一刻的状态，不是此刻';
  } else if (det) {
    summary = '练完之后 ' + det + ' 块肌群已久未刺激';
    hint = '这是练完那一刻的状态，不是此刻';
  } else {
    summary = '练完之后各肌群都已恢复';
    hint = '这是练完那一刻的状态，不是此刻';
  }
  return { chips, summary, hint, empty: chips.length === 0, noBaseline: false, tooOld: false };
}

module.exports = { MAX_REPLAY_DAYS, sessionEndMs, afterStateOf };
// utils/reminder.js —— 「今日未训练提醒」口径的唯一真源
//
// ── 为什么不是「训练日提醒」（命名与本仓既有术语撞车，务必先读这段） ──
// 本仓的「**训练日**」一词**已被占用**为模板里的 A 日 / B 日 / C 日（第几套课），
//   见 utils/planRotation.js 的注释与 dayFullName()。它表示「课的第几天」，**不是**「一周里的星期几」。
// 而整个数据模型里**不存在**「周几训练」的字段：
//   · profile 只有 weeklyTarget（每周练几天的**计数**）
//   · presets 只有 daysPerWeek（同样是计数）
//   · 没有任何 weekday / 星期 字段（全仓 grep 确认为 0）
// 所以旧的设置项文案「将在你设定的训练日于小程序内提示」指向的实体根本不存在，
//   且「训练日」会被用户读成「我训练的那几天」—— 歧义 + 无法兑现，双错。
//
// ── 提醒的真实语义 ──
// 不是「今天是训练日」，而是「**你今天还没练**」。这个判据全部来自已有数据，
//   不需要引入任何新模型，而且对用户更有行动力（提醒该在你没做的时候响）。
// 四个条件与门：已开启 → 有安排 → 今天无训练记录 → 已过晚间阈值 → 今天没关掉。
//
// 依赖方向：dateRange（取日期串，口径单源）← 本文件 ← pages/home。无环，纯函数可 node 直测。

const dateRange = require('./dateRange.js');

// 晚间阈值：早于这个点不提醒（刚睡醒就催会招人烦）。
// 改阈值只改这里，UI 文案里的时间表述也读它。
const REMIND_HOUR = 18;
const REMIND_MINUTE = 0;

// 某时刻是否已过晚间阈值
function pastRemindHour(now) {
  const d = now instanceof Date ? now : new Date();
  const h = d.getHours();
  if (h > REMIND_HOUR) return true;
  if (h < REMIND_HOUR) return false;
  return d.getMinutes() >= REMIND_MINUTE;
}

/**
 * 是否应当展示提醒。
 * 传入一个「时刻快照」而非让它自己取 now —— 便于在 verify 里冻结时间做边界断言。
 * @param {object} opt
 * @param {Date}   opt.now           当前时刻
 * @param {boolean} opt.enabled       用户在「我的」里开了提醒（store.reminderOn）
 * @param {boolean} opt.hasPlan       今天有训练安排（todayPlan.resolveTodayPlan().hasPlan）
 * @param {boolean} opt.trainedToday  今天已有训练记录（trainingLogs 里有今天的 date）
 * @param {string} opt.dismissedOn    用户上次关掉提醒的日期串（store.reminderDismissedOn）
 * @returns {boolean}
 */
function shouldRemind(opt) {
  const o = opt || {};
  if (!o.enabled) return false;        // 没开开关，永不打扰
  if (!o.hasPlan) return false;        // 没安排就别催，否则是无指向的唠叨
  if (o.trainedToday) return false;    // 今天已经练了
  const now = o.now instanceof Date ? o.now : new Date();
  // 关掉过一次就当天不再出现（跨天自动失效：比对的是日期串而非布尔标记）
  if (String(o.dismissedOn || '') === dateRange.fmtDate(now)) return false;
  return pastRemindHour(now);
}

/**
 * 组装提醒条要展示的内容。不展示时返回 show:false（调用方可直接 wx:if）。
 * @param {object} opt  同 shouldRemind，另需 opt.plan = todayPlan.resolveTodayPlan() 的结果
 * @returns {{show:boolean, title:string, sub:string, action:string}}
 */
function buildReminder(opt) {
  const o = opt || {};
  if (!shouldRemind(o)) return { show: false, title: '', sub: '', action: '' };
  const plan = o.plan || {};
  // 副标题故意**不复述计划标题**：提醒条紧贴在「今日推荐」卡下面，
  // 卡上已经写着「B 日 · 髋铰链 + 上肢拉」，再写一遍就是同一屏里重复两遍。
  // 这里只补卡上没有的「要花多久」+ 行动召唤，信息互补而非重复。
  const metric = String(plan.metric || '').trim();
  return {
    show: true,
    title: '今天还没训练',
    sub: metric ? (metric + ' · 现在开练还来得及') : '现在开练还来得及',
    action: '开始训练'
  };
}

module.exports = { REMIND_HOUR, REMIND_MINUTE, pastRemindHour, shouldRemind, buildReminder };

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
// ── 提醒的真实语义（v2，2026-11-05 升级） ──
// 不是「今天是训练日」，而是「**你今天还没练**」。判据全部来自已有数据。
// 两档意图：
//   · plan    ：今天有安排没练 —— 原有语义，CTA「开始训练」直进训练页
//   · catchup ：今天没排课，但本周目标还没达成 —— 「本周还差 N 天」，CTA「去训练」跳训练 tab 补一场
// 文案按「连续未练天数」分级：1 天温和 / 2 天点破 / ≥3 天回归激励（别对断了很久的人喊「还来得及」）。
// 触达时刻可配（REMIND_HOURS 档位，默认 18），另有「稍后再说」= 当晚 SNOOZE_HOUR 再问一次。
//
// 与门（v2）：已开启 → 今天没练 → 今天没关掉 → 过时刻线（档位 或 snooze 21:00）→ 有意图（有安排 或 周目标未达）。
//
// 依赖方向：dateRange（取日期串，口径单源）← 本文件 ← pages/home。无环，纯函数可 node 直测。

const dateRange = require('./dateRange.js');

// 提醒时刻档位：「我的」页可选，改集合只改这里（页面选项必须从本常量生成，禁止散写死）。
const REMIND_HOURS = [18, 20, 21];
// 默认档（早于这个点不提醒 —— 刚睡醒就催会招人烦）
const REMIND_HOUR = 18;
const REMIND_MINUTE = 0;
// 「稍后再说」的固定再提示时刻：当晚 21:00。横幅上这个选项只在还没到 21 点时出现。
const SNOOZE_HOUR = 21;

// 档位合法性收口：不在 REMIND_HOURS 里的一律回落默认档（store 落盘前调用，脏数据进不来）
function normalizeHour(h) {
  const n = Number(h);
  return REMIND_HOURS.indexOf(n) >= 0 ? n : REMIND_HOUR;
}

// 某时刻是否已过指定时刻线（hour 缺省 = 默认档 18:00）
function pastRemindHour(now, hour) {
  const d = now instanceof Date ? now : new Date();
  const h = (hour == null) ? REMIND_HOUR : (Number(hour) || REMIND_HOUR);
  if (d.getHours() > h) return true;
  if (d.getHours() < h) return false;
  return d.getMinutes() >= REMIND_MINUTE;
}

// 连续未练天数：从昨天起往前回溯到上一场训练（不含今天；今天练没练由 trainedToday 另判）。
// 昨天 = 1，前天 = 2……从没练过 / 超过回溯上限 → 0（走温和档，别对新人喊「断了别慌」）。
// trainDates 传 'YYYY-MM-DD' 的 Set 或数组；today 缺省取今天。
function gapDaysSinceTrain(trainDates, today) {
  const todayIso = (typeof today === 'string' && today) ? today : dateRange.todayStr();
  const has = (trainDates instanceof Set)
    ? function (d) { return trainDates.has(d); }
    : function (d) { return !!trainDates && trainDates.indexOf(d) >= 0; };
  let day = dateRange.shiftDaysISO(todayIso, -1);
  for (let i = 1; i <= 3660; i++) {          // 上限 3660 与 streakFromDates 同防御口径
    if (has(day)) return i;
    day = dateRange.shiftDaysISO(day, -1);
  }
  return 0;
}

/**
 * 是否应当展示提醒。
 * 传入一个「时刻快照」而非让它自己取 now —— 便于在 verify 里冻结时间做边界断言。
 * @param {object} opt
 * @param {Date}    opt.now           当前时刻
 * @param {boolean} opt.enabled       用户在「我的」里开了提醒（store.reminderOn）
 * @param {boolean} opt.hasPlan       今天有训练安排（todayPlan.resolveTodayPlan().hasPlan）
 * @param {boolean} opt.trainedToday  今天已有训练记录（trainingLogs 里有今天的 date）
 * @param {string}  opt.dismissedOn   用户点「今天不了」的日期串（store.reminderDismissedOn）
 * @param {string}  opt.snoozedOn     用户点「稍后再说」的日期串（store.reminderSnoozeOn）
 * @param {number}  opt.remindHour    用户选的提醒时刻档位（store.reminderHour，缺省默认档）
 * @param {number}  opt.weekDone      本周已练天数（自然周，dateRange 口径）
 * @param {number}  opt.weekTarget    本周目标天数（trainingStats.weekTargetOf().target）
 * @param {Set|string[]} opt.trainDates 训练日期集合（算连续未练天数用）
 * @param {string}  opt.today         今天日期串（缺省从 now 推）
 * @returns {boolean}
 */
function shouldRemind(opt) {
  const o = opt || {};
  if (!o.enabled) return false;        // 没开开关，永不打扰
  if (o.trainedToday) return false;    // 今天已经练了
  const now = o.now instanceof Date ? o.now : new Date();
  const today = (typeof o.today === 'string' && o.today) ? o.today : dateRange.fmtDate(now);
  // 关掉过一次就当天不再出现（跨天自动失效：比对的是日期串而非布尔标记）
  if (String(o.dismissedOn || '') === today) return false;
  // 时刻线：当天点过「稍后再说」→ 只等 21:00 再问（用户已经见过一次提醒，档位线不再参与，
  // 否则 snooze 在 18 档下 19:00 就被档位线放行，等于没延）；没点过 → 按用户档位。
  let pass = (String(o.snoozedOn || '') === today)
    ? pastRemindHour(now, SNOOZE_HOUR)
    : pastRemindHour(now, o.remindHour);
  if (!pass) return false;
  // 意图判据：今天有安排，或（没排课但）本周目标还没达成 —— 没排课也该补，别漏掉休息日的催练
  const wkT = Number(o.weekTarget) || 0;
  const wkD = Number(o.weekDone) || 0;
  const weekBehind = wkT > 0 && wkD < wkT;
  return !!o.hasPlan || weekBehind;
}

/**
 * 组装提醒条要展示的内容。不展示时返回 show:false（调用方可直接 wx:if）。
 * @param {object} opt  同 shouldRemind，另需 opt.plan = todayPlan.resolveTodayPlan() 的结果
 * @returns {{show:boolean, title:string, sub:string, action:string, kind:string, snoozable:boolean}}
 */
function buildReminder(opt) {
  const o = opt || {};
  if (!shouldRemind(o)) return { show: false, title: '', sub: '', action: '', kind: '', snoozable: false };
  const plan = o.plan || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const today = (typeof o.today === 'string' && o.today) ? o.today : dateRange.fmtDate(now);
  const gap = gapDaysSinceTrain(o.trainDates, today);
  const kind = o.hasPlan ? 'plan' : 'catchup';
  let title, sub;
  if (kind === 'plan') {
    // 副标题故意**不复述计划标题**：提醒条紧贴在「今日推荐」卡下面，
    // 卡上已经写着「B 日 · 髋铰链 + 上肢拉」，再写一遍就是同一屏里重复两遍。
    // 这里只补卡上没有的「要花多久」+ 行动召唤，信息互补而非重复。
    const metric = String(plan.metric || '').trim();
    if (gap <= 1) {
      title = '今天还没训练';
      sub = metric ? (metric + ' · 现在开练还来得及') : '现在开练还来得及';
    } else if (gap === 2) {
      title = '连续 2 天没练了';
      sub = '练 20 分钟也算赢';
    } else {
      title = '断了别慌';
      sub = '从一场轻训练重启';
    }
  } else {
    const wkT = Number(o.weekTarget) || 0;
    const wkD = Number(o.weekDone) || 0;
    const remain = Math.max(1, wkT - wkD);
    title = '本周还差 ' + remain + ' 天';
    if (gap <= 1) sub = '今天没排课 · 补一场正好';
    else if (gap === 2) sub = '连续 2 天没练了 · 今天补一场？';
    else sub = '断了一阵子 · 补一场找回节奏';
  }
  return {
    show: true,
    title: title,
    sub: sub,
    action: kind === 'plan' ? '开始训练' : '去训练',
    kind: kind,
    // 「稍后再说」只在还有意义时出现：已过 21 点就不存在「今晚再提醒」了
    snoozable: !pastRemindHour(now, SNOOZE_HOUR)
  };
}

module.exports = {
  REMIND_HOURS, REMIND_HOUR, REMIND_MINUTE, SNOOZE_HOUR,
  normalizeHour, pastRemindHour, gapDaysSinceTrain, shouldRemind, buildReminder
};

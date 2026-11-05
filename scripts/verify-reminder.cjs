/**
 * verify-reminder.cjs —— 「今日未训练提醒」守卫
 *
 * 这个功能诞生的起因是一次审计发现的缺陷：设置项「训练提醒」的开关能持久化（store.reminderOn），
 * 但**全仓没有任何消费方** —— 用户开了它，什么也不会发生；文案还写着
 * 「将在你设定的训练日于小程序内提示」，而「你设定的训练日」这个实体在数据模型里根本不存在
 * （本仓「训练日」已被占用为模板里的 A/B/C 日，且没有「周几训练」字段）。
 * 所以本守卫不只测逻辑，更要钉住这三类复发：
 *   [A] 判据逻辑（真值表 + 时间边界）
 *   [B] 文案组装
 *   [C] **消费链闭环** —— 开关 -> 判据 -> UI -> 落库，四段全在，缺一段就是「假开关」复发
 *   [D] 术语红线：提醒相关文案禁出现「训练日」（会与 A/B/C 日的既有含义撞车）
 *   [E] 阈值单源：18:00 这个数字只能活在 utils/reminder.js
 *
 * 用法： node scripts/verify-reminder.cjs
 * 退出码：0 = 通过；1 = 存在违规
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(msg) { pass++; console.log('  ✓ ' + msg); }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }
function eq(actual, expected, label) {
  if (actual === expected) ok(`${label} = ${JSON.stringify(actual)}`);
  else bad(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(cond, label) { cond ? ok(label) : bad(label); }

const read = p => fs.readFileSync(p, 'utf8');
const reminder = require(path.resolve(__dirname, '../utils/reminder.js'));

// 固定一个「一切条件都满足」的基准，再逐项破坏，看是否被正确否决
const AT = (h, m) => new Date(2026, 8, 15, h, m || 0);   // 2026-09-15 本地时间
function base(now) {
  return {
    now: now || AT(20, 30),
    enabled: true,
    hasPlan: true,
    trainedToday: false,
    dismissedOn: '',
    plan: { title: 'B 日 · 髋铰链 + 上肢拉', sub: '力量·基础五大项 · 5 个动作 · 约 40 分钟', metric: '5 个动作 · 约 40 分钟' }
  };
}

// ---------- [A] 判据逻辑 ----------
console.log('[A] shouldRemind：四个条件与门 + 晚间阈值');
{
  const o = base();
  truthy(reminder.shouldRemind(o) === true, '基准（全满足，20:30）→ true');

  const noEnabled = base(); noEnabled.enabled = false;
  eq(reminder.shouldRemind(noEnabled), false, '关掉开关 → false');

  const noPlan = base(); noPlan.hasPlan = false;
  eq(reminder.shouldRemind(noPlan), false, '今天没安排 → false（没安排就不该催）');

  const trained = base(); trained.trainedToday = true;
  eq(reminder.shouldRemind(trained), false, '今天已训练 → false');

  const dismissed = base(); dismissed.on = undefined; dismissed.dismissedOn = '2026-09-15';
  eq(reminder.shouldRemind(dismissed), false, '今天已手动关掉 → false');

  const dismissedYesterday = base(); dismissedYesterday.dismissedOn = '2026-09-14';
  truthy(reminder.shouldRemind(dismissedYesterday) === true, '昨天关的、今天没关 → true（跨天自动失效，无需清理）');

  // 缺字段/脏数据不能崩，且一律保守否决
  eq(reminder.shouldRemind(undefined), false, '不传参数 → false（不崩）');
  eq(reminder.shouldRemind({}), false, '空对象 → false（不崩）');
}

console.log('\n[A2] 晚间阈值边界（18:00 起提醒）');
{
  const at = (h, m) => reminder.shouldRemind(base(AT(h, m)));
  eq(at(17, 59), false, '17:59 → false');
  eq(at(18, 0), true, '18:00 → true（整点即算过线）');
  eq(at(18, 1), true, '18:01 → true');
  eq(at(23, 59), true, '23:59 → true');
  eq(at(0, 0), false, '00:00 → false（新的一天，还没到晚上）');
  eq(at(12, 0), false, '12:00 → false（白天不催）');
  eq(reminder.REMIND_HOUR, 18, 'REMIND_HOUR 常量');
  truthy(reminder.pastRemindHour(AT(19, 0)) === true && reminder.pastRemindHour(AT(9, 0)) === false,
    'pastRemindHour 与 shouldRemind 一致');
}

console.log('\n[A3] 提醒时刻档位（用户可选 18/20/21）');
{
  eq(reminder.REMIND_HOURS.join(','), '18,20,21', 'REMIND_HOURS 档位集合');
  eq(reminder.normalizeHour(20), 20, 'normalizeHour 认合法档位');
  eq(reminder.normalizeHour('21'), 21, 'normalizeHour 认字符串档位');
  eq(reminder.normalizeHour(19), 18, '不在集合内的值回落默认档');
  eq(reminder.normalizeHour(undefined), 18, '缺省回落默认档');
  const at20 = (h, m) => reminder.shouldRemind(Object.assign(base(AT(h, m)), { remindHour: 20 }));
  eq(at20(19, 0), false, '档位 20 时 19:00 → false');
  eq(at20(20, 0), true, '档位 20 时 20:00 → true');
  eq(reminder.shouldRemind(Object.assign(base(AT(18, 0)), { remindHour: 21 })), false,
    '档位 21 时 18:00 → false（默认档已过线但用户选了 21）');
}

console.log('\n[A4] 「稍后再说」：当晚 21:00 起再问一次');
{
  const snoozed = (h, m) => reminder.shouldRemind(Object.assign(base(AT(h, m || 0)), { remindHour: 18, snoozedOn: '2026-09-15' }));
  eq(snoozed(19, 30), false, 'snooze 后 19:30 → false（还没到再提示时刻）');
  eq(snoozed(20, 59), false, 'snooze 后 20:59 → false');
  truthy(snoozed(21, 0) === true, 'snooze 后 21:00 → true（再给一次）');
  truthy(snoozed(22, 0) === true, 'snooze 后 22:00 → true');
  const dismissedAndSnoozed = Object.assign(base(AT(21, 0)), { snoozedOn: '2026-09-15', dismissedOn: '2026-09-15' });
  eq(reminder.shouldRemind(dismissedAndSnoozed), false, '「今天不了」优先于「稍后再说」（关了就是关了）');
  const snoozeYesterday = Object.assign(base(AT(19, 0)), { snoozedOn: '2026-09-14' });
  truthy(reminder.shouldRemind(snoozeYesterday) === true, '昨天 snooze 的今天失效（日期串跨天语义）');
}

console.log('\n[A5] catchup 档：没排课但本周没达标也要提醒');
{
  const behind = Object.assign(base(), { hasPlan: false, weekDone: 1, weekTarget: 3 });
  truthy(reminder.shouldRemind(behind) === true, '没排课 + 本周差 2 天 → true（休息日也催补）');
  eq(reminder.shouldRemind(Object.assign(base(), { hasPlan: false, weekDone: 3, weekTarget: 3 })), false,
    '没排课但周目标已达成 → false');
  eq(reminder.shouldRemind(Object.assign(base(), { hasPlan: false })), false,
    '没排课且没周目标 → false（不催没指向的人）');
  truthy(reminder.shouldRemind(Object.assign(base(), { hasPlan: true, weekDone: 3, weekTarget: 3 })) === true,
    '有安排优先（周目标已达成也不影响 plan 档）');
}

console.log('\n[A6] 连续未练天数（文案分级的输入）');
{
  const TD = reminder.gapDaysSinceTrain;
  eq(TD(new Set(['2026-09-14']), '2026-09-15'), 1, '昨天练过 → 1');
  eq(TD(new Set(['2026-09-13']), '2026-09-15'), 2, '前天练过 → 2');
  eq(TD(new Set(['2026-09-10', '2026-09-14']), '2026-09-15'), 1, '取最近一场');
  eq(TD(new Set(), '2026-09-15'), 0, '从没练过 → 0（走温和档，不吓新人）');
  eq(TD(undefined, '2026-09-15'), 0, '脏输入不崩 → 0');
}

// ---------- [B] 文案组装 ----------
console.log('\n[B] buildReminder：不展示时留空，展示时文案完整');
{
  const off = reminder.buildReminder(Object.assign(base(), { enabled: false }));
  eq(off.show, false, '条件不满足 → show=false');
  eq(off.title, '' && '', "不展示时 title 为空串（调用方 wx:if 直接用 show）");
  truthy(off.title === '' && off.sub === '', '不展示时不残留文案');

  const on = reminder.buildReminder(base());
  eq(on.show, true, '条件满足 → show=true');
  eq(on.title, '今天还没训练', 'title');
  eq(on.action, '开始训练', 'action');

  // 副标题刻意不复述计划标题（上方「今日推荐」卡已经写了），只补时长 + 行动召唤
  truthy(on.sub.includes('5 个动作'), 'sub 含时长信息 ' + JSON.stringify(on.sub));
  truthy(on.sub.includes('现在开练还来得及'), 'sub 含行动召唤');
  truthy(!on.sub.includes('髋铰链'), 'sub 不复述计划标题（避免同屏重复）');

  const noMetric = reminder.buildReminder(Object.assign(base(), { plan: { title: '今日训练', metric: '' } }));
  eq(noMetric.sub, '现在开练还来得及', '无 metric 时不出现空占位');
  const noPlanObj = reminder.buildReminder(Object.assign(base(), { plan: undefined }));
  truthy(noPlanObj.show === true && noPlanObj.sub === '现在开练还来得及', '不传 plan 也不崩');
}

console.log('\n[B2] 文案分级（按连续未练天数）+ catchup 文案 + snoozable');
{
  const g2 = reminder.buildReminder(Object.assign(base(), { trainDates: new Set(['2026-09-13']) }));
  eq(g2.title, '连续 2 天没练了', '断练 2 天 → 点破档');
  eq(g2.sub, '练 20 分钟也算赢', '点破档副标题');
  const g3 = reminder.buildReminder(Object.assign(base(), { trainDates: new Set(['2026-09-10']) }));
  eq(g3.title, '断了别慌', '断练 3+ 天 → 回归激励档');
  eq(g3.sub, '从一场轻训练重启', '回归档副标题');
  truthy(!g3.sub.includes('还来得及'), '回归档不复用温和话术');

  // catchup：没排课但周目标没达成
  const cu = reminder.buildReminder(Object.assign(base(), { hasPlan: false, weekDone: 1, weekTarget: 3 }));
  eq(cu.title, '本周还差 2 天', 'catchup 标题带差额');
  eq(cu.action, '去训练', 'catchup CTA 指向训练 tab');
  truthy(!cu.title.includes('训练日'), 'catchup 文案不含「训练日」');
  const cuMet = reminder.buildReminder(Object.assign(base(), { hasPlan: false, weekDone: 3, weekTarget: 3 }));
  eq(cuMet.show, false, '周目标已达成不展示（与判据一致）');

  // snoozable：21 点前 true（还能「今晚再提醒」），21 点后 false
  const before = reminder.buildReminder(base(AT(19, 0)));
  truthy(before.snoozable === true, '19:00 → snoozable=true');
  const after = reminder.buildReminder(base(AT(21, 30)));
  truthy(after.snoozable === false, '21:30 → snoozable=false（选项消失）');
  const off = reminder.buildReminder({ enabled: false });
  truthy(off.snoozable === false && off.kind === '', '不展示时 kind/snoozable 归零');
}

// ---------- [C] 消费链闭环（本守卫的核心：防「假开关」复发） ----------
console.log('\n[C] 消费链闭环：开关 → 判据 → UI → 落库');
const HOME_JS = 'pages/home/home.js';
const HOME_WXML = 'pages/home/home.wxml';
const HOME_WXSS = 'pages/home/home.wxss';
const STORE = 'utils/store.js';
const APP = 'app.js';
const PROFILE_JS = 'pages/profile/profile.js';
const PROFILE_WXML = 'pages/profile/profile.wxml';

{
  const homeJs = read(HOME_JS);
  const homeWxml = read(HOME_WXML);
  const storeJs = read(STORE);

  // 1) 有独立口径模块，且首页真的在用它
  truthy(fs.existsSync('utils/reminder.js'), '存在口径单源 utils/reminder.js');
  truthy(/require\(\s*['"][^'"]*utils\/reminder\.js['"]\s*\)/.test(homeJs), '首页 require 了 reminder.js');
  truthy(/reminder\.buildReminder\s*\(/.test(homeJs), '首页调用 buildReminder()');

  // 2) 首页把 5 个事实全喂进去了（少喂一个就会默认成「条件不满足」而永不展示）
  for (const key of ['now', 'enabled', 'hasPlan', 'trainedToday', 'dismissedOn']) {
    truthy(new RegExp('\\b' + key + '\\s*:').test(homeJs), `首页传入 ${key}`);
  }
  truthy(/reminderOn/.test(homeJs), '首页读用户开关 reminderOn（★ 这就是原缺陷缺的那一环）');
  truthy(/trainingDone/.test(homeJs), '首页复用已算好的 trainingDone（不重复算一遍今天有没有练）');

  // 3) UI 真渲染了它
  truthy(/wx:if\s*=\s*"\{\{reminder\.show\}\}"/.test(homeWxml), 'wxml 用 reminder.show 控制显隐');
  truthy(/bindtap="startPlan"/.test(homeWxml) && /catchtap="closeReminder"/.test(homeWxml),
    'wxml 的 CTA 绑 startPlan、关闭绑 closeReminder（catchtap 防冒泡）');
  truthy(/\{\{reminder\.title\}\}/.test(homeWxml) && /\{\{reminder\.sub\}\}/.test(homeWxml),
    'wxml 渲染 title / sub');

  // 4) 关闭能落库，且落的是日期串（跨天自动失效）
  truthy(/closeReminder\s*\(/.test(homeJs), '首页有 closeReminder()');
  truthy(/setReminderDismissed\s*\(/.test(homeJs), 'closeReminder 调 store.setReminderDismissed');
  truthy(/setReminderDismissed\s*\(/.test(storeJs) && /getReminderDismissed\s*\(/.test(storeJs),
    'store 提供 get/setReminderDismissed');
  truthy(/reminderDismissedOn/.test(storeJs), 'store 持久化字段 reminderDismissedOn');
  truthy(/dateRange\.todayStr\s*\(/.test(homeJs), '关闭时写的是「今天」的日期串');

  // 5) 默认值 & 清除数据时一并重置（否则残留会让新用户莫名被静音）
  const appJs = read(APP);
  truthy(/reminderOn\s*:/.test(appJs) && /reminderDismissedOn\s*:/.test(appJs), 'app.js 有初始值');

  const clearBlock = profileJsClearBlock();
  truthy(/reminderDismissedOn\s*=\s*''/.test(clearBlock), '清除本机数据时重置 reminderDismissedOn');
  truthy(/reminderOn\s*=\s*false/.test(clearBlock), '清除本机数据时重置 reminderOn');
  truthy(/reminderHour\s*=\s*reminder\.REMIND_HOUR/.test(clearBlock), '清除本机数据时档位回默认（读常量不写死）');
  truthy(/reminderSnoozeOn\s*=\s*''/.test(clearBlock), '清除本机数据时重置 reminderSnoozeOn');

  // 5.5) v2 新事实链：档位 / 稍后再说 / 周目标 / 连续未练 —— 每个新判据都要有「喂进去」的一环
  for (const key of ['snoozedOn', 'remindHour', 'weekDone', 'weekTarget', 'trainDates']) {
    truthy(new RegExp('\\b' + key + '\\s*:').test(homeJs), `首页传入 ${key}`);
  }
  truthy(/weekRange\s*\(/.test(homeJs) && /inRange\s*\(/.test(homeJs),
    '首页周进度走 dateRange 自然周口径（不另写周区间）');
  truthy(/weekTargetOf\s*\(/.test(homeJs), '首页周目标读 trainingStats.weekTargetOf（daysPerWeek > weeklyTarget > 3 单源）');
  truthy(/snoozeReminder\s*\(/.test(homeJs) && /setReminderSnooze\s*\(/.test(homeJs),
    '首页有 snoozeReminder() 且落库');
  truthy(/setReminderSnooze\s*\(/.test(storeJs) && /getReminderSnooze\s*\(/.test(storeJs),
    'store 提供 get/setReminderSnooze');
  truthy(/reminderSnoozeOn/.test(storeJs) && /setReminderHour\s*\(/.test(storeJs),
    'store 持久化 reminderSnoozeOn、提供 setReminderHour（收口 normalizeHour）');
  truthy(/normalizeHour/.test(storeJs), 'store 档位落盘走 reminder.normalizeHour（档位集合单源）');

  // 5.6) CTA 分流：catchup 跳训练 tab，plan 走原 startPlan
  truthy(/reminderGo\s*\(/.test(homeJs) && /reminderGo/.test(homeWxml),
    '首页有 reminderGo() 且 wxml CTA 绑它');
  truthy(/kind === 'catchup'/.test(homeJs) && /switchTab/.test(homeJs),
    'catchup → switchTab 训练页（补一场是轻意图，不走计划页）');

  // 5.7) 稍后再说按钮：wxml 渲染 + snoozable 控制 + catchtap 防冒泡
  truthy(/wx:if="\{\{reminder\.snoozable\}\}"/.test(homeWxml) && /catchtap="snoozeReminder"/.test(homeWxml),
    'wxml 有「稍后再说」按钮（snoozable 控制 + catchtap）');

  // 6) 样式有主题覆盖，不做「深色下看不见」
  const homeWxss = read(HOME_WXSS);
  truthy(/\.remind\s*\{/.test(homeWxss), 'wxss 有 .remind 规则');
  truthy(/\.page\.theme-dark[\s\S]*?--primary-text\s*:/.test(homeWxss),
    'home.wxss 深色块重定义了 --primary-text（提醒条 CTA 用了它）');
  truthy(/\.remind-snooze\s*\{/.test(homeWxss), 'wxss 有 .remind-snooze 规则（稍后再说）');
  truthy(!/\.remind-snooze\s*\{[^}]*--text-weak/.test(homeWxss), 'remind-snooze 小字不用 --text-weak（对比度铁律）');

  // 7) 我的页：提醒时刻档位行（picker）接线
  const profileWxml = read(PROFILE_WXML);
  truthy(/bindchange="onPickReminderHour"/.test(profileWxml), '「我的」页有提醒时刻 picker');
  truthy(/range="\{\{hourLabels\}\}"/.test(profileWxml), 'picker 选项来自 hourLabels（REMIND_HOURS 生成，不写死时刻）');
  truthy(/wx:if="\{\{reminderOn\}\}"[\s\S]*?onPickReminderHour|onPickReminderHour[\s\S]*?wx:if="\{\{reminderOn\}\}"/.test(profileWxml),
    '时刻行仅开启提醒后可见');
  const profileJs2 = read(PROFILE_JS);
  truthy(/REMIND_HOURS\.map/.test(profileJs2), 'hourLabels 由 reminder.REMIND_HOURS 生成（时刻数字单源）');
  truthy(/onPickReminderHour\s*\(/.test(profileJs2) && /setReminderHour\s*\(/.test(profileJs2),
    '选档落 store.setReminderHour');
}

function profileJsClearBlock() {
  const src = read(PROFILE_JS);
  const i = src.indexOf('clearLocalData(');
  return i < 0 ? '' : src.slice(i, i + 2200);
}

// ---------- [D] 术语红线 ----------
console.log('\n[D] 术语红线：提醒相关文案禁出现「训练日」');
{
  // 本仓「训练日」= 模板里的 A 日 / B 日 / C 日（第几套课），不是「一周里的星期几」。
  // 提醒文案若写「训练日」会被用户读成「我训练的那几天」，且会指向一个不存在的实体。
  const pw = read(PROFILE_WXML);
  const i = pw.indexOf('bindtap="tapReminder"');
  const row = i < 0 ? '' : pw.slice(i, pw.indexOf('</view>', pw.indexOf('mi-ar', i)) + 10);
  truthy(row.length > 0, '取到「我的」页提醒行');
  truthy(!row.includes('训练日'), '提醒行文案不含「训练日」' + (row.includes('训练日') ? ' ← ' + row : ''));
  truthy(row.includes('未训练') || row.includes('未练'), '提醒行文案表达了「没练才提醒」的真实语义');

  const pj = read(PROFILE_JS);
  const j = pj.indexOf('tapReminder()');
  const body = j < 0 ? '' : pj.slice(j, pj.indexOf('\n  },', j));
  truthy(body.length > 0, '取到 tapReminder 方法体');
  truthy(!body.includes('训练日'), 'tapReminder 的弹窗文案不含「训练日」');
  truthy(!/推送/.test(body.replace(/不发系统推送/g, '')) === false || /不发系统推送/.test(body),
    '弹窗明说「不发系统推送」（不暗示系统级提醒）');

  // 口径单源本体也不得引入撞车词（v2 新增的分级/catchup 文案同样受红线约束）。
  // 先剥注释：头部那段「为什么不是训练日提醒」的历史说明本身要提到这个词，不算违规。
  const rjClean = read('utils/reminder.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  truthy(!rjClean.includes('训练日'), 'utils/reminder.js 代码与文案（剥注释后）不含「训练日」');
}

// ---------- [E] 阈值单源 ----------
console.log('\n[E] 阈值单源：时刻数字只能活在 utils/reminder.js');
{
  const rj = read('utils/reminder.js');
  const defs = rj.match(/REMIND_HOUR\s*=\s*18/g) || [];
  eq(defs.length, 1, 'reminder.js 中 REMIND_HOUR = 18 只定义一次');
  truthy(Array.isArray(reminder.REMIND_HOURS) && reminder.REMIND_HOURS.length === 3,
    'REMIND_HOURS 档位集合（18/20/21）');
  eq(reminder.SNOOZE_HOUR, 21, 'SNOOZE_HOUR 常量（稍后再说的再提示时刻）');

  // 文案里的时间必须来自常量/档位数据，不能自己写死
  const pj = read(PROFILE_JS);
  truthy(/reminder\.REMIND_HOUR/.test(pj), '「我的」页弹窗文案读 reminder.REMIND_HOUR（不写死 18:00）');
  truthy(!/18:00|20:00|21:00/.test(pj), '「我的」页无写死时刻（弹窗随档位、选项由 REMIND_HOURS 生成）');
  truthy(!/18:00|20:00|21:00/.test(read(HOME_JS)), '首页无写死时刻');
  truthy(!/18:00|20:00|21:00/.test(read(PROFILE_WXML)), '「我的」页 wxml 无写死时刻');
}

console.log(`\n${fail ? '✗' : '✓'} verify-reminder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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

  // 6) 样式有主题覆盖，不做「深色下看不见」
  const homeWxss = read(HOME_WXSS);
  truthy(/\.remind\s*\{/.test(homeWxss), 'wxss 有 .remind 规则');
  truthy(/\.page\.theme-dark[\s\S]*?--primary-text\s*:/.test(homeWxss),
    'home.wxss 深色块重定义了 --primary-text（提醒条 CTA 用了它）');
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
}

// ---------- [E] 阈值单源 ----------
console.log('\n[E] 阈值单源：18:00 只能活在 utils/reminder.js');
{
  const rj = read('utils/reminder.js');
  const defs = rj.match(/REMIND_HOUR\s*=\s*18/g) || [];
  eq(defs.length, 1, 'reminder.js 中 REMIND_HOUR = 18 只定义一次');

  // 文案里的时间必须来自常量，不能自己写死 18:00
  const pj = read(PROFILE_JS);
  truthy(/reminder\.REMIND_HOUR/.test(pj), '「我的」页弹窗文案读 reminder.REMIND_HOUR（不写死 18:00）');
  truthy(!/18:00/.test(pj), '「我的」页无写死 18:00');
  truthy(!/18:00/.test(read(HOME_JS)), '首页无写死 18:00');
}

console.log(`\n${fail ? '✗' : '✓'} verify-reminder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * verify-workout-finish.cjs —— 训练页「完成训练」二次确认卡（完成并生成分享图 / 完成训练 / 取消）契约守卫
 *
 * 为什么必须有它：
 *   这条链路跨了三个文件（workout 页 → review 页 → training-review 组件），而且**每一段都能静默失败**：
 *     · wxml 把 bindtap 写成 Mustache（本仓踩过：点击无反应且不报错）；
 *     · 「完成并生成分享图」保存了却没带 share=1 → 用户落到复盘页，分享卡不弹，看起来像按钮坏了；
 *     · 自动开分享卡的信号被反复消费 → 用户关掉卡片，一切回前台它又弹回来（pageLifetimes.show 每次都 rebuild）；
 *     · 保存前的登录门禁被绕过 → 未登录也能写训练记录；
 *     · 卡片落在**固定深色卡**上却用了随主题翻转的 token → 深色下文字/图标消失。
 *   上面每一条都不是「看起来像错的代码」，只有真机点一遍才发现。故用静态断言 + 真实页面/组件方法 stub 跑一遍。
 *
 * 覆盖 5 段契约：
 *   [A] wxml 结构：卡片存在、三个出口静态绑定、顺序与参考图一致、摘要走 wx:key
 *   [B] finishWorkout：副标题与三项摘要按真实 stats 生成，字段都是字符串（WXML 文本字段不许是对象）
 *   [C] 三个出口的行为：取消不保存 / 完成训练保存并返回 / 完成并生成分享图保存并 redirectTo 到 share=1
 *   [D] 复盘页接线：share=1 → autoShare → 组件一次性自动打开分享卡（信号不丢、也不重复消费）
 *   [E] 样式：卡片复用固定深色卡，且绿底徽章里的字形被钉死为墨色
 *
 * 用法： node scripts/verify-workout-finish.cjs
 * 退出码：0 = 通过；1 = 失败
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

/* ---------- 全局 mock（同 verify-rpe-input.cjs 的套路） ---------- */
const GD = {
  userInfo: { loggedIn: true, nickname: '测试' },
  profile: { fitnessDays: 0, goal: '增肌' },
  trainingLogs: [],
  trainingPlans: [],
  activePlanId: '',
  customActions: [],
  favorites: [],
  selectedActions: [
    { id: '0025', name: 'bench', nameZh: '杠铃卧推', category: '胸', part: '胸', equip: '',
      sets: [{ reps: 8, weight: 60, rpe: 7 }, { reps: 8, weight: 60, rpe: '' }] },
    { id: '0030', name: 'squat', nameZh: '深蹲', category: '腿', part: '腿', equip: '',
      setsCount: 3, reps: '5', weight: '100' }
  ],
  restTimer: 90
};
global.getApp = () => ({ globalData: GD, persist() {} });

const redirectCalls = [];
const navigates = [];
const modals = [];
// setTimeout 被接管：saveWorkout 末尾的「保存后去向」要靠手动跑最后一个定时器才生效
let timers = [];
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
const runLastTimer = () => { const t = timers.pop(); if (t) { t.fn(); return t; } return null; };

global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  switchTab: () => {}, navigateBack: (o) => { navigates.push(o); },
  redirectTo: (o) => { redirectCalls.push(o); },
  showToast: () => {}, showModal: (o) => { modals.push(o); },
  createInnerAudioContext: () => ({ stop() {}, play() {}, destroy() {} }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  // 同步执行：把「推迟一拍再开分享卡」的时序压成一条直线，方便断言
  nextTick: (fn) => fn(),
  vibrateShort: () => {}, setKeepScreenOn: () => {}
};

// 可控时钟：store.saveTrainingLog 用 createdAt 决定「同日多场」的先后。真机上两次保存相隔数十秒
// 必然不同，但 harness 里两次保存会落在同一毫秒 → 先后变成「不确定」，「分享的是刚练完那一场」
// 这条断言就会随机红。把时钟钉成单调递增即可确定（每次读 +1s）。
let CLOCK = 1758000000000;
Date.now = () => (CLOCK += 1000);

function setPath(obj, key, value) {
  const tokens = key.replace(/\[/g, '.').replace(/\]/g, '').split('.');
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (cur[t] == null) cur[t] = /^\d+$/.test(tokens[i + 1]) ? [] : {};
    cur = cur[t];
  }
  cur[tokens[tokens.length - 1]] = value;
}
function mkSetData() {
  return function (obj, cb) {
    Object.keys(obj).forEach(k => setPath(this.data, k, obj[k]));
    if (cb) cb();
  };
}

let PAGE = null;
global.Page = function (opts) { opts.setData = mkSetData(); PAGE = opts; };
require(path.join(ROOT, 'pages', 'workout', 'workout.js'));

let TR = null;
global.Component = function (spec) { TR = spec; };
require(path.join(ROOT, 'components', 'training-review', 'training-review.js'));

/* ══════════════ [A] wxml 结构 ══════════════ */
console.log('[A] 确认卡结构（三个出口都是静态绑定，顺序即优先级）');
const WXML = read('pages/workout/workout.wxml');
const WXSS = read('pages/workout/workout.wxss');
const card = (function () {
  const s = WXML.indexOf('顶栏「完成训练」二次确认卡');
  const e = WXML.indexOf('动作历史 overlay', s + 1);
  return (s >= 0 && e > s) ? WXML.slice(s, e) : '';
})();

assert(!!card, 'wxml 里存在确认卡区块');
assert(/bindtap="finishWorkout"/.test(WXML), '顶栏按钮仍绑 finishWorkout（入口名不变）');
for (const fn of ['finishAndShare', 'finishOnly', 'closeFinishCard']) {
  assert(new RegExp('bindtap="' + fn + '"').test(card), '卡片内有 bindtap="' + fn + '"');
}
assert(!/bind[a-z:]*="\{\{/.test(card), '卡片内无 Mustache 事件名（静态字面量）');
assert(/完成并生成分享图/.test(card), '主按钮文案 = 完成并生成分享图');
const iShare = card.indexOf('finishAndShare'), iOnly = card.indexOf('finishOnly'), iCancel = card.indexOf('closeFinishCard');
assert(iShare > 0 && iShare < iOnly && iOnly < iCancel, '顺序 = 完成并生成分享图 → 完成训练 → 取消（与参考图一致）');
assert(/finishSub/.test(card), '副标题绑定 finishSub（未完成组的信息不丢）');
assert(/wx:for="\{\{finishSummary\}\}"/.test(card) && /wx:key="k"/.test(card),
  '摘要三项走 wx:for + 唯一键 wx:key="k"');
assert(/rest-pop dark/.test(card) && /catchtouchmove="noop"/.test(card),
  '复用 .rest-pop.dark 固定深色卡 + 遮罩吞掉滚动');

/* ══════════════ [B] finishWorkout → 卡片内容 ══════════════ */
console.log('\n[B] finishWorkout → 副标题 + 三项摘要');
PAGE.data.stats = { totalSets: 10, doneSets: 10, totalActions: 3, doneActions: 3, doneVol: 3200, totalVol: 3200 };
PAGE.data.workoutClock = '42:15';
PAGE.finishWorkout();
assert(PAGE.data.showFinishCard === true, '打开卡片');
assert(PAGE.data.finishSub === '全部动作已完成', '全完成 → 副标题「全部动作已完成」（实际 ' + PAGE.data.finishSub + '）');
assert(PAGE.data.finishSummary.length === 3, '摘要三项');
assert(PAGE.data.finishSummary[0].v === '42:15', '第一项是全局计时器读数（42:15）');
assert(PAGE.data.finishSummary[1].v === '10/10', '第二项是完成组数（10/10）');
assert(PAGE.data.finishSummary[2].v === '3/3', '第三项是完成动作数（3/3）');
assert(PAGE.data.finishSummary.every(x => typeof x.k === 'string' && typeof x.v === 'string'),
  '摘要 k/v 全是字符串（WXML 文本字段不许是对象，否则渲染 [object Object]）');

modals.length = 0;
PAGE.data.stats = { totalSets: 10, doneSets: 6, totalActions: 3, doneActions: 1, doneVol: 1800, totalVol: 3200 };
PAGE.finishWorkout();
assert(PAGE.data.finishSub === '还有 4 组未完成', '未完成 → 副标题给出剩余组数（实际 ' + PAGE.data.finishSub + '）');
assert(PAGE.data.finishSummary[1].v === '6/10', '未完成时组数如实显示 6/10');
assert(modals.length === 0, '不再走 wx.showModal（信息已进卡片，弹两次确认是重复打扰）');

PAGE.data.stats = {};
PAGE.data.workoutClock = '';
PAGE.finishWorkout();
assert(PAGE.data.finishSub === '全部动作已完成', 'stats 缺失时不崩（0 组视为已完成）');
assert(PAGE.data.finishSummary.every(x => typeof x.v === 'string' && x.v.indexOf('undefined') < 0 && x.v.indexOf('NaN') < 0),
  '空态摘要不含 undefined / NaN');

/* ══════════════ [C] 三个出口 ══════════════ */
console.log('\n[C] 三个出口：取消 / 完成训练 / 完成并生成分享图');
PAGE.onLoad();                                   // 真正装载 actions 与 stats
const logsBefore = GD.trainingLogs.length;
const FULL_STATS = { totalSets: 10, doneSets: 10, totalActions: 3, doneActions: 3, doneVol: 3200, totalVol: 3200 };

PAGE.data.stats = FULL_STATS;
PAGE.finishWorkout();
PAGE.closeFinishCard();
assert(PAGE.data.showFinishCard === false, '取消 → 关卡片');
assert(GD.trainingLogs.length === logsBefore, '取消 → 不落库（没有半截训练记录）');
assert(redirectCalls.length === 0 && navigates.length === 0, '取消 → 不发生任何跳转');

PAGE.data.stats = FULL_STATS;
PAGE.finishWorkout();
PAGE.finishOnly();
assert(GD.trainingLogs.length === logsBefore + 1, '完成训练 → 落库一条日志');
assert(PAGE.data.showFinishCard === false, '完成训练 → 先关卡片（toast/跳转期间不残留弹层）');
const t1 = timers[timers.length - 1];
assert(!!t1 && t1.ms === 1000, '完成训练 → 走原有 1000ms 停留');
runLastTimer();
assert(redirectCalls.length === 0, '完成训练 → 不走 share 跳转');
assert(navigates.length === 1, '完成训练 → 原路 navigateBack 一次');

PAGE.data.stats = FULL_STATS;
PAGE.finishWorkout();
PAGE.finishAndShare();
assert(GD.trainingLogs.length === logsBefore + 2, '完成并生成分享图 → 同样落库（复用同一条保存路径）');
const t2 = timers[timers.length - 1];
assert(!!t2 && t2.ms === 700, '分享路径停留更短（700ms：用户的目标就是那张图）');
runLastTimer();
assert(redirectCalls.length === 1, '保存后 redirectTo 一次');
assert(redirectCalls[0].url === '/pages/review/review?share=1',
  '落点 = 复盘页 + share=1（实际 ' + (redirectCalls[0] || {}).url + '）');
assert(navigates.length === 1, 'share 路径不再 navigateBack（本页已结束，redirectTo 替换它，返回键直达训练 tab）');

// 登录门禁：未登录不落库，且卡片不凭空消失
GD.userInfo.loggedIn = false;
const n3 = GD.trainingLogs.length;
modals.length = 0;
redirectCalls.length = 0;
PAGE.data.stats = FULL_STATS;
PAGE.finishWorkout();
PAGE.finishAndShare();
assert(GD.trainingLogs.length === n3, '未登录 → 不落库');
assert(PAGE.data.showFinishCard === true, '未登录 → 什么结果都没发生，卡片就不该消失');
assert(modals.length >= 1, '未登录 → 弹出登录引导');
GD.userInfo.loggedIn = true;
PAGE.closeFinishCard();

/* ══════════════ [C2] 整场总时长落库 ══════════════ */
// 数据页「训练时长」= 本次训练总时长：saveWorkout 必须把 workoutSession.getElapsed()
// （训练页顶部计时的同一口径）落进 log.durationSec，且必须在 clear() **之前**取——
// clear 后 getElapsed() 恒为 0，这个顺序错了表现是「时长永远 0」，静默不报错。
console.log('\n[C2] 整场总时长：durationSec 落库（数据页时长真源）');
const workoutSession = require(path.join(ROOT, 'utils', 'workoutSession.js'));
const statsMod = require(path.join(ROOT, 'utils', 'trainingStats.js'));
workoutSession.save({ signature: 'x', actions: [], planName: '', expandedId: '', elapsed: 3754, running: false, startTs: null });
PAGE.data.stats = FULL_STATS;
PAGE.finishWorkout();
PAGE.finishOnly();
runLastTimer();
const savedLast = GD.trainingLogs[0];   // store 按 date+createdAt 倒序 → 头部才是刚保存那场
assert(!!savedLast, '完成训练 → 落库一条日志（C2）');
assert(Number(savedLast.durationSec) === 3754,
  'log.durationSec = 会话 elapsed（实际 ' + savedLast.durationSec + '）——取自 clear() 之前');
assert(statsMod.durationSecOfLog(savedLast) === 3754,
  'durationSecOfLog 优先消费 durationSec（数据页/复盘/分享卡同一把尺）');
// 旧日志（无 durationSec）→ 退回逐组累加，不因为新字段引入而断历史口径
const legacyLog = { actions: [{ setsDetail: [{ trainSec: 60, restSec: 30 }, { trainSec: 45, restSec: 0 }] }] };
assert(statsMod.durationSecOfLog(legacyLog) === 135, '旧日志退回 Σ(trainSec+restSec) = 135');
workoutSession.clear();

/* ══════════════ [D] 复盘页接线 ══════════════ */
console.log('\n[D] 复盘页 share=1 → 组件一次性自动开分享卡');
const RJ = read('pages/review/review.js');
assert(/onLoad\s*\(\s*options\s*\)/.test(RJ) && /options\.share === '1'/.test(RJ), 'review.js onLoad 识别 share=1');
assert(/autoShare: false/.test(RJ), 'review.js data 有 autoShare 默认值');
assert(/autoShare: true/.test(RJ), 'review.js 命中 share=1 时置位');
assert(/<training-review autoShare="\{\{autoShare\}\}" \/>/.test(read('pages/review/review.wxml')),
  'review.wxml 把 autoShare 透传给组件');

assert(!!TR && !!TR.properties && !!TR.properties.autoShare, '组件声明 autoShare 属性');
assert(typeof TR.properties.autoShare.observer === 'function', 'autoShare 有 observer');
assert(typeof TR.methods._tryAutoShare === 'function', '_tryAutoShare 存在');
assert(/this\._wantShare = false;/.test(read('components/training-review/training-review.js')),
  '信号被消费（一次性，避免切前台反复弹）');

function mkInst() {
  const calls = [];
  const inst = Object.assign({}, TR.methods, {
    data: JSON.parse(JSON.stringify(TR.data)),
    setData: mkSetData(),
    openShareCard() { calls.push('open'); }
  });
  inst._calls = calls;
  return inst;
}

// ① 数据未就绪：信号必须留住，不能丢
const i1 = mkInst();
i1._wantShare = true;
i1._logs = [];
i1._tryAutoShare();
assert(i1._calls.length === 0 && i1._wantShare === true, '数据未就绪 → 不消费信号，等 rebuild');

// ② 数据就绪：补开，且只开一次
i1._logs = GD.trainingLogs.slice();
i1._tryAutoShare();
assert(i1._calls.length === 1, '数据就绪 → 补开分享卡');
assert(i1._wantShare === false, '开出即清（一次性）');
i1._tryAutoShare();
assert(i1._calls.length === 1, '再次 rebuild 不重开（含 pageLifetimes.show）');

// ③ 属性观察器路径
const i2 = mkInst();
i2._logs = GD.trainingLogs.slice();
TR.properties.autoShare.observer.call(i2, false);
assert(i2._calls.length === 0 && !i2._wantShare, 'autoShare=false 不触发');
TR.properties.autoShare.observer.call(i2, true);
assert(i2._calls.length === 1, 'observer(true) → 开一次');

// ④ attached 路径（属性可能先于 attached 送达，两条路径都要覆盖）
const i3 = mkInst();
i3.data.autoShare = true;
TR.lifetimes.attached.call(i3);
assert(i3._calls.length === 1, 'attached 里读 data.autoShare 也能开出（跑的是真实 rebuild）');
// 「刚练完那一场」必须就是自动打开的那一场 —— 同日多场时按 createdAt 取最新（store 已按 date,createdAt 倒序）
const newest = GD.trainingLogs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
assert(!!newest, 'harness 已产出可比对的场次');
assert(i3._selIdx === 0, '自动打开的是最新一场（selIdx 落在 0，不翻历史）');
assert(!!i3._logs[0] && i3._logs[0].sid === newest.sid,
  '打开的就是**刚保存那一场**（实际 ' + ((i3._logs[0] || {}).sid || '无') + '）');

/* ══════════════ [E] 样式 ══════════════ */
console.log('\n[E] 样式：固定深色卡 + 绿底徽章字形钉死墨色');
assert(/\.fin-sum\s*\{/.test(WXSS) && /\.fin-sum-v\s*\{/.test(WXSS) && /\.fin-link\s*\{/.test(WXSS),
  '.fin-sum / .fin-sum-v / .fin-link 样式齐备');
assert(!/\.fin-[\w-]*[^{]*\{[^}]*var\(--text\)/.test(WXSS),
  '卡片内字色不用 var(--text)（深色下会翻白，而卡片底色并不翻转）');
assert(/\.rest-pop-emoji\.solid \.ico\s*\{[^}]*background-color:\s*#0A0A0A/.test(WXSS),
  '绿底徽章字形钉死 #0A0A0A（ico--ink 取 var(--text)，深色下翻白 → 白压亮绿 1.6:1 隐形）');
assert(/\.fin-link\.dim\s*\{/.test(WXSS), '取消比「完成训练」更弱（两行文字按钮的层级）');

console.log('\n' + (fail ? '✗ verify-workout-finish: ' + pass + ' passed, ' + fail + ' failed'
                        : '✓ verify-workout-finish: ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);

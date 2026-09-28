// scripts/verify-profile.cjs —— 「我的」页 + 连续天数口径 回归守卫（node 直跑，无 wx 环境）
//
// 覆盖三块：
//   [A] dateRange.streakFromDates 边界（首页「连续打卡」与本页「连续训练天数」共用的唯一回溯实现）
//   [B] profile.js refresh() 派生数据（训练天数/连续天数/总次数/本月/本周/时长/容量 + 最近一场卡片）
//   [C] 静态闭环：wxml 类名 ↔ wxss/icons、行内 style 禁 Mustache、wxml 字段 ↔ js data
//       以及「联系开发者」入口（button open-type）与隐私政策「联系我们」文案的跨文件闭环
//
// 用法：node scripts/verify-profile.cjs
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(msg) { pass++; }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label);
  else bad(label + '：期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual));
}
function truthy(v, label) { if (v) ok(label); else bad(label); }

const dateRange = require(path.join(ROOT, 'utils/dateRange.js'));

const TODAY = dateRange.todayStr();
const D = (n) => dateRange.shiftDaysISO(TODAY, n);

/* ══════════════ [A] streakFromDates ══════════════ */
console.log('[A] dateRange.streakFromDates');
eq(dateRange.streakFromDates(new Set()), 0, 'A1 空集合 → 0');
eq(dateRange.streakFromDates(new Set([TODAY])), 1, 'A2 仅今天 → 1');
eq(dateRange.streakFromDates(new Set([TODAY, D(-1)])), 2, 'A3 今天+昨天 → 2');
eq(dateRange.streakFromDates(new Set([D(-1), D(-2)])), 0, 'A4 今天缺卡 → 0（不向后顺延，与首页口径一致）');
eq(dateRange.streakFromDates(new Set([TODAY, D(-1), D(-3)])), 2, 'A5 中间断档 → 停在断点');
eq(dateRange.streakFromDates([TODAY, D(-1), D(-2)]), 3, 'A6 数组入参同样可用');
eq(dateRange.streakFromDates(new Set([D(-1), D(-2)]), D(-1)), 2, 'A7 显式 today 基准可注入（便于测试）');
eq(dateRange.streakFromDates(null), 0, 'A8 null 入参不炸');

/* ══════════════ [B] profile.js refresh() ══════════════ */
console.log('[B] pages/profile refresh()');
const GD = {
  userInfo: { loggedIn: true, nickname: '阿门', avatar: '' },
  profile: { fitnessDays: 12, goal: '减脂', height: 175, targetWeight: 65, weeklyTarget: 4 },
  selectedActions: [], trainingPlans: [], activePlanId: '',
  weightRecords: [], trainingLogs: [], meals: [], favorites: [], customActions: [],
  reminderOn: false, keyActionPicks: []
};
const STORAGE = {};
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = {
  getStorageSync: (k) => (STORAGE[k] === undefined ? '' : STORAGE[k]),
  setStorageSync: (k, v) => { STORAGE[k] = v; },
  removeStorageSync: (k) => { delete STORAGE[k]; },
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  setNavigationBarColor: () => {},
  showToast: () => {}, showModal: () => {}, switchTab: () => {}, navigateTo: () => {},
  getFileSystemManager: () => ({ writeFile: () => {}, readFile: () => {} }),
  env: { USER_DATA_PATH: '/tmp' }
};
let PAGE = null;
global.Page = (opts) => { PAGE = opts; };
require(path.join(ROOT, 'pages/profile/profile.js'));
truthy(PAGE, 'B0 页面对象已捕获');

// 每条日志 1 个动作、3 组 × 40kg × 10 次、每组 60s 训练 + 60s 休息
// createdAt 自增：store 里日志按「日期倒序 + createdAt 倒序」排，同日多场要靠它分新旧，
// 测试数据必须带这个字段，否则测不到「同日取最新一场」这条规则。
let logSeq = 0;
function mkLog(date, cat, planId) {
  const sets = [];
  for (let i = 0; i < 3; i++) sets.push({ reps: 10, weight: 40, trainSec: 60, restSec: 60, rpe: 7 });
  return {
    date, planId: planId || '', programId: '', createdAt: ++logSeq,
    actions: [{ id: 'x' + cat, category: cat, equip: '', name: cat + '动作', sets: 3, reps: 10, weight: 40, setsDetail: sets }]
  };
}
GD.trainingLogs = [mkLog(TODAY, '胸'), mkLog(D(-1), '胸'), mkLog(D(-2), '腿'), mkLog(D(-10), '背')];
GD.weightRecords = [{ date: D(-2), weight: 70 }, { date: TODAY, weight: 69.8 }];

const ctx = Object.assign({}, PAGE, {
  data: JSON.parse(JSON.stringify(PAGE.data)),
  setData(o) { Object.assign(this.data, o); },
  getTabBar: () => null
});
ctx.onShow();
const d = ctx.data;

// 训练天数：4 个不同日期
eq(d.totals.days, 4, 'B1 训练天数 = 去重日期数');
// 连续天数：今天 / -1 / -2 连续，-10 断档 → 3
eq(d.totals.streak, 3, 'B2 连续天数 = 3（今天往前连续 3 天）');
eq(d.totals.sessions, 4, 'B3 总训练次数 = 日志条数');
// 本月：按今天所在自然月统计（跨月时 D(-10) 不计）
const expectMonth = GD.trainingLogs.filter(l => l.date.slice(0, 7) === TODAY.slice(0, 7)).length;
eq(d.totals.month, expectMonth, 'B4 本月训练 = 本月日志数');
// 周目标：无激活计划 → 用 profile.weeklyTarget=4
eq(d.totals.weekTarget, 4, 'B5 周目标回落到 profile.weeklyTarget');
// 时长：4 条 × 3 组 × 120s = 1440s → 24m
eq(d.totals.dur, '24m', 'B6 累计时长口径 Σ(train+rest)');
// 容量：4 条 × 3 组 × 40 × 10 = 4800
eq(d.totals.vol, '4800', 'B7 累计容量口径 Σ(重量×次数)');

// 我的训练首行 = 今日训练计划（不再是「最近一场」）。此刻无计划、今天已练过 → 完成态
eq(d.train.show, true, 'B23 今天练过 → 首行有内容');
eq(d.train.mode, 'done', 'B24 今天练过 → 完成态（不是「本周已完成」那种按计划归属的旧口径）');
eq(d.train.tag, '已完成', 'B24b 完成态标签');
eq(d.train.title, '胸', 'B25 单一分类用分类名作训练名');
eq(d.train.meta, '1 个动作 · 6 分钟 · 24 kcal', 'B26 副标题 = 动作数 · 时长 · 估算 kcal');

// 自然周半开 [周一, 下周一)：周一当天计入、上周日不计入
const wr = dateRange.weekRange(TODAY);
const baseWeek = d.totals.week;
GD.trainingLogs = GD.trainingLogs.concat([mkLog(dateRange.shiftDaysISO(wr.monStr, -1), '背')]);
ctx.refresh();
eq(ctx.data.totals.week, baseWeek, 'B8 上周日（区间外）不计入本周');
GD.trainingLogs = GD.trainingLogs.concat([mkLog(wr.monStr, '背')]);
ctx.refresh();
eq(ctx.data.totals.week, baseWeek + 1, 'B9 本周一（区间起点）计入本周');
// 同日多条：取 createdAt 最新的那条（周一追加的「背」应顶掉今天的「胸」）
// 注：旧实现用「数组里最后一条 date >= 当前」判定，在 store 的「最新在前」排序下会取到当天更旧的一场，
//     是潜在 bug；现在按 createdAt 显式取最新。
if (wr.monStr === TODAY) eq(ctx.data.train.title, '背', 'B9b 同日多条取 createdAt 最新的一条');

// 体重变化：目标「减脂」→ 下降为好，tone=good
eq(d.weightDelta.show, true, 'B10 有两次体重记录 → 显示变化');
eq(d.weightDelta.text, '↓ 0.2 kg', 'B11 变化文案带方向箭头');
eq(d.weightDelta.tone, 'good', 'B12 减脂目标下下降记为向好');
// 增肌目标下，下降不再是「好」→ 不上绿色
GD.profile.goal = '增肌';
ctx.refresh();
eq(ctx.data.weightDelta.tone, '', 'B13 增肌目标下下降不给绿色（避免读反）');
GD.profile.goal = '减脂';
ctx.refresh();

// 健康四格
eq(d.health.height, 175, 'B14 身高取 profile');
eq(d.health.bmi, '22.8', 'B15 BMI 保留 1 位（69.8 / 1.75²）');
eq(d.health.bmiTone, 'good', 'B16 BMI 22.8 落入「正常」档');
eq(d.health.bmiLabel, '正常', 'B17 BMI 分档文案');
eq(d.health.goal, '减脂', 'B18 目标词归一后展示');

// 目标体重：起点取最早一笔（70）→ 目标 65，已减 0.2
eq(d.goal.from, 70, 'B19 起点取最早体重记录');
eq(d.goal.to, 65, 'B20 目标体重取 profile.targetWeight');
eq(d.goal.verb, '减', 'B21 方向 = 减');
eq(d.goal.remain, 4.8, 'B22 还差 4.8kg');

// 无日志 → 落空态，不出现 NaN/undefined
GD.trainingLogs = [];
ctx.refresh();
eq(ctx.data.train.show, false, 'B27 无日志 → 空态');
eq(ctx.data.train.tag, '', 'B27b 空态不残留上一轮的标签（train 每次整体赋值，不增量改字段）');
eq(ctx.data.totals.streak, 0, 'B28 无日志 → 连续天数 0');
eq(ctx.data.totals.vol, '0', 'B29 无日志 → 容量 0');
eq(ctx.data.health.weight, '69.8', 'B30 无日志但有体重 → 体重仍可取到');

/* ══════════════ [B2] 首行的今日计划态（口径来自 utils/todayPlan.js） ══════════════ */
console.log('[B2] 我的训练首行 = 今日训练计划');
eq(ctx.data.train.mode, 'empty', 'B31 无计划无日志 → empty');

// 模板计划：标题只留训练日，方案名下沉副标题（与计划页卡片同一命名口径）
GD.trainingPlans = [{
  id: 'P1', programId: 'prog1', dayIndex: 1, daysPerWeek: 3,
  name: '力量·基础五大项 · B 日 · 髋铰链 + 上肢拉',
  actions: [{ actionId: 'a1', name: '硬拉', setsCount: 4 }, { actionId: 'a2', name: '划船', setsCount: 3 }]
}];
GD.activePlanId = 'P1';
ctx.refresh();
eq(ctx.data.train.show, true, 'B32 有计划未练 → 首行有内容');
eq(ctx.data.train.mode, 'todo', 'B33 有计划未练 → 待练态');
eq(ctx.data.train.tag, '今日', 'B34 待练态标签「今日」');
eq(ctx.data.train.title, 'B 日 · 髋铰链 + 上肢拉', 'B35 模板计划标题只留训练日');
eq(ctx.data.train.meta, '力量·基础五大项 · 2 个动作 · 约 11 分钟',
  'B36 副标题 = 方案名 · 动作数 · 估算时长（7 组×1.5=10.5→11 分钟）');

// 非模板计划（无 programId）→ 标题直接用计划名
GD.trainingPlans = [{ id: 'P2', name: '我的推日', actions: [{ actionId: 'a1', name: '卧推', setsCount: 4 }] }];
GD.activePlanId = 'P2';
ctx.refresh();
eq(ctx.data.train.title, '我的推日', 'B37 非模板计划标题取计划名');
eq(ctx.data.train.meta, '1 个动作 · 约 10 分钟', 'B38 组数不足下限 → 时长兜底 10 分钟');

// 无计划但有手动已选 → 兜底待练态（selectedActions 跨天会被清空，只能当兜底）
GD.trainingPlans = [];
GD.activePlanId = '';
GD.selectedActions = [
  { id: 'm1', name: '卷腹', sets: [{}, {}] },
  { id: 'm2', name: '平板支撑' }
];
ctx.refresh();
eq(ctx.data.train.mode, 'todo', 'B39 无计划有手动已选 → 待练态');
eq(ctx.data.train.title, '今日训练', 'B40 手动已选的标题是通用「今日训练」');
eq(ctx.data.train.meta, '2 个动作 · 约 10 分钟', 'B41 组数按 sets 长度、无 sets 退回 setsCount(0)');

// 完成态优先于待练态：有计划但今天已练 → 显示今天实际那一场，不虚报成计划名
GD.trainingPlans = [{ id: 'P3', name: '我的推日', actions: [{ actionId: 'a1', name: '卧推', setsCount: 4 }] }];
GD.activePlanId = 'P3';
GD.trainingLogs = [mkLog(TODAY, '胸')];
ctx.refresh();
eq(ctx.data.train.mode, 'done', 'B42 有计划但今天已练 → 完成态优先');
eq(ctx.data.train.title, '胸', 'B43 完成态名称取今天实际那一场，不冒充计划名');

// 恢复干净状态，避免影响后续
GD.trainingPlans = [];
GD.activePlanId = '';
GD.selectedActions = [];
GD.trainingLogs = [];
ctx.refresh();

/* ══════════════ [C] 静态闭环 ══════════════ */
console.log('[C] 静态闭环');
const wxml = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.wxss'), 'utf8');
const icons = fs.readFileSync(path.join(ROOT, 'styles/icons.wxss'), 'utf8');

// C1 花括号平衡（曾因整段删除吞掉相邻规则而失衡）
const ob = (wxss.match(/\{/g) || []).length, cb = (wxss.match(/\}/g) || []).length;
eq(ob, cb, 'C1 wxss 花括号平衡 ' + ob + '/' + cb);

// C2 行内 style 必须是整串注入（禁 {{}} 拼接字面量）
let badStyle = [];
wxml.replace(/style="([^"]*)"/g, (_, v) => { if (!/^\{\{[^}]*\}\}$/.test(v)) badStyle.push(v); return ''; });
eq(badStyle.length, 0, 'C2 行内 style 均为整串 {{...}} 注入' + (badStyle.length ? ' → ' + badStyle.join(' | ') : ''));

// C3 wxml 类名都有定义（wxss 或 icons）
const defined = new Set();
wxss.replace(/\.([A-Za-z0-9_-]+)/g, (_, n) => { defined.add(n); return ''; });
icons.replace(/\.([A-Za-z0-9_-]+)/g, (_, n) => { defined.add(n); return ''; });
const usedCls = new Set();
// ⚠️ 必须要求 class 前面不是 `-`/字母数字：否则 `hover-class="none"` 会被当成 class="none"，
// 于是「none」变成一个从未定义的类名 → 假警报（任何合法的 hover-class 都会踩）。
wxml.replace(/(?:^|[^-A-Za-z0-9_])class="([^"]*)"/g, (_, v) => {
  v.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).forEach(t => { if (t) usedCls.add(t); });
  return '';
});
const noDef = [...usedCls].filter(c => !defined.has(c));
eq(noDef.length, 0, 'C3 wxml 类名全部有定义' + (noDef.length ? ' → 缺 ' + noDef.join(', ') : ''));

// C4 ico-<key> 必须存在于图标表（拼错 key 会渲染成空白方块）
const iconKeys = new Set();
(icons.match(/\.ico-([a-zA-Z0-9_-]+)\s*\{/g) || []).forEach(s => iconKeys.add(s.match(/\.ico-([a-zA-Z0-9_-]+)/)[1]));
const mods = ['ink', 'muted', 'primary', 'success', 'warning', 'info', 'accent'];
const badIcon = [];
wxml.replace(/ico-([a-z0-9-]+)/g, (_, k) => { if (mods.indexOf(k) < 0 && !iconKeys.has(k)) badIcon.push(k); return ''; });
eq(badIcon.length, 0, 'C4 ico-* 引用均存在' + (badIcon.length ? ' → 缺 ' + badIcon.join(', ') : ''));

// C5 wxml 字段都能在 js 里找到定义（防改字段名漏改一处 → 页面静默空白）
const js = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.js'), 'utf8');
const idents = new Set();
wxml.replace(/\{\{([^}]*)\}\}/g, (_, expr) => {
  expr.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (id, off) => { if (expr[off - 1] !== '.') idents.add(id); return id; });
  return '';
});
const miss = [...idents].filter(id =>
  ['true', 'false', 'null', 'undefined'].indexOf(id) < 0 && !new RegExp('\\b' + id + '\\s*:').test(js));
eq(miss.length, 0, 'C5 wxml 字段全部有定义' + (miss.length ? ' → 缺 ' + miss.join(', ') : ''));

// C6 亮绿实底上的字形：--primary 不随主题变化，.ico--ink 在 dark 下会翻白 → 必须显式拉回。
// 用 .p-chip 当锚点校验整条选择器组，新增亮绿实底图标位（如 .p-avatar-add 的加号角标）必须一并进来。
const pullBack = wxss.match(/\.page\.theme-dark[^{]*\{\s*background-color:\s*#0A0A0A/);
const pullBackSel = pullBack ? pullBack[0] : '';
const chipUse = /\.p-chip\s+\.ico--ink/.test(pullBackSel)
  && /\.tk-go\s+\.ico--ink/.test(pullBackSel)
  && /\.p-avatar-add\s+\.ico--ink/.test(pullBackSel);
truthy(chipUse, 'C6 亮绿底上的图标在深色下有墨色拉回（p-chip / tk-go / p-avatar-add）');

// C7 Hero 底图：明暗两张都随包发布，体积可控 **且几何尺寸一致**。
// 同尺寸是关键不变式：Hero 的 min-height 是按底图高度折算成 rpx 的常量，
// 两张不同高就会「切主题跳版」。纯 node 读 JPEG 的 SOF 段取尺寸，不引 PIL/canvas。
function jpegSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;      // 不是 JPEG
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += 2; continue; }
    if (m === 0xDA) break;                               // 进入扫描数据，后面没有头了
    const isSOF = (m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7)
      || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF);
    if (isSOF) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
const bgDims = ['static/my-bg.jpg', 'static/my-bg-dark.jpg'].map(rel => {
  const abs = path.join(ROOT, rel);
  truthy(fs.existsSync(abs), 'C7 ' + rel + ' 存在');
  if (!fs.existsSync(abs)) return null;
  const kb = Math.round(fs.statSync(abs).size / 1024);
  truthy(kb < 120, 'C7 ' + rel + ' ' + kb + 'KB < 120KB');
  const d = jpegSize(abs);
  truthy(!!d, 'C7 ' + rel + ' 尺寸可解析');
  return d;
});
if (bgDims[0] && bgDims[1]) {
  eq(bgDims[1].h, bgDims[0].h, 'C7 明暗底图同高（' + bgDims[0].h + 'px，不同高会切主题跳版）');
  eq(bgDims[1].w, bgDims[0].w, 'C7 明暗底图同宽（' + bgDims[0].w + 'px）');
}
// Hero min-height 必须≈底图按 750rpx 宽折算的高度
const heroMin = (wxss.match(/\.p-hero\s*\{[^}]*min-height:\s*(\d+)rpx/) || [])[1];
if (bgDims[0] && heroMin) {
  const expect = Math.round(bgDims[0].h * 750 / bgDims[0].w);
  truthy(Math.abs(Number(heroMin) - expect) <= 2,
    'C7 .p-hero min-height ' + heroMin + 'rpx ≈ 底图折算 ' + expect + 'rpx');
}

/* C8 访客登录入口：不再单开引导卡（Hero 头像位 + 关于区兜底行两处入口）
   删卡片时必须 wxml 与 wxss 一起删干净，否则要么留下没用的样式、要么留下没样式的空壳 */
const plCls = (wxml.match(/\bpl-[a-z]+\b/g) || []).concat(wxss.match(/\.pl-[a-z]+\s*\{/g) || []);
eq(plCls.length, 0, 'C8 旧的独立登录卡已彻底移除' + (plCls.length ? ' → 残留 ' + plCls.join(', ') : ''));

/* C9 两个入口都在位：Hero 头像（onIdTap）+ 关于与数据首行（tapAccount）。
   WXML 的 bindtap 不支持 Mustache 动态事件名，所以头像必须挂静态的 onIdTap 并在 JS 内分支 */
truthy(/bindtap="onIdTap"/.test(wxml), 'C9a Hero 头像挂 onIdTap（静态事件名，动态绑定会失效）');
truthy(/bindtap="tapAccount"/.test(wxml), 'C9b 关于与数据有账号兜底行');
truthy(/class="ico ico-plus ico--ink p-avatar-add-i"/.test(wxml), 'C9c 未登录头像上有加号角标');

/* C10 文案必须是「真做得到」的事：本机存储 + 导出导入换机。
   禁词对应三个未实现的能力（无云端库、无账号体系、无自动迁移） */
const NOCLAIM = ['云备份', '跨设备同步', '换机自动恢复', '微信一键登录'];
const claimed = [];
NOCLAIM.forEach(w => { if (wxml.indexOf(w) >= 0 || js.indexOf(w) >= 0) claimed.push(w); });
eq(claimed.length, 0, 'C10 未实现的云端承诺已从文案移除' + (claimed.length ? ' → 残留 ' + claimed.join(', ') : ''));
truthy(wxml.indexOf('数据只存本机') >= 0, 'C10b 副标题写明「数据只存本机」');

/* C11 处理函数齐备：点击头像/账号行必须有落点，否则点了没反应 */
['onIdTap', 'tapAccount', 'wechatLogin', 'onChooseAvatar'].forEach(fn => {
  truthy(new RegExp('\\b' + fn + '\\s*\\(').test(js), 'C11 ' + fn + '() 已定义');
});
truthy(/if\s*\(this\.data\.loggedIn\)\s*this\.onChooseAvatar\(\);\s*else\s*this\.wechatLogin\(\)/.test(js),
  'C11b onIdTap 按登录态分支（已登录=换头像 / 未登录=登录）');

/* C12 Hero 底图跟主题走：深色不撤图，改用黑底版。
   曾用「深色 display:none + 品牌光晕」兜底，现在有真底图，撤图/加尺寸覆盖都会让主题切换跳版 */
truthy(!/\.page\.theme-dark[^{]*\.p-hero-bg[^{]*\{[^}]*display:\s*none/.test(wxss),
  'C12 深色主题不再隐藏 Hero 底图');
const bgPathsOk = /const\s+BG_LIGHT\s*=\s*'\/static\/my-bg\.jpg'/.test(js)
  && /const\s+BG_DARK\s*=\s*'\/static\/my-bg-dark\.jpg'/.test(js);
truthy(bgPathsOk, 'C12 明暗两版底图路径已定义');
// 切换点必须是两处：onShow（进页/后台回来）+ onToggleTheme（页内原地切主题，不走 onShow）。
// 逐点断言而非计数 —— 计数会把函数定义 `function bgOf(themeCls)` 也算进去。
truthy(/const\s+nextBg\s*=\s*bgOf\(themeCls\)/.test(js) && /patch\.bgUrl\s*=\s*nextBg/.test(js),
  'C12 onShow 内换底图（且仅在 src 真变化时才重置失败旗标）');
truthy(/bgUrl:\s*bgOf\(themeCls\)/.test(js), 'C12 onToggleTheme 内换底图（原地切主题不走 onShow）');

/* C13 「我的训练」首行 = 今日训练计划：三态 + 点按分支 + 空态出口。
   首行一行两用（未完成=开练 / 已完成=复盘），WXML 又不支持 Mustache 动态事件名，
   所以必须挂静态 onTkTap 并在 JS 里按 mode 分支 —— 漏了就是「点了没反应」。 */
truthy(/bindtap="onTkTap"/.test(wxml), 'C13a 首行挂 onTkTap（静态事件名）');
truthy(/train\.mode\s*===\s*'done'/.test(js), 'C13b onTkTap 按 mode 分支（done → 复盘）');
truthy(/bindtap="goPlan"/.test(wxml), 'C13c 空态挂 goPlan');
truthy(/今天还没安排训练/.test(wxml) && /去计划页导入一套开始吧/.test(wxml),
  'C13d 空态文案与首页「今日推荐」一致');
['onTkTap', 'startToday', 'goPlan'].forEach(fn => {
  truthy(new RegExp('\\b' + fn + '\\s*\\(').test(js), 'C13 ' + fn + '() 已定义');
});
// 开始训练前必须过登录门禁（与首页 startPlan / 训练页写操作同一套）
truthy(/startToday\(\)\s*\{[^}]*auth\.requireLogin\(\)/.test(js), 'C13e startToday 过登录门禁');
// 「有没有安排」问 todayPlan，不在本页重写「计划 / 手动」两分支（否则又是第三套口径）
truthy(/todayPlan\.resolveTodayPlan\(\)\.hasPlan/.test(js), 'C13f 是否已安排问 todayPlan，不另写分支');
// 计划页是 tabBar 页 → 只能 switchTab；navigateTo 会静默失败
truthy(/goPlan\(\)\s*\{\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/plan\/plan'/.test(js),
  'C13g goPlan 用 switchTab（tabBar 页 navigateTo 打不开）');
// 完成态的名称/度量复用同一对纯函数，避免两处各写一套命名规则
truthy(/function logTitleOf\(/.test(js) && /function logMetaOf\(/.test(js),
  'C13h 训练命名/度量抽成 logTitleOf / logMetaOf');

/* C14 「联系开发者」= 微信客服会话，只能靠 open-type 唤起，而 open-type **只对 <button> 生效**。
   写成 <view open-type="contact"> 不报错、点了也没反应（跟动态事件名一个坑）。
   背景：隐私政策原先承诺「可通过小程序内反馈渠道联系开发者」，但仓里根本没有这个入口 ——
   承诺了做不到的事，用户照着找只会找不到。这个入口就是补上的那个落点。 */
truthy(/<button[^>]*\bopen-type="contact"/.test(wxml), 'C14a 联系开发者是 <button open-type="contact">（view 挂 open-type 会被吃掉）');
truthy(!/<view[^>]*open-type="contact"/.test(wxml), 'C14b 没有把 open-type 挂在 view 上');
truthy(/联系开发者/.test(wxml), 'C14c 入口文案在位');

/* C15 用 button 当行容器，必须清掉它自带的灰底/圆角/居中/line-height/::after 描边，
   否则这一行比上下三行 <view class="mi"> 高或胖一圈。
   ⚠️ line-height / font-size 必须是 inherit，**不能是 normal**：
   .menu .mi-t 自己不设 line-height，靠从 page（1.5）继承；button 默认是 2.55，
   写 normal 又变成 1.2 —— 两种都会让这一行明显比相邻行高。 */
const miBtn = (wxss.match(/\.menu\s+\.mi-btn\s*\{[^}]*\}/) || [])[0] || '';
truthy(!!miBtn, 'C15 .menu .mi-btn 规则存在');
['margin: 0', 'background-color: transparent', 'border-radius: 0',
  'line-height: inherit', 'font-size: inherit', 'text-align: left'].forEach(d => {
  truthy(miBtn.indexOf(d) >= 0, 'C15 清 button 默认：' + d);
});
truthy(/\.menu\s+\.mi-btn::after\s*\{[^}]*display:\s*none/.test(wxss), 'C15b 干掉 button 的 ::after 描边');

/* C16 隐私政策的「六、联系我们」必须指向**真实存在**的入口（B2）。
   这是跨文件的：文案在 privacy.wxml，落点在 profile.wxml ——
   只改一边就成了又一次空承诺，所以只能两边一起核。 */
const privacyWxml = fs.readFileSync(path.join(ROOT, 'pages/privacy/privacy.wxml'), 'utf8');
['小程序内反馈渠道', '意见反馈入口'].forEach(w => {
  truthy(privacyWxml.indexOf(w) < 0, 'C16 privacy.wxml 不再出现无落点的空承诺：' + w);
});
truthy(/联系开发者/.test(privacyWxml), 'C16b privacy.wxml 指向「我的 → 联系开发者」');
truthy(/联系开发者/.test(wxml) && /<button[^>]*open-type="contact"/.test(wxml),
  'C16c 这个指向在 profile.wxml 里真实可点（能唤起客服的那一行）');

/* C17 备案号展示位（合规硬性要求，别被顺手删掉）。
   官方《互联网信息服务备案承诺书》要求上线时在小程序「主体介绍位置（设置-关于两级菜单以内页面
   底部显著位置或三级专用菜单内）」标明备案编号并链接至 beian.miit.gov.cn。
   本页「我的」在两级菜单以内、页脚是常驻区 —— 这个展示位是承诺书条款的落点，不是普通装饰。 */
truthy(/const\s+ICP_NO\s*=/.test(js), 'C17a 备案号是 profile.js 里的常量 ICP_NO（改号只改一处）');
truthy(/icpNo:\s*ICP_NO/.test(js), 'C17b data.icpNo 接常量');
// 号必须由数据渲染，不许硬编码进 wxml（否则每次备案变更都要改模板，且容易漏改）
truthy(/\{\{icpNo\}\}/.test(wxml), 'C17c wxml 用 {{icpNo}} 渲染，未硬编码备案号');
truthy(/wx:if="\{\{icpNo\}\}"/.test(wxml), 'C17d 号为空时不渲染（不留空壳，也不影响现有版式）');
truthy(/class="icp"[^>]*bindtap="copyIcp"|bindtap="copyIcp"/.test(wxml), 'C17e 展示位可点（对应承诺书的「链接至」）');
truthy(/\bcopyIcp\s*\(/.test(js), 'C17f copyIcp() 已定义');
// 「链接至」只能做成复制：web-view 需要业务域名归属校验，工信部域名配不了
truthy(/beian\.miit\.gov\.cn/.test(js), 'C17g 点击后给出工信部查询地址');
// wx.setClipboardData 是隐私接口：拒绝授权时会失败 → 必须有可见出口，否则「点了没反应」
truthy(/setClipboardData\(\{[\s\S]{0,400}?fail:/.test(js), 'C17h 复制失败也有出口（剪贴板被拒时不许静默）');
// 小字铁律：合规展示项读不清等于没展示 → 用 --n-700，不用 --text-weak
const icpRule = (wxss.match(/\.icp\s*\{[^}]*\}/) || [])[0] || '';
truthy(icpRule.indexOf('var(--n-700)') >= 0, 'C17i 备案号字色用 --n-700（小字铁律：--text-weak 压浅底仅 ≈2.3:1）');

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

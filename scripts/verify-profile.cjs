// scripts/verify-profile.cjs —— 「我的」页 + 连续天数口径 回归守卫（node 直跑，无 wx 环境）
//
// 覆盖三块：
//   [A] dateRange.streakFromDates 边界（首页「连续打卡」与本页「连续训练天数」共用的唯一回溯实现）
//   [B] profile.js refresh() 派生数据（训练天数/连续天数/总次数/本月/本周/时长/容量 + 最近一场卡片）
//   [C] 静态闭环：wxml 类名 ↔ wxss/icons、行内 style 禁 Mustache、wxml 字段 ↔ js data
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
function mkLog(date, cat, planId) {
  const sets = [];
  for (let i = 0; i < 3; i++) sets.push({ reps: 10, weight: 40, trainSec: 60, restSec: 60, rpe: 7 });
  return {
    date, planId: planId || '', programId: '',
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

// 我的训练：最近一场 = 今天那条；单一分类 → 用分类名
eq(d.train.show, true, 'B23 有日志 → 显示最近一场');
eq(d.train.isToday, true, 'B24 最近一场是今天 → 打「今日」标');
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
// 同日多条：取最后写入的那条（周一追加的「背」应顶掉今天的「胸」）
if (wr.monStr === TODAY) eq(ctx.data.train.title, '背', 'B9b 同日多条取最后写入的一条');

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
eq(ctx.data.totals.streak, 0, 'B28 无日志 → 连续天数 0');
eq(ctx.data.totals.vol, '0', 'B29 无日志 → 容量 0');
eq(ctx.data.health.weight, '69.8', 'B30 无日志但有体重 → 体重仍可取到');

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
wxml.replace(/class="([^"]*)"/g, (_, v) => {
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

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

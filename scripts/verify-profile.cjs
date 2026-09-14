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

// C6 亮绿实底上的字形：--primary 不随主题变化，.ico--ink 在 dark 下会翻白 → 必须显式拉回
const chipUse = /\.page\.theme-dark\s+\.p-chip\s+\.ico--ink/.test(wxss) && /\.page\.theme-dark\s+\.tk-go\s+\.ico--ink/.test(wxss);
truthy(chipUse, 'C6 亮绿底上的图标在深色下有墨色拉回');

// C7 背景图随包发布且体积可控（主包 2MB 上限，原 863KB PNG 已裁切转 JPG）
const bg = path.join(ROOT, 'static/my-bg.jpg');
truthy(fs.existsSync(bg), 'C7 static/my-bg.jpg 存在');
if (fs.existsSync(bg)) {
  const kb = Math.round(fs.statSync(bg).size / 1024);
  truthy(kb < 120, 'C7 背景图 ' + kb + 'KB < 120KB');
}

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

// scripts/verify-today-plan.cjs —— 「今日训练计划」口径守卫
//
// 覆盖三件事：
//   [A] utils/todayPlan.js 的解析与时长口径（三分支 + 边界）
//   [B] 单一真源：首页与「我的」页都必须走 todayPlan，不得各自内联一套
//   [C] 红线：tabBar 页只能 switchTab（navigateTo / redirectTo 打不开它，会静默失败）
//
// 用法：node scripts/verify-today-plan.cjs
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok() { pass++; }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }
function eq(actual, expect, label) {
  if (actual === expect) ok();
  else bad(label + '：期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual));
}
function truthy(v, label) { if (v) ok(); else bad(label); }

/* ---------- 最小运行环境：store 只依赖 getApp().globalData 与 wx Storage ---------- */
const GD = {
  userInfo: { loggedIn: true, nickname: '阿门', avatar: '' },
  profile: {},
  selectedActions: [],
  trainingPlans: [],
  activePlanId: '',
  weightRecords: [], trainingLogs: [], meals: [], favorites: [], customActions: [],
  reminderOn: false, keyActionPicks: []
};
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showModal: () => {}, showToast: () => {}
};

const todayPlan = require(path.join(ROOT, 'utils/todayPlan.js'));

/* ══════════════ [A] resolveTodayPlan ══════════════ */
console.log('[A] utils/todayPlan.resolveTodayPlan');

// A1 空态：既无计划也无手动已选
GD.activePlanId = ''; GD.trainingPlans = []; GD.selectedActions = [];
let r = todayPlan.resolveTodayPlan();
eq(r.hasPlan, false, 'A1 无计划无已选 → hasPlan=false');
eq(r.source, 'none', 'A2 source=none');
eq(r.title, '今天还没安排训练', 'A3 空态标题（与首页同文案）');
eq(r.sub, '去计划页导入一套开始吧', 'A4 空态副标题');

// A5 模板计划：标题只留训练日，方案名下沉副标题
GD.trainingPlans = [{
  id: 'P1', programId: 'prog1', dayIndex: 1, daysPerWeek: 3,
  name: '力量·基础五大项 · B 日 · 髋铰链 + 上肢拉',
  actions: [{ actionId: 'a1', name: '硬拉', setsCount: 4 }, { actionId: 'a2', name: '划船', setsCount: 3 }]
}];
GD.activePlanId = 'P1';
r = todayPlan.resolveTodayPlan();
eq(r.hasPlan, true, 'A5 有计划 → hasPlan=true');
eq(r.source, 'plan', 'A6 source=plan');
eq(r.isTemplate, true, 'A7 带 programId → 模板计划');
eq(r.title, 'B 日 · 髋铰链 + 上肢拉', 'A8 模板计划标题 = dayFullName');
eq(r.sub, '力量·基础五大项 · 2 个动作 · 约 11 分钟', 'A9 副标题 = 方案名 · metric');
eq(r.metric, '2 个动作 · 约 11 分钟', 'A10 metric 不含方案名（窄卡片位用）');
eq(r.count, 2, 'A11 动作数');
eq(r.minutes, 11, 'A12 时长 = 7 组 × 1.5 = 10.5 → 11（四舍五入）');
eq(r.planName.indexOf('力量·基础五大项'), 0, 'A13 planName 保留计划原名');

// A14 时长下限 10 分钟：组数很少时不许出现「约 3 分钟」这种荒唐估算
GD.trainingPlans = [{ id: 'P1', programId: 'prog1', name: '力量·基础五大项 · A 日 · 下肢推', actions: [{ actionId: 'a1', name: '深蹲', setsCount: 1 }] }];
r = todayPlan.resolveTodayPlan();
eq(r.minutes, 10, 'A14 1 组 × 1.5 = 1.5 → 兜底 10 分钟');

// A15 计划有动作字段但为空数组：仍算「有安排」（沿用首页既有行为，不擅自改成空态）
GD.trainingPlans = [{ id: 'P1', programId: 'prog1', name: '力量·基础五大项 · A 日 · 下肢推', actions: [] }];
r = todayPlan.resolveTodayPlan();
eq(r.hasPlan, true, 'A15 计划存在即算有安排（即使动作数组为空）');
eq(r.count, 0, 'A16 动作数 0');
eq(r.minutes, 10, 'A17 0 组 → 兜底 10 分钟');

// A18 非模板计划：标题直接用计划名
GD.trainingPlans = [{ id: 'P2', name: '我的推日', actions: [{ actionId: 'a1', name: '卧推', setsCount: 4 }] }];
GD.activePlanId = 'P2';
r = todayPlan.resolveTodayPlan();
eq(r.isTemplate, false, 'A18 无 programId → 非模板');
eq(r.title, '我的推日', 'A19 非模板标题取计划名');
eq(r.sub, r.metric, 'A20 非模板副标题 = metric（无方案名可下沉）');

// A21 计划优先于手动已选
GD.selectedActions = [{ id: 'm1', name: '卷腹', sets: [{}, {}] }];
r = todayPlan.resolveTodayPlan();
eq(r.source, 'plan', 'A21 计划与手动已选同时存在 → 计划优先');

// A22 手动已选兜底：组数优先按 sets 长度，无 sets 退回 setsCount
GD.activePlanId = ''; GD.trainingPlans = [];
GD.selectedActions = [
  { id: 'm1', name: '卷腹', sets: [{}, {}] },
  { id: 'm2', name: '平板支撑' },
  { id: 'm3', name: '波比跳', setsCount: 5 }
];
r = todayPlan.resolveTodayPlan();
eq(r.source, 'manual', 'A22 无计划 → 落手动已选兜底');
eq(r.title, '今日训练', 'A23 手动已选标题固定为「今日训练」');
eq(r.minutes, 11, 'A24 组数 = sets 长度(2) + 无 sets(0) + setsCount(5) = 7 → 11 分钟（两个字段都读到）');

// A25 口径常量导出（改系数只改 util 这一处）
eq(todayPlan.MIN_PER_SET, 1.5, 'A25 MIN_PER_SET 导出');
eq(todayPlan.MIN_MINUTES, 10, 'A26 MIN_MINUTES 导出');

/* ══════════════ [B] 单一真源 ══════════════ */
console.log('[B] 单一真源（首页与我的页共用一份口径）');
const homeJs = fs.readFileSync(path.join(ROOT, 'pages/home/home.js'), 'utf8');
const profileJs = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.js'), 'utf8');
const REQ = /require\('\.\.\/\.\.\/utils\/todayPlan\.js'\)/;
truthy(REQ.test(homeJs), 'B1 首页 require todayPlan');
truthy(REQ.test(profileJs), 'B2 我的页 require todayPlan');
truthy(/todayPlan\.resolveTodayPlan\(\)/.test(homeJs), 'B3 首页调用 resolveTodayPlan');
truthy(/todayPlan\.resolveTodayPlan\(\)/.test(profileJs), 'B4 我的页调用 resolveTodayPlan');
// 首页不得再内联计划命名/时长口径（那是第三套口径的起点）
truthy(homeJs.indexOf('planRotation') < 0, 'B5 首页不再自行解析计划名（planRotation 已移除）');
truthy(homeJs.indexOf('个动作 · 约') < 0, 'B6 首页不再内联拼「N 个动作 · 约 M 分钟」');
// 口径常量只应出现在 util 里
truthy(/MIN_PER_SET\s*=\s*1\.5/.test(fs.readFileSync(path.join(ROOT, 'utils/todayPlan.js'), 'utf8')),
  'B7 系数 1.5 只在 util 里定义一次');

/* ══════════════ [C] tabBar 页只能 switchTab ══════════════ */
console.log('[C] tabBar 页跳转红线');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const TAB_PATHS = ((appJson.tabBar || {}).list || []).map(t => '/' + t.pagePath);
truthy(TAB_PATHS.length >= 5, 'C1 读到 tabBar 页清单（' + TAB_PATHS.length + ' 个）');

const offenders = [];
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!/\.js$/.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
      // 只看字面量 url 的写法；变量拼出的 url 这里管不了
      const m = line.match(/wx\.(navigateTo|redirectTo)\(\s*\{\s*url:\s*'([^'?]+)/);
      if (m && TAB_PATHS.indexOf(m[2]) >= 0) {
        offenders.push(path.relative(ROOT, p).replace(/\\/g, '/') + ':' + (i + 1) + ' → ' + m[1] + ' ' + m[2]);
      }
    });
  }
}
scan(path.join(ROOT, 'pages'));
scan(path.join(ROOT, 'components'));
scan(path.join(ROOT, 'utils'));
eq(offenders.length, 0, 'C2 无 navigateTo/redirectTo 指向 tabBar 页' + (offenders.length ? ' → ' + offenders.join(' | ') : ''));

console.log('\npass=' + pass + '  fail=' + fail);
process.exit(fail ? 1 : 0);

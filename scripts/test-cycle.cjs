// Dev harness: 验证 Phase 2 周期规划全链路
// 1) cycle 页导入周期 → store.addPlan 带 cycle + cycleStartedAt，setActive，selectedActions 填充
// 2) review 周模式：hasCycle=true，cycleLabel 显示阶段，week.cycleRx/cycleActual 给出实际 vs 处方
const path = require('path');

const GD = {
  userInfo: { loggedIn: true, nickname: '测试' },
  profile: { fitnessDays: 0, goal: '增肌' },
  trainingLogs: [],
  trainingPlans: [],
  activePlanId: '',
  customActions: [],
  favorites: [],
  selectedActions: [],
  restTimer: 90
};
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  switchTab: () => {}, navigateTo: () => {}, navigateBack: () => {},
  showToast: () => {}, showModal: () => {},
  createInnerAudioContext: () => ({ stop() {}, play() {}, destroy() {} }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  vibrateShort: () => {}
};
global.setTimeout = () => {};

function setPath(obj, key, value) {
  const tokens = key.replace(/\[/g, '.').replace(/\]/g, '').split('.');
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const next = tokens[i + 1];
    if (cur[tokens[i]] == null) cur[tokens[i]] = /^\d+$/.test(next) ? [] : {};
    cur = cur[tokens[i]];
  }
  cur[tokens[tokens.length - 1]] = value;
}
let PAGE = null;
global.Page = function (opts) {
  opts.setData = function (obj, cb) {
    Object.keys(obj).forEach(k => setPath(this.data, k, obj[k]));
    if (cb) cb();
  };
  PAGE = opts;
};

let fail = 0;
function assert(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; }

// —— 1) 导入周期 ——
console.log('\n[1] cycle 页导入周期');
require(path.resolve(__dirname, '../pages/cycle/cycle.js'));
PAGE.onLoad();
assert(PAGE.data.cycles.length >= 2, '周期模板 ≥ 2 套（' + PAGE.data.cycles.length + '）');
// 取「力量·8周进阶」导入
const target = PAGE.data.cycles.find(c => c.id === 'cycle-strength-8w');
assert(!!target, '找到 cycle-strength-8w 模板');
PAGE.importCycle({ currentTarget: { dataset: { id: 'cycle-strength-8w' } } });
const plan = GD.trainingPlans.find(p => p.name === '力量·8周进阶');
assert(!!plan, '已创建带 cycle 的计划');
assert(plan && plan.cycle && plan.cycle.phases && plan.cycle.phases.length === 3, '计划带 3 阶段 cycle');
assert(plan && plan.cycle.chart && plan.cycle.chart.rpe.length === 8, 'cycle.chart.rpe 长度=8 周');
assert(plan && plan.cycleStartedAt && /^\d{4}-\d{2}-\d{2}$/.test(plan.cycleStartedAt), '记录 cycleStartedAt');
assert(GD.activePlanId === plan.id, '已设为当前计划');
assert(GD.selectedActions.length > 0, '已注入今日训练（selectedActions 已填充，' + GD.selectedActions.length + ' 个动作）');

// —— 2) review 周模式 cycle 联动 ——
console.log('\n[2] review 周模式读取 cycle 处方');
const d0 = new Date(); const p2 = n => n < 10 ? '0' + n : '' + n;
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const today = ymd(d0);
const twoDaysAgo = ymd(new Date(d0.getTime() - 2 * 86400000));
// 构造本周 2 场训练（含 RPE ≈ 处方），让 cycle 联动有「实际」数据，并触发 weekly 模式
function mkLog(sid, date) {
  return { sid, date, createdAt: 1, actions: [
    { id: '0043', nameZh: '杠铃深蹲', sets: 5, setsDetail: [
      { reps: 5, weight: 100, rpe: 8 }, { reps: 5, weight: 100, rpe: 8 }, { reps: 5, weight: 100, rpe: 8 },
      { reps: 5, weight: 100, rpe: 8 }, { reps: 5, weight: 100, rpe: 8 } ] },
    { id: '0025', nameZh: '杠铃卧推', sets: 5, setsDetail: [
      { reps: 5, weight: 60, rpe: 8 }, { reps: 5, weight: 60, rpe: 8 }, { reps: 5, weight: 60, rpe: 8 },
      { reps: 5, weight: 60, rpe: 8 }, { reps: 5, weight: 60, rpe: 8 } ] }
  ] };
}
GD.trainingLogs = [mkLog('t1', twoDaysAgo), mkLog('t2', today)];
require(path.resolve(__dirname, '../pages/review/review.js'));
PAGE.onLoad();
assert(PAGE.data.hasCycle === true, 'hasCycle = true');
assert(PAGE.data.mode === 'weekly', '进入 weekly 模式（' + PAGE.data.mode + '）');
assert(PAGE.data.cycleLabel && PAGE.data.cycleLabel.length > 0, 'cycleLabel 显示阶段：' + PAGE.data.cycleLabel);
const rx = PAGE.data.week.cycleRx;
const act = PAGE.data.week.cycleActual;
assert(!!rx, 'week.cycleRx 存在');
assert(!!act, 'week.cycleActual 存在');
assert(rx.weekIdx === 1, '当前为第 1 周（weekIdx=' + (rx && rx.weekIdx) + '）');
assert(rx.rpe === 7.5, '第1周处方 RPE=7.5（实际 ' + (rx && rx.rpe) + '）');
assert(rx.sets === 16, '第1周处方组数=16（实际 ' + (rx && rx.sets) + '）');
assert(act.rpe && Math.abs(act.rpe - 8) < 0.01, '实际本周 RPE≈8（' + (act && act.rpe) + '）');
assert(act.sets === 20, '实际本周组数=20（' + (act && act.sets) + '）');
assert(act.rpeMatch === 'match', 'RPE 实际(8) 与处方(7.5) 差 0.5 内 → match（' + (act && act.rpeMatch) + '）');
assert(act.setsMatch === 'ok', '组数实际(20) ≥ 处方(16×85%) → ok（' + (act && act.setsMatch) + '）');

console.log('\n' + (fail ? ('✗ 失败 ' + fail + ' 项') : '✅ 周期规划全链路通过：导入→激活→复盘处方对比'));
process.exit(fail ? 1 : 0);

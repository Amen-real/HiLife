// Dev harness: 验证「训练中页 RPE 录入 → 保存 → 复盘读取」全链路
// 1) selectedActions 注入（含 rpe 字段）→ onLoad → presetSets 保留 rpe
// 2) stepRpe 步进写入 set.rpe
// 3) saveWorkout → store.trainingLogs 的 setsDetail.rpe 为 Number
// 4) review 周模式能读取该 rpe 算逐周均值
const path = require('path');

// —— 全局 mock（含 wx 最小实现）——
const GD = {
  userInfo: { loggedIn: true, nickname: '测试' },
  profile: { fitnessDays: 0, goal: '增肌' },
  trainingLogs: [],
  trainingPlans: [],
  activePlanId: '',
  customActions: [],
  favorites: [],
  selectedActions: [
    // 第 1 个动作：手动带 rpe（向后兼容，presetSets 应保留）
    { id: '0025', name: 'bench', nameZh: '杠铃卧推', category: '胸',
      sets: [{ reps: 8, weight: 60, rpe: 7 }, { reps: 8, weight: 60 }], part: '胸', equip: '' },
    // 第 2 个动作：计划式（setsCount + reps + weight），rpe 为空
    { id: '0030', name: 'squat', nameZh: '深蹲', category: '腿',
      setsCount: 3, reps: '5', weight: '100', part: '腿', equip: '' }
  ],
  restTimer: 90
};
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  switchTab: () => {}, navigateBack: () => {}, showToast: () => {}, showModal: () => {},
  createInnerAudioContext: () => ({ stop() {}, play() {}, destroy() {} }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
  vibrateShort: () => {}
};
// 跳过 saveWorkout 末尾的 setTimeout(navigateBack)，避免进程挂起
global.setTimeout = () => {};

// —— 载入被测页 ——
// setData 需支持微信的路径式键（'actions[0].sets[0].rpe'），否则 stepRpe 的更新读不到
function setPath(obj, key, value) {
  const tokens = key.replace(/\[/g, '.').replace(/\]/g, '').split('.');
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (cur[t] == null) cur[t] = /^\d+$/.test(next) ? [] : {};
    cur = cur[t];
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
require(path.resolve(__dirname, '../pages/workout/workout.js'));

let fail = 0;
function assert(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fail++;
}

// —— 1) onLoad 后 presetSets 应保留 rpe ——
PAGE.onLoad();
const a0 = PAGE.data.actions[0];
const a1 = PAGE.data.actions[1];
console.log('\n[1] onLoad → presetSets 保留 rpe');
assert(a0.sets[0].rpe === '7', '已记录 rpe 被保留 (7)');
assert(a0.sets[1].rpe === '', '未记录 rpe 为空串');
assert(a1.sets.length === 3 && a1.sets.every(s => s.rpe === ''), '计划式动作默认 3 组、rpe 均为空');

// —— 2) stepRpe 步进 ——
console.log('\n[2] stepRpe 步进写入');
PAGE.stepRpe({ currentTarget: { dataset: { ai: 0, si: 0, d: 1 } } }); // 7+1=8
PAGE.stepRpe({ currentTarget: { dataset: { ai: 0, si: 1, d: 0 } } }); // 空 → 7
PAGE.stepRpe({ currentTarget: { dataset: { ai: 0, si: 1, d: 1 } } }); // 7+1=8
PAGE.stepRpe({ currentTarget: { dataset: { ai: 1, si: 0, d: 1 } } }); // 空 → 7+1=8
PAGE.stepRpe({ currentTarget: { dataset: { ai: 1, si: 5, d: 1 } } }); // 越界 si → 无副作用
assert(PAGE.data.actions[0].sets[0].rpe === '8', 'set0 rpe 步进到 8');
assert(PAGE.data.actions[0].sets[1].rpe === '8', 'set1 从 7 步进到 8');
assert(PAGE.data.actions[1].sets[0].rpe === '8', '深蹲 set0 从 7 步进到 8');
// 越界 set 不受影响
assert(PAGE.data.actions[1].sets.length === 3, '越界 si 未新增/破坏组');
// 上限钳制
PAGE.stepRpe({ currentTarget: { dataset: { ai: 0, si: 0, d: 99 } } });
assert(PAGE.data.actions[0].sets[0].rpe === '10', 'rpe 上限钳制为 10');
// 下限钳制
PAGE.stepRpe({ currentTarget: { dataset: { ai: 0, si: 0, d: -99 } } });
assert(PAGE.data.actions[0].sets[0].rpe === '1', 'rpe 下限钳制为 1');

// —— 3) saveWorkout → trainingLogs 写入 Number(rpe) ——
console.log('\n[3] saveWorkout 落盘为 Number');
PAGE.saveWorkout(PAGE.data.actions);
const log = GD.trainingLogs[0];
assert(!!log, '已生成 trainingLog');
const la0 = log.actions[0];
const la1 = log.actions[1];
assert(la0.setsDetail[0].rpe === 1, 'set0 rpe 落盘为 Number 1');
assert(la0.setsDetail[1].rpe === 8, 'set1 rpe 落盘为 Number 8');
assert(la0.setsDetail[0].weight === 60 && la0.setsDetail[0].reps === 8, 'weight/reps 同步写入');
assert(la1.setsDetail[0].rpe === 8, '深蹲 set0 rpe 落盘为 Number 8');
assert(la1.setsDetail[1].rpe === '', '深蹲 set1 未记录 rpe 落盘为空串');

// —— 4) review 周模式读取该 rpe ——
console.log('\n[4] review 周模式读取 rpe（逐周均值）');
// 用 2 场同结构训练（不同日期/sid）触发 weekly 模式并构建 week.rpe
const log2 = JSON.parse(JSON.stringify(log));
log2.sid = 't_copy';
log2.date = '2026-08-15';
GD.trainingLogs = [log, log2];
GD.trainingPlans = [];
GD.activePlanId = '';
require(path.resolve(__dirname, '../pages/review/review.js')); // 重新 require 会覆盖 PAGE 捕获
PAGE.onLoad();
assert(PAGE.data.mode === 'weekly', '2 场训练 → weekly 模式（实际 ' + PAGE.data.mode + '）');
const wkRpe = PAGE.data.week ? PAGE.data.week.rpe : [];
const hasVal = wkRpe.some(r => r.val > 0);
assert(hasVal, '周模式 rpe 序列含有效均值（' + JSON.stringify(wkRpe.map(r => r.val)) + '）');
// review 也能正确统计组数（修复 a.sets 为数字导致 .map 崩溃）
assert(PAGE.data.logsCount === 2, 'review 正确读到 2 场记录');

console.log('\n' + (fail ? ('✗ 失败 ' + fail + ' 项') : '✅ RPE 全链路通过：录入→保存→复盘读取'));
process.exit(fail ? 1 : 0);

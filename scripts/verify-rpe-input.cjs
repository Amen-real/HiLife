/**
 * verify-rpe-input.cjs —— 训练中页「吃力程度（RPE）」录入 → 落盘 → 统计消费 的契约守卫
 *
 * 为什么必须有它：RPE 是整个训练分析引擎的输入（趋势、verdict、下次建议全靠它），
 * 但全仓没有第二个脚本覆盖 `pickEffort` 这条录入路径 —— 而 RPE 的 UI 从步进器改成
 * 「4 档胶囊（很轻松/有点累/很累/快力竭 = 4/6/8/10）」之后，旧的 test-rpe-flow.cjs
 * 还停在 `stepRpe`，直接抛 TypeError 而没人发现（脚本自身成了盲区）。
 *
 * 本脚本替换并取代了 test-rpe-flow.cjs / test-cycle.cjs / test-review.cjs 三个旧 harness：
 *   · test-rpe-flow  —— 依赖已删除的 stepRpe
 *   · test-cycle / test-review —— review 页已重构成薄壳（逻辑搬进 training-review 组件），
 *     它们还在调 PAGE.onLoad() 读旧报告结构；该覆盖现由 verify-training-review.cjs 承担
 *
 * 守住 4 段契约：
 *   [A] onLoad 向后兼容：已记录的 rpe 保留、未记录为空串、计划式动作按 setsCount 展开
 *   [B] pickEffort：点胶囊写入、再点同档取消（toggle）、越界 si 无副作用
 *   [C] saveWorkout 落盘：rpe 必须是 Number 或空串（不能落成 NaN / null / 字符串残留）
 *   [D] 统计侧能消费：utils/trainingStats.js 的 avgRpeOfActions 对落盘结构算得出正确均值
 *       （防「录入看着有值、统计读不到」这类断链 —— 本仓发生过同类事故）
 *
 * 用法： node scripts/verify-rpe-input.cjs
 * 退出码：0 = 通过；1 = 失败
 */
const path = require('path');

// ---------- 全局 mock ----------
const GD = {
  userInfo: { loggedIn: true, nickname: '测试' },
  profile: { fitnessDays: 0, goal: '增肌' },
  trainingLogs: [],
  trainingPlans: [],
  activePlanId: '',
  customActions: [],
  favorites: [],
  selectedActions: [
    // 第 1 个动作：手动带 rpe（向后兼容，onLoad 应保留）
    { id: '0025', name: 'bench', nameZh: '杠铃卧推', category: '胸',
      sets: [{ reps: 8, weight: 60, rpe: 7 }, { reps: 8, weight: 60 }], part: '胸', equip: '' },
    // 第 2 个动作：计划式（setsCount + reps + weight），rpe 全空
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
  vibrateShort: () => {}, setKeepScreenOn: () => {}
};
global.setTimeout = () => {};   // 跳过 saveWorkout 末尾的 navigateBack，避免进程挂起

// setData 需支持微信的路径式键（'actions[0].sets[0].rpe'），否则 pickEffort 的更新读不到
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
let PAGE = null;
global.Page = function (opts) {
  opts.setData = function (obj, cb) {
    Object.keys(obj).forEach(k => setPath(this.data, k, obj[k]));
    if (cb) cb();
  };
  PAGE = opts;
};
require(path.resolve(__dirname, '../pages/workout/workout.js'));

const stats = require(path.resolve(__dirname, '../utils/trainingStats.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

// ---------- [A] onLoad 向后兼容 ----------
console.log('[A] onLoad → 已记录的吃力程度被保留');
PAGE.onLoad();
const a0 = PAGE.data.actions[0];
const a1 = PAGE.data.actions[1];
assert(a0.sets[0].rpe === '7', '已记录值保留（7）');
assert(a0.sets[1].rpe === '', '未记录值为空串（不是 undefined/null）');
assert(a1.sets.length === 3 && a1.sets.every(s => s.rpe === ''), '计划式动作按 setsCount 展开 3 组、值均为空串');

// ---------- [B] pickEffort：4 档胶囊 ----------
console.log('\n[B] pickEffort → 点档写入 / 再点取消');
const tap = (ai, si, v) => PAGE.pickEffort({ currentTarget: { dataset: { ai, si, v } } });
tap(0, 0, 8);
assert(PAGE.data.actions[0].sets[0].rpe === '8', '点「很累(8)」写入 8');
tap(0, 0, 8);
assert(PAGE.data.actions[0].sets[0].rpe === '', '再点同档取消（toggle 为取消）');
tap(0, 1, 4);
assert(PAGE.data.actions[0].sets[1].rpe === '4', '点「很轻松(4)」写入 4');
tap(0, 1, 10);
assert(PAGE.data.actions[0].sets[1].rpe === '10', '改点「快力竭(10)」覆盖为 10');
assert(PAGE.data.actions[0].sets[1].rpe !== 10, '落库前仍是字符串（与空串同类型，便于落盘判空）');
const before = JSON.stringify(PAGE.data.actions[1]);
tap(1, 9, 8);
assert(JSON.stringify(PAGE.data.actions[1]) === before, '越界 si 无副作用（不新增组、不抛错）');
tap(9, 0, 8);
assert(PAGE.data.actions[9] === undefined, '越界 ai 无副作用');

// ---------- [C] saveWorkout 落盘契约 ----------
console.log('\n[C] saveWorkout → rpe 落盘为 Number 或空串');
PAGE.saveWorkout(PAGE.data.actions);
const log = GD.trainingLogs[0];
assert(!!log, '已生成 trainingLog');
const la0 = log.actions[0];
assert(la0.setsDetail[0].rpe === '' || typeof la0.setsDetail[0].rpe === 'number', 'set0 的 rpe 是 Number 或空串');
assert(la0.setsDetail[1].rpe === 10, 'set1 的 rpe 落盘为 Number 10（不是 "10"）');
assert(typeof la0.setsDetail[1].rpe === 'number', '且类型确实是 number');
assert(la0.setsDetail[1].weight === 60 && la0.setsDetail[1].reps === 8, 'weight/reps 同步写入');
assert(log.actions[1].setsDetail.every(s => s.rpe === '' || typeof s.rpe === 'number'), '计划式动作未记录处落盘为空串');

// ---------- [D] 统计侧可消费 ----------
console.log('\n[D] trainingStats 能消费落盘结构');
const r = stats.rpeSumOfActions(log.actions);
assert(r.count === 1 && r.sum === 10, 'rpeSumOfActions 累加到 sum=10 / count=1（实际 ' + r.sum + '/' + r.count + '）');
const avg = stats.avgRpeOfActions(log.actions);
assert(avg.avg === 10 && avg.count === 1, 'avgRpeOfActions 均值为 10');
assert(stats.avgRpeOfActions([{ setsDetail: [{ reps: 8, rpe: '' }] }]).count === 0, '空串 rpe 不计入统计（不污染均值）');
assert(stats.avgRpeOfActions([{ setsDetail: [{ reps: 8, rpe: 99 }] }]).count === 0, '越界 rpe（>10）不计入统计');

console.log('\n' + (fail ? '✗ verify-rpe-input: ' + pass + ' passed, ' + fail + ' failed'
                        : '✓ verify-rpe-input: ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);

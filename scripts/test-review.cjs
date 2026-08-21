// Dev harness: mock 小程序运行环境，真实跑通 review 页四种模式的计算逻辑，验证无异常且输出合理
const path = require('path');

// —— 全局 mock ——
const GD = {
  userInfo: { loggedIn: true, nickname: '测试' },
  profile: { fitnessDays: 5, goal: '增肌' },
  trainingLogs: [],
  trainingPlans: [],
  activePlanId: '',
  customActions: [],
  favorites: []
};
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  switchTab: () => {}
};

// Page 捕获 + 注入 setData（含回调）
let PAGE = null;
global.Page = function (opts) {
  opts.setData = function (obj, cb) { Object.assign(this.data, obj); if (cb) cb(); };
  PAGE = opts;
};

// —— 载入被测页 ——
require(path.resolve(__dirname, '../pages/review/review.js'));

function run(label, logs, activePlanId, plan) {
  GD.trainingLogs = logs;
  GD.trainingPlans = plan ? [plan] : [];
  GD.activePlanId = activePlanId || '';
  PAGE.onLoad();
  console.log(`\n=== ${label} ===`);
  console.log('mode=', PAGE.data.mode, '| logsCount=', PAGE.data.logsCount, '| hasCycle=', PAGE.data.hasCycle);
  if (PAGE.data.mode === 'weekly' && PAGE.data.week) {
    console.log('week.pct=', PAGE.data.week.pct, 'decision=', PAGE.data.week.decision, '| strength=', PAGE.data.week.strength.map(s => s.nameZh + s.delta).join(','));
  }
  if (PAGE.data.mode === 'rolling' && PAGE.data.roll) {
    console.log('roll=', PAGE.data.roll.nameZh, '| suggest=', PAGE.data.roll.suggest);
  }
  if (PAGE.data.mode === 'single' && PAGE.data.session) {
    console.log('session.verdict=', PAGE.data.session.verdict, '| actions=', PAGE.data.session.actions.map(a => a.nameZh + ':' + a.badge).join(','));
  }
  if (PAGE.data.mode === 'baseline' && PAGE.data.baseline) {
    console.log('baseline.status=', PAGE.data.baseline.status);
  }
  return PAGE;
}

// —— 样本数据：3 次训练，卧推练了 3 次（滚动可比），含 RPE ——
const SAMPLE = [
  { sid: 't1', date: '2026-08-10', createdAt: 1, actions: [
    { id: '0025', nameZh: '杠铃卧推', part: '胸', sets: [{ reps: 8, weight: 60, rpe: 7 }, { reps: 8, weight: 60, rpe: 8 }] },
    { id: '0030', nameZh: '深蹲', sets: [{ reps: 5, weight: 100, rpe: 8 }] }
  ] },
  { sid: 't2', date: '2026-08-12', createdAt: 2, actions: [
    { id: '0025', nameZh: '杠铃卧推', sets: [{ reps: 8, weight: 62, rpe: 8 }, { reps: 8, weight: 62, rpe: 9 }] },
    { id: '0031', nameZh: '硬拉', sets: [{ reps: 5, weight: 120, rpe: 9 }] }
  ] },
  { sid: 't3', date: '2026-08-14', createdAt: 3, actions: [
    { id: '0025', nameZh: '杠铃卧推', sets: [{ reps: 8, weight: 65, rpe: 8 }] },
    { id: '0030', nameZh: '深蹲', sets: [{ reps: 5, weight: 105, rpe: 7 }] }
  ] }
];
const PLAN = { id: 'p1', name: '测试计划', actions: [
  { actionId: '0025', nameZh: '杠铃卧推', setsCount: 4, reps: '8', weight: '' },
  { actionId: '0030', nameZh: '深蹲', setsCount: 3, reps: '5', weight: '' }
] };

// 1) 周模式（默认，有激活计划）
run('有记录+激活计划', SAMPLE, 'p1', PLAN);

// 2) 切到单次
PAGE.switchMode({ currentTarget: { dataset: { mode: 'single' } } });
console.log('→ 切单次: verdict=', PAGE.data.session && PAGE.data.session.verdict);

// 3) 切到滚动
PAGE.switchMode({ currentTarget: { dataset: { mode: 'rolling' } } });
console.log('→ 切滚动: rollable=', PAGE.data.rollableActions.map(a => a.nameZh).join(','), '| cur=', PAGE.data.roll && PAGE.data.roll.nameZh);

// 4) 切到基准（手动）
PAGE.switchMode({ currentTarget: { dataset: { mode: 'baseline' } } });
console.log('→ 切基准: status=', PAGE.data.baseline.status);

// 5) 仅 1 次记录 → 默认进基准
run('仅1次记录（自动基准）', [SAMPLE[0]], '', null);

// 6) 0 次记录 → 空态
run('0次记录（空态）', [], '', null);

// 7) 有周期计划 → 周模式展示阶段
const CYCLE_PLAN = { id: 'p2', name: '周期', cycle: { title: '8周力量', phases: [{ label: '积累', start_week: 1, end_week: 3 }, { label: '强度', start_week: 4, end_week: 6 }] }, actions: [] };
run('有周期计划', SAMPLE, 'p2', CYCLE_PLAN);
console.log('cycleLabel=', PAGE.data.cycleLabel);

console.log('\n✅ review 计算逻辑全部跑通，无异常');

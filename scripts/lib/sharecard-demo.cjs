// scripts/lib/sharecard-demo.cjs
// 分享卡预览用的演示数据 —— 两个生成器（HTML 版 / PNG 版）共用，避免两份演示数据各自漂移。
//
// ⚠️ id 必须取自**真实动作库**：此前手编了 '0001'~'0004'，结果正好撞上库里真实存在的
// 「3/4仰卧起坐」「45°侧屈」「空中自行车」（都属核心/abs）—— 预览图上莫名其妙点亮了腹肌，
// 排查半天以为映射写错了，其实是演示数据的问题。演示数据也要「用真 id」，否则会浪费真实排查时间。
const stats = require('../../utils/trainingStats.js');

function s(reps, weight, rpe) { return { reps: reps, weight: weight, trainSec: 42, restSec: 95, rpe: rpe }; }

// id / 名称 / 分类的真实值见 utils/exercises.js
function act(id, nameZh, category, equip, sets) {
  return { id: id, name: nameZh, nameZh: nameZh, category: category, equip: equip, sets: sets.length, setsDetail: sets };
}

const A_BENCH = () => act('0025', '杠铃卧推', '胸部', '杠铃', [s(12, 30, 7), s(12, 30, 8), s(10, 35, 8), s(8, 37.5, 9)]);
const A_SQUAT = () => act('0043', '全程杠铃深蹲', '腿部', '杠铃', [s(10, 60, 8), s(8, 70, 9)]);
const A_ROW = () => act('0027', '杠铃俯身划船', '背部', '杠铃', [s(12, 40, 7), s(10, 45, 8)]);
const A_LAT = () => act('0334', '哑铃侧平举', '肩膀', '哑铃', [s(15, 8, 7), s(12, 10, 8)]);
const A_CURL = () => act('0031', '杠铃弯举', '手臂', '杠铃', [s(12, 20, 7)]);
const A_PUSHUP = () => act('0662', '俯卧撑', '胸部', '自重', [s(20, 0, 6), s(18, 0, 7)]);
const A_PULLUP = () => act('0652', '引体向上', '背部', '自重', [s(8, 0, 8), s(6, 0, 9)]);

function log(date, actions) { return { id: 'L' + date, date: date, actions: actions }; }

// 本场（5 个动作 → 动作行会走「列前 4 个 + 另有 N 个」分支）
const today = log('2026-09-16', [A_BENCH(), A_SQUAT(), A_PUSHUP(), A_ROW(), A_CURL()]);
// 同一天的第二场（给「合并当天」用）
const todayLate = log('2026-09-16', [A_LAT(), A_CURL()]);
// 上一场（组数与重量都合理，让「比上次」落在个位数百分比）
const prev1 = log('2026-09-14', [
  act('0025', '杠铃卧推', '胸部', '杠铃', [s(12, 30, 7), s(12, 30, 7), s(10, 32.5, 8)]),
  act('0043', '全程杠铃深蹲', '腿部', '杠铃', [s(10, 60, 7), s(8, 67.5, 8)])
]);
const prev2 = log('2026-09-12', [A_ROW()]);
const bwOnly = log('2026-09-15', [A_PULLUP(), A_PUSHUP()]);
// 「连续训练」演示：14/15/16 连续三天
const LOGS = [today, bwOnly, prev1, prev2];

// 破纪录用例：卧推 45kg×8（容量 360）> 上次 40kg×8（320）→ 个人纪录条会画出来。
// 为什么必须单独造样本：`today` 的卧推最佳容量与 09-14 场**恰好打平**（405 = 405），
// 打平不算破纪录 —— 这是对的口径，但也意味着预览里永远看不到纪录条。
// 另外 logsDesc 里**不能**混进 `today`：recordBoard 取的是「所有更早场次的最大值」，
// 打平/更高的值在里面会把这次的纪录压掉。
const pbDay = log('2026-09-16', [act('0025', '杠铃卧推', '胸部', '杠铃', [s(8, 45, 9)])]);
const pbPrev = log('2026-09-12', [act('0025', '杠铃卧推', '胸部', '杠铃', [s(8, 40, 7)])]);

// 用例：两个生成器都按这个顺序出图，标题一并带上，便于对照
function cases() {
  return [
    { title: '① 浅色（默认）', args: { log: today, logsDesc: LOGS, idx: 0, opts: { nickname: 'A-men' } } },
    { title: '② 深色样式', args: { log: today, logsDesc: LOGS, idx: 0, opts: { style: 'dark', nickname: 'A-men' } } },
    // 注意「合并当天」的 logsDesc 里**不能重复出现 same date 的 log**：
    // merge 是按 date 扫全表的，重复一条就会被多算一场（演示数据踩过，图上出现「共 3 场」）
    { title: '③ 合并当天（2 场 → 1 张）', args: { log: today, logsDesc: [today, todayLate, bwOnly, prev1, prev2], idx: 0, opts: { merge: true, nickname: 'A-men' } } },
    { title: '④ 隐藏训练内容', args: { log: today, logsDesc: LOGS, idx: 0, opts: { hideContent: true, nickname: 'A-men' } } },
    { title: '⑤ 纯自重场次（训练量位改总次数）', args: { log: bwOnly, logsDesc: [today, bwOnly].concat(LOGS), idx: 1, opts: { nickname: '小明' } } },
    { title: '⑥ 破纪录（个人纪录条）', args: { log: pbDay, logsDesc: [pbDay, pbPrev], idx: 0, opts: { nickname: 'A-men' } } },
    { title: '⑦ 破纪录 + 深色 + 隐藏内容', args: { log: pbDay, logsDesc: [pbDay, pbPrev], idx: 0, opts: { style: 'dark', hideContent: true, nickname: 'A-men' } } }
  ];
}

module.exports = {
  act: act, set: s, log: log, stats: stats,
  today: today, todayLate: todayLate, prev1: prev1, prev2: prev2, bwOnly: bwOnly, LOGS: LOGS,
  pbDay: pbDay, pbPrev: pbPrev,
  cases: cases
};

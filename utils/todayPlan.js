// utils/todayPlan.js —— 「今日训练计划」口径的唯一真源
//
// 谁在用：pages/home 的「今日推荐」卡片 + pages/profile 「我的训练」的首行。
// 两处必须说的是同一件事，所以解析逻辑只留这一份，改口径只改这里。
//
// 与 pages/workout/workout.js 的 resolveWorkoutSource() 的区别（故意不同，勿合并）：
//   · 这里回答「今天该练什么」     → 激活计划优先，手动已选只作兜底；
//   · 那里回答「我接下来练什么」   → 手动已选优先（用户在动作库里现勾的才算数）。
//   两者面向的场景不同：前者是「今天还没开始」，后者是「已经站在训练页上了」。
//
// 依赖方向：store → planRotation（单向）；本文件 → store + planRotation，无环。
// 但注意 verify-*.cjs 需要 stub `getApp()`/`wx` 才能 require 本文件（store 依赖它们）。

const store = require('./store.js');
const planRotation = require('./planRotation.js');

// 时长估算：组数 × 1.5 分钟，下限 10 分钟。
// 这是首页「今日推荐」沿用至今的口径，如今单源在这里 —— 改系数请只改这两个常量。
const MIN_PER_SET = 1.5;
const MIN_MINUTES = 10;

// 计划动作的组数字段是 setsCount（计划里只存计划组数，不含实际训练记录）
function setsOfPlanAction(a) {
  return a ? (Number(a.setsCount) || 0) : 0;
}
// 手动已选动作：优先按实际 sets 数组长度，退回 setsCount
// （训练页勾选后可只调 setsCount，而动作库带出的对象通常有完整 sets）
function setsOfSelected(a) {
  if (!a) return 0;
  if (Array.isArray(a.sets) && a.sets.length) return a.sets.length;
  return Number(a.setsCount) || 0;
}
function minutesFrom(totalSets) {
  return Math.max(MIN_MINUTES, Math.round((Number(totalSets) || 0) * MIN_PER_SET));
}

// 「今日训练计划」。命中顺序：激活计划 → 手动已选 → 空态。
// 返回：
//   hasPlan  是否有安排（false 时 title/sub 就是空态文案，调用方可直接展示）
//   source   'plan' | 'manual' | 'none'
//   isTemplate  是否来自模板方案（决定标题只显示训练日、方案名下沉副标题）
//   title    首行标题（模板计划 → 'B 日 · 髋铰链 + 上肢拉'）
//   sub      副标题（模板计划 → '力量·基础五大项 · 5 个动作 · 约 40 分钟'）
//   metric   不带方案名的度量串（'5 个动作 · 约 40 分钟'，给窄卡片位用）
//   count    动作数
//   minutes  估算分钟
//   planName 计划原始名（非模板/无计划时为空串）
function resolveTodayPlan() {
  const activePlan = store.getActivePlan();
  if (activePlan) {
    const actions = activePlan.actions || [];
    let totalSets = 0;
    actions.forEach(a => { totalSets += setsOfPlanAction(a); });
    const minutes = minutesFrom(totalSets);
    // 模板计划的 name 形如「力量·基础五大项 · B 日 · 髋铰链 + 上肢拉」，
    // 卡片位窄：标题只留训练日，方案名放副标题（与计划页卡片同一命名口径）。
    const isTemplate = !!activePlan.programId;
    const metric = actions.length + ' 个动作 · 约 ' + minutes + ' 分钟';
    return {
      hasPlan: true,
      source: 'plan',
      isTemplate,
      title: isTemplate ? planRotation.dayFullName(activePlan.name) : (activePlan.name || '今日训练'),
      sub: isTemplate ? (planRotation.programLabel(activePlan.name) + ' · ' + metric) : metric,
      metric,
      count: actions.length,
      minutes,
      planName: activePlan.name || ''
    };
  }

  // 兜底：手动已选。selectedActions 跨天会被 app.js 清空，所以不能当主数据源。
  const sel = store.get().selectedActions || [];
  if (sel.length) {
    let totalSets = 0;
    sel.forEach(a => { totalSets += setsOfSelected(a); });
    const minutes = minutesFrom(totalSets);
    const metric = sel.length + ' 个动作 · 约 ' + minutes + ' 分钟';
    return {
      hasPlan: true,
      source: 'manual',
      isTemplate: false,
      title: '今日训练',
      sub: metric,
      metric,
      count: sel.length,
      minutes,
      planName: ''
    };
  }

  return {
    hasPlan: false,
    source: 'none',
    isTemplate: false,
    title: '今天还没安排训练',
    sub: '去计划页导入一套开始吧',
    metric: '',
    count: 0,
    minutes: 0,
    planName: ''
  };
}

module.exports = { resolveTodayPlan, MIN_PER_SET, MIN_MINUTES };

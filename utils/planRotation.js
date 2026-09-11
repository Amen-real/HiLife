// utils/planRotation.js
// 模板训练计划的「轮转 / 分组排序 / 命名」纯逻辑。
//
// 背景：导入一套模板（如「力量·基础五大项」含 A / B / C 三个训练日）后，会一次性生成 3 个
//       独立计划（同一 programId，dayIndex = 0 / 1 / 2），并把「今日计划」指针 activePlanId
//       指向第 0 天（A 日）。此后用户每完成一次训练，指针就自动推进到下一天，A→B→C→A 循环。
//
// 本文件零依赖（不 require store / wx），便于 scripts/verify-*.cjs 直接用 node 跑单测，
// 避免把逻辑散落在 store 与页面里而无法回归。

// 训练日名与模板名在 store 计划里的拼接分隔符（plan.js / presets 保持一致）
const JOIN = ' \u00b7 '; // ' · '

function planGroupKey(plan) {
  if (!plan) return '';
  return plan.programId || plan.id || '';
}

// 同一模板内、dayIndex 紧邻的下一个计划 id。以下情况返回 null（表示不轮转）：
//   · 当前计划不存在 / 没有 programId（手动创建的计划）
//   · 该模板下只有一个训练日
//   · 找不到当前计划在同模板集合中的位置
function nextPlanId(plans, curId) {
  const list = plans || [];
  const cur = list.find(p => p && p.id === curId);
  if (!cur || !cur.programId) return null;
  const sibs = list
    .filter(p => p && p.programId === cur.programId)
    .sort((a, b) => (Number(a.dayIndex) || 0) - (Number(b.dayIndex) || 0));
  if (sibs.length <= 1) return null;
  const idx = sibs.findIndex(p => p.id === cur.id);
  if (idx < 0) return null;
  return sibs[(idx + 1) % sibs.length].id;
}

// 计划卡片排序（返回新数组，不改原数组）：
//   1) 激活计划所在的「模板组」整体置顶（同模板的 A/B/C 相邻，不被其它计划打散）
//   2) 同组内按 dayIndex 升序 → A 日、B 日、C 日
//   3) 其余保持传入顺序（稳定排序，ord 兜底保证跨引擎一致）
function sortPlans(plans, activePlanId) {
  const list = (plans || []).slice();
  const active = list.find(p => p && p.id === activePlanId);
  const activeGroup = planGroupKey(active);
  return list
    .map((p, ord) => ({
      p,
      ord,
      groupKey: planGroupKey(p),
      dayIndex: Number(p && p.dayIndex) || 0
    }))
    .sort((a, b) => {
      const ag = (activeGroup && a.groupKey === activeGroup) ? 0 : 1;
      const bg = (activeGroup && b.groupKey === activeGroup) ? 0 : 1;
      if (ag !== bg) return ag - bg;
      if (a.groupKey === b.groupKey) return a.dayIndex - b.dayIndex;
      return a.ord - b.ord;
    })
    .map(x => x.p);
}

// 去掉模板名前缀，取训练日全名：
//   '力量·基础五大项 · A 日 · 下肢推 + 上肢推' → 'A 日 · 下肢推 + 上肢推'
//   '减脂·全身循环 · 全身循环'                → '全身循环'
//   非模板拼接串（无 ' · '）原样返回
function dayFullName(planName) {
  const name = planName || '';
  const i = name.indexOf(JOIN);
  return i >= 0 ? name.slice(i + JOIN.length) : name;
}

// 训练日短标签（卡片上区分 A/B/C 用）：取训练日全名里 ' · ' 之前的一段
//   'A 日 · 下肢推 + 上肢推' → 'A 日'
//   '全身循环'              → '全身循环'
// 空名兜底 '第 N 天'
function dayLabel(planName, dayIndex) {
  const full = dayFullName(planName);
  const j = full.indexOf(JOIN);
  const short = j >= 0 ? full.slice(0, j) : full;
  if (short) return short;
  return '第 ' + ((Number(dayIndex) || 0) + 1) + ' 天';
}

// 模板名（组名）：'力量·基础五大项 · A 日 · 下肢推 + 上肢推' → '力量·基础五大项'
// 兜底取 ' · ' 之前一段；无分隔符时返回原名
function programLabel(planName) {
  const name = planName || '';
  const i = name.indexOf(JOIN);
  return i >= 0 ? name.slice(0, i) : name;
}

module.exports = { nextPlanId, sortPlans, dayFullName, dayLabel, programLabel, planGroupKey };

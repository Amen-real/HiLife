// utils/planRotation.js
// 训练计划库的「轮转 / 方案分组 / 命名」纯逻辑。
//
// 背景：导入一套模板（如「力量·基础五大项」含 A / B / C 三个训练日）后，会一次性生成 3 个
//       独立计划（同一 programId，dayIndex = 0 / 1 / 2），并把「今日计划」指针 activePlanId
//       指向第 0 天（A 日）。此后用户每完成一次训练，指针就自动推进到下一天，A→B→C→A 循环。
//       计划库允许并存多套方案，故「我的计划」按 groupPlans 分组呈现（一套方案 = 一个组），
//       组由页面加组头（名称 / 训练日数 / 本周进度 / 设为使用中 / 整套移除）。
//
// 本文件零依赖（不 require store / wx），便于 scripts/verify-*.cjs 直接用 node 跑单测，
// 避免把逻辑散落在 store 与页面里而无法回归。

// 训练日名与模板名在 store 计划里的拼接分隔符（plan.js / presets 保持一致）
const JOIN = ' \u00b7 '; // ' · '

// 手动创建的计划没有 programId，统一归入同一个「自定义计划」组
const MANUAL_KEY = '__manual__';

function groupKeyOf(plan) {
  if (!plan) return '';
  return plan.programId || MANUAL_KEY;
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

// 按「方案」分组（返回 [{ key, plans }]，不改入参）：
//   · 组键 = programId，手动计划统一归入 MANUAL_KEY 组（避免每张手动卡各成一组）
//   · 组序 = 激活计划所在组置顶，其余保持组首次出现的顺序（= 计划库导入顺序）
//   · 组内 = 按 dayIndex 升序（A 日 → B 日 → C 日）；手动组 dayIndex 缺失全部视作 0，
//           靠稳定排序保持原有顺序
function groupPlans(plans, activePlanId) {
  const list = (plans || []).slice();
  const active = list.find(p => p && p.id === activePlanId);
  const activeKey = active ? groupKeyOf(active) : '';

  const buckets = [];
  const idxOf = {};
  list.forEach(p => {
    const k = groupKeyOf(p);
    if (idxOf[k] == null) { idxOf[k] = buckets.length; buckets.push({ key: k, plans: [] }); }
    buckets[idxOf[k]].plans.push(p);
  });
  buckets.forEach(b => {
    b.plans.sort((a, c) => (Number(a.dayIndex) || 0) - (Number(c.dayIndex) || 0));
  });
  const ai = buckets.findIndex(b => b.key === activeKey);
  if (ai > 0) {
    const hit = buckets.splice(ai, 1)[0];
    buckets.unshift(hit);
  }
  return buckets;
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

module.exports = { nextPlanId, groupPlans, groupKeyOf, dayFullName, dayLabel, programLabel, MANUAL_KEY };

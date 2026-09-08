// utils/nutrition.js
// 基于身体数据的每日热量与三大营养素推荐（循证降级）
// BMR: Mifflin-St Jeor；TDEE: BMR × 活动系数；按目标给盈余/赤字。
// 降级策略：
//   L2 缺 性别/体重/身高 任一 → 回退「目标预设值」（不硬算）
//   L1 仅缺 年龄 → 用 30 岁估算，标注 estimated-age
//   full 字段齐全 → 标注 full

// 活动量系数表（与 settings 页 ACTIVITY_KEYS 顺序一致）
const ACTIVITY = {
  sedentary: { factor: 1.2,   label: '久坐' },
  light:     { factor: 1.375, label: '轻度' },
  moderate:  { factor: 1.55,  label: '中度' },
  high:      { factor: 1.725, label: '高度' },
  athlete:   { factor: 1.9,   label: '运动员' }
};

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Mifflin-St Jeor：体重 kg / 身高 cm / 年龄 岁
function bmrOf(gender, weight, height, age) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return gender === '女' ? base - 161 : base + 5;
}

function factorOf(level) {
  const a = ACTIVITY[level] || ACTIVITY.moderate;
  return a.factor;
}

function activityLabel(level) {
  const a = ACTIVITY[level] || ACTIVITY.moderate;
  return a.label;
}

// 目标预设值（L2 降级回退）：与旧 intakeTargetOf 一致
function goalDefault(goal) {
  if (goal === '增肌') return 2400;
  if (goal === '减脂' || goal === '减重') return 1800;
  if (goal === '塑形') return 2000;
  return 2100; // 保持
}

// TDEE → 目标热量
//   增肌 ×1.10；减脂/减重 ×0.80 且不低于 BMR；塑形 ×0.90；保持 = TDEE
function adjustForGoal(tdee, bmr, goal) {
  let v;
  if (goal === '增肌') v = tdee * 1.10;
  else if (goal === '减脂' || goal === '减重') v = tdee * 0.80;
  else if (goal === '塑形') v = tdee * 0.90;
  else v = tdee; // 保持
  v = Math.round(v);
  if ((goal === '减脂' || goal === '减重') && v < bmr) v = Math.round(bmr);
  return v;
}

// 推荐每日摄入总热量
// 返回 { kcal, method, missing[], reliable, bmr?, tdee?, factor? }
function recommendIntake(profile) {
  const p = profile || {};
  const gender = p.gender;
  const weight = num(p.currentWeight);
  const height = num(p.height);
  const age = num(p.age);
  const level = p.activityLevel || 'moderate';
  const goal = p.goal || '减重';

  const criticalMissing = [];
  if (!gender) criticalMissing.push('性别');
  if (!weight) criticalMissing.push('体重');
  if (!height) criticalMissing.push('身高');

  // L2：关键字段缺失 → 目标预设值
  if (criticalMissing.length) {
    return {
      kcal: goalDefault(goal),
      method: 'goal-default',
      missing: criticalMissing,
      reliable: false
    };
  }

  // L1：仅年龄缺失 → 用 30 估算
  const ageEstimated = !age;
  const useAge = age || 30;

  const bmr = bmrOf(gender, weight, height, useAge);
  const factor = factorOf(level);
  const tdee = bmr * factor;
  const kcal = adjustForGoal(tdee, bmr, goal);

  return {
    kcal,
    method: ageEstimated ? 'estimated-age' : 'full',
    missing: ageEstimated ? ['年龄'] : [],
    reliable: true,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    factor
  };
}

// 推荐三大营养素（g）：蛋白按体重（g/kg），脂肪按热量占比，碳水取剩余热量
function recommendMacros(opts) {
  const kcal = opts.kcal || 0;
  const goal = opts.goal || '减重';
  const weight = num(opts.weight) || 60;
  let pPerKg, fatPct;
  if (goal === '增肌') { pPerKg = 1.8; fatPct = 0.25; }
  else if (goal === '减脂' || goal === '减重') { pPerKg = 2.0; fatPct = 0.25; }
  else if (goal === '塑形') { pPerKg = 1.8; fatPct = 0.27; }
  else { pPerKg = 1.6; fatPct = 0.27; } // 保持

  const p = Math.round(weight * pPerKg);
  const f = Math.round(kcal * fatPct / 9);
  const carbKcal = kcal - p * 4 - f * 9;
  const c = Math.round(Math.max(0, carbKcal) / 4);
  return { p, c, f };
}

module.exports = {
  ACTIVITY,
  recommendIntake,
  recommendMacros,
  activityLabel,
  goalDefault
};

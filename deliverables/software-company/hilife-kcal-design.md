# HiLife · 基于体重+目标的每日推荐摄入热量（kcal）设计文档

> 设计阶段产物（PRD + 技术方案 + 任务分解），对应需求：把饮食页「固定 kcal 目标」改为「依据体重/身高/年龄/性别/活动量/目标自动推荐」，并联动三大营养素。
> 产出角色：交付总监齐活林（Qi）按 SOP 的中转编排产出。注：本环境未暴露 `TeamCreate`，无法拉起命名子代理，故 PM/Architect 两部分由主理人合并产出。

---

## 一、现状事实（已核实，非臆测）
- 写死位置：`pages/advice/advice.js`
  - `intakeTargetOf(goal)`（15–17 行）：增肌 2400 / 减脂·减重 1800 / 维持 2100（仅按 goal）。
  - `MACRO_GOAL = {p:140, c:220, f:70}`（11 行，三大营养素 g，常量）。
  - `intakeTarget` 用于饮食记录页顶部「今日摄入」环形图满值（`refresh()` 155 行）；宏量营养素 bar 由 `MACRO_GOAL` 驱动。
- 用户档案 `store.profile`（utils/store.js 352 行 reset）：
  `{ gender:'', goal:'减重', targetWeight:null, height:null, currentWeight:null, fitnessDays:0, weeklyTarget:3 }`
  另有 `weightRecords:[{date,weight,note}]`；`currentWeight` 在 `addWeight()` 写入。
- 档案编辑页 `pages/settings/settings`：仅采集 **gender / targetWeight / height**，**未采集 age 与 activityLevel**。
- 缺口：Mifflin-St Jeor 需要 `weight + height + age + gender + activityLevel`，其中 **age、activityLevel 完全缺失**。

---

## 二、产品目标与成功指标（PRD）
**目标**：让用户看到的每日摄入目标「因人而异、随身体变化自适应」，而非一个写死的常数；在档案不全时诚实降级、引导补全，而不是显示可疑数字。

**成功指标（可度量）**
- 推荐值在档案完整时与手算 Mifflin-TDEE 误差 ≤ 2%。
- 档案缺失关键字段时 100% 走降级提示，绝不展示伪造精度。
- 新用户首次进入饮食页，若 profile 缺 age/activityLevel，可在 ≤2 步内从提示跳到设置补全。
- 体重/目标变化后，推荐值在同一会话内自动重算（无需重启）。

---

## 三、用户故事
1. 作为减脂用户，我希望 App 根据我的体重(72kg)/身高(175)/年龄(30)/男/轻活动，给出约 1900 kcal 的推荐，而不是所有减脂人都吃 1800。
2. 作为增肌用户，我希望推荐值随我最新体重上调（练重了多吃点），不用手动改。
3. 作为新用户，我的档案还没填年龄/活动量，我希望看到「按目标估算 1800，完善资料可精准推荐」的提示，并能一键去设置补全，而不是一个假装精准的数字。
4. 作为进阶用户，我希望三大营养素（蛋白/碳水/脂肪）随总热量联动，而不是永远 140/220/70。

---

## 四、计算模型（核心）
### 4.1 BMR — Mifflin-St Jeor
- 男：`10·weight(kg) + 6.25·height(cm) − 5·age + 5`
- 女：`10·weight + 6.25·height − 5·age − 161`

### 4.2 TDEE — × 活动系数
| 档 | 系数 | 说明 |
|----|------|------|
| 久坐 | 1.2 | 几乎不运动 |
| 轻度 | 1.375 | 每周 1–3 次轻运动 |
| 中度 | 1.55 | 每周 3–5 次（默认） |
| 高度 | 1.725 | 每周 6–7 次 |
| 运动员 | 1.9 | 体力劳动/高强度训练 |

### 4.3 按目标调整（盈余/赤字）
- 减脂 / 减重：`TDEE × 0.80`（约 −20%，下限不低于 BMR，避免代谢损伤）。
- 维持：`TDEE`。
- 增肌：`TDEE × 1.10`（约 +10%，上限 TDEE×1.15）。

### 4.4 三大营养素（由总热量联动，g）
- 蛋白质：`round(max(1.6, 2.0) · weight)`，减脂期可取 2.0–2.2·weight 以保肌。
- 脂肪：`round(kcal · 0.25 / 9)`。
- 碳水：剩余热量 `/ 4` → `round((kcal − protein·4 − fat·9) / 4)`，下限 50g。

---

## 五、循证降级策略（项目硬约束）
档案不足以精确计算时，**不硬算、不显可疑数字**，分两级：
- **L1（缺 age）**：BMR 用 `age=30` 估算，但在 UI 标注「年龄未填·按 30 估算」，并引导去设置补 age。
- **L2（缺 weight / height / gender / activityLevel 任一）**：无法可靠算 BMR → 回退到现有 `intakeTargetOf(goal)` 的 goal 默认值（1800/2100/2400），UI 明确标「按目标估算」，提示「完善身高/体重/活动量以精准推荐」。

> 原则：兜底值沿用既有经验常数，而不是编造精度。这是项目既有「样本不足诚实降级」哲学在营养推荐上的延伸。

---

## 六、需求池
### P0（必须）
- 新增 `utils/nutrition.js`：纯函数 `bmr / tdee / recommendIntake(profile) / recommendMacros(kcal, goal, weight)`，含 L1/L2 降级与 `method` 标记（`precision` / `age-estimated` / `goal-fallback`）。
- `pages/advice/advice.js`：用 `recommendIntake` 替换 `intakeTargetOf(goal)`；用 `recommendMacros` 替换 `MACRO_GOAL`；`refresh()` 同步计算并把 `method`/`missing` 写入 data。
- `store.profile` 增加 `age`、`activityLevel`（默认 `'moderate'`）；提供 `setProfileField` 或复用现有保存入口。
- `pages/settings` 增加 **age 输入** 与 **activityLevel 选择（picker 5 档）**，保存进 profile。

### P1（重要）
- advice 页展示「推荐 N kcal · 基于体重/目标」徽标；降级时显示「按目标估算 · 去完善资料」并 `navigateTo` 设置页。
- 三大营养素 bar 改为推荐宏量（随总热量联动），并标明 g 与供能比。
- 档案补全引导：饮食页检测到降级即弹出/常驻提示卡片，一键跳设置。

### P2（增强）
- 动态再评估：体重记录更新（`weightRecords` 最新值变动）后，同会话内推荐值自动重算并提示「因体重变化，推荐已更新」。
- 趋势：在 profile 或饮食页展示近 30 天推荐热量随体重的变化曲线。
- 手动覆盖：允许用户微调推荐值并记忆（`profile.intakeOverride`），默认回落到推荐。

---

## 七、UI 草图（文字）
**饮食记录页（advice · 记录视图）顶部**
```
┌─────────────────────────────────────┐
│  [今日摄入]      推荐 1980 kcal      │  ← 环形图满值=推荐值
│   ████████░░  基于 72kg·减脂·轻活动  │  ← 灰字副标（precision）
│  1260 / 1980 (64%)                   │
│  蛋白 144g · 碳水 198g · 脂肪 55g    │  ← 随热量联动
└─────────────────────────────────────┘
```
**降级态（缺 age 之外字段）**
```
┌─────────────────────────────────────┐
│  [今日摄入]      按目标估算 1800 kcal │  ← 黄标
│   （完善身高/体重/活动量可精准推荐）  │  ← 可点 → 跳设置
└─────────────────────────────────────┘
```
**设置页新增两项**
```
  年龄 (岁)        [ 30 ]
  活动水平         [ 中度运动 ▾ ]
```

---

## 八、技术方案与文件改动
### 新增 `utils/nutrition.js`（纯函数，可单测）
```js
// 返回 { kcal, protein, carb, fat, method, missing[] }
function recommendIntake(p) {
  const missing = [];
  if (!p.weight && !p.currentWeight) missing.push('weight');
  if (!p.height) missing.push('height');
  if (!p.gender) missing.push('gender');
  if (!p.activityLevel) missing.push('activityLevel');
  // L2：关键字段缺失 → 回退 goal 默认
  if (missing.length) {
    const fb = p.goal === '增肌' ? 2400 : (p.goal === '减脂' || p.goal === '减重') ? 1800 : 2100;
    return { kcal: fb, protein: 140, carb: 220, fat: 70, method: 'goal-fallback', missing };
  }
  const age = p.age || 30;
  const ageEstimated = !p.age; // L1
  const w = Number(p.currentWeight || p.weight);
  const bmr = 10*w + 6.25*Number(p.height) - 5*age + (p.gender === '女' ? -161 : 5);
  const factors = { sedentary:1.2, light:1.375, moderate:1.55, high:1.725, athlete:1.9 };
  const tdee = bmr * (factors[p.activityLevel] || 1.55);
  const ratio = (p.goal === '增肌') ? 1.10 : (p.goal === '减脂' || p.goal === '减重') ? 0.80 : 1.0;
  let kcal = Math.round(tdee * ratio);
  if (p.goal === '减脂' || p.goal === '减重') kcal = Math.max(kcal, Math.round(bmr)); // 不低于 BMR
  const protein = Math.round((p.goal === '减脂' || p.goal === '减重' ? 2.0 : 1.6) * w);
  const fat = Math.round(kcal * 0.25 / 9);
  const carb = Math.max(50, Math.round((kcal - protein*4 - fat*9) / 4));
  return { kcal, protein, carb, fat, method: ageEstimated ? 'age-estimated' : 'precision', missing: ageEstimated ? ['age'] : [] };
}
```

### `utils/store.js`
- reset：`age: null, activityLevel: 'moderate'` 加入 profile 默认值。
- 复用/新增 setter 保存 age、activityLevel（与 targetWeight/height 同一保存入口）。

### `pages/settings/settings.js` + `.wxml`
- data 增加 `age`、`activityLevels`（`['久坐','轻度','中度','高度','运动员']`）、`activityIndex`。
- 增加 `onAge` 输入与 `pickActivity` 选择；`save()` 一并写入 `age`、`activityLevel`。

### `pages/advice/advice.js`
- 删除/保留 `intakeTargetOf` 仅作兜底；`refresh()` 改为：
  `const rec = recommendIntake(st.profile); intakeTarget = rec.kcal;` 同时把 `rec.method` / `rec.missing` / 宏量写入 data。
- `data.nutrients` 由 `recommendMacros` 生成（替换 MACRO_GOAL 常量）。

### `pages/advice/advice.wxml` + `.wxss`
- 顶部副标显示方法来源（precision / age-estimated / goal-fallback）。
- 降级时渲染提示条，`bindtap` 跳 `pages/settings/settings`。

---

## 九、任务分解（有序 + 依赖）
| # | 任务 | 文件 | 依赖 |
|---|------|------|------|
| T1 | 实现 `utils/nutrition.js`（bmr/tdee/recommendIntake/recommendMacros + 降级） | `utils/nutrition.js`（新） | 无 |
| T2 | profile 增加 age/activityLevel 默认值与保存 | `utils/store.js` | T1（数据契约） |
| T3 | 设置页新增 age 输入 + 活动量选择 | `pages/settings/*` | T2 |
| T4 | advice 页接入 nutrition，替换固定值 + 写 method/missing | `pages/advice/advice.js` | T1 |
| T5 | advice 页 UI 渲染推荐值/方法徽标/降级提示/跳设置 | `pages/advice/advice.wxml` + `.wxss` | T4 |
| T6(P2) | 体重变化自动重算 + 趋势 + 手动覆盖 | `pages/advice` + `store` | T4,T5 |

---

## 十、待确认问题（建议默认值）
1. **是否新增 age / activityLevel 字段？** 建议：是（否则只能用 L2 兜底，精度价值归零）。
2. **活动量默认档？** 建议 `moderate`(1.55)。
3. **减脂赤字幅度？** 建议 TDEE×0.80 且不低于 BMR；是否改固定 −500kcal 上限？
4. **增肌盈余幅度？** 建议 +10%（上限 +15%）。
5. **是否允许手动覆盖推荐值？** 建议 P2 支持 `profile.intakeOverride`。
6. **gender 为空兜底？** 当前默认 `''`；建议设置页强制选择，计算时若为空走 L2 兜底（不默认假定男性）。

---

## 十一、下一步
- 确认第十节 6 项（尤其 1/3/4）后，即可进入实现（P0：T1→T5）。
- 实现阶段建议走「快速模式」直接由工程师落地 T1–T5，QA 跑 `nutrition.js` 纯函数单测（边界：缺字段、age 缺失、减脂低于 BMR 截断）。

// presets/cycles.js
// 周期规划模板库（Phase 2）
// 来源：LZheng-fitness 开源框架（MIT）的循证训练科学方法论（周期化 Periodization：积累 / 强度 / 减量验证）
//   —— 仅复用方法论，未搬运任何第三方视觉素材，媒体仍用本小程序 cloud:// 资源。
//
// 数据契约：
//   cycle: {
//     title,                                   // 周期标题
//     phases: [{ label, start_week, end_week, intent }],  // 阶段（按周区间）
//     chart: { rpe: [...逐周处方RPE], sets: [...逐周处方总组数] },  // 进度图 + 实际对比用处方锚点
//     rules                                    // 周期执行规则说明
//   }
//   days: 同 presets/plans.js 形状（day.actions[].exerciseId 引用 utils/exercises.js 真实 id），
//         导入时按「全部训练日」展开为 store 计划（扁平 actions），并带上 cycle 字段。
//
// 与 presets/plans.js 的区别：方案是「单日/单计划」模板；周期是「跨周编排」模板，
//   多一个 cycle 字段描述周维度处方（阶段、强度 RPE、容量 sets），供复盘「实际 vs 处方」对比。

const CYCLES = [
  /* ============ 1. 力量 · 8 周进阶 ============ */
  {
    id: 'cycle-strength-8w',
    name: '力量·8周进阶',
    goal: '力量',
    level: '中级',
    weeks: 8,
    desc: '围绕深蹲 / 卧推 / 硬拉三大项构建绝对力量。前 3 周积累量与技术，4–6 周提升强度，第 7 周减量恢复、第 8 周测最大力量。每周 3 天。',
    cycle: {
      title: '力量·8周进阶',
      phases: [
        { label: '积累', start_week: 1, end_week: 3, intent: '建立容量与技术，强度 RPE 7–8' },
        { label: '强度', start_week: 4, end_week: 6, intent: '提高负荷、降低次数，RPE 8–9' },
        { label: '减量验证', start_week: 7, end_week: 8, intent: '第7周减量恢复，第8周冲击最大力量' }
      ],
      chart: {
        rpe: [7.5, 7.5, 8, 8.5, 8.5, 9, 6.5, 9],
        sets: [16, 16, 18, 14, 16, 18, 9, 14]
      },
      rules: '每周 3 天（A 下肢推+上肢推 / B 髋铰链+上肢拉 / C 辅助）。强度周主项降次数升重量；减量周容量降至约 50%。'
    },
    days: [
      {
        name: 'A 日 · 下肢推 + 上肢推',
        focus: '腿 / 胸 / 肩 / 三头',
        actions: [
          { exerciseId: '0043', setsCount: 5, reps: '5', rest: 120, note: '杠铃深蹲，主项' },
          { exerciseId: '0025', setsCount: 5, reps: '5', rest: 120, note: '杠铃卧推，主项' },
          { exerciseId: '0091', setsCount: 3, reps: '8', rest: 90, note: '坐姿杠铃过顶推举' },
          { exerciseId: '0812', setsCount: 3, reps: '10', rest: 75, note: '凳上臂屈伸' }
        ]
      },
      {
        name: 'B 日 · 髋铰链 + 上肢拉',
        focus: '后链 / 背 / 二头',
        actions: [
          { exerciseId: '0032', setsCount: 3, reps: '5', rest: 120, note: '杠铃硬拉，主项' },
          { exerciseId: '0652', setsCount: 4, reps: '6', rest: 90, note: '引体向上；新手可换助力引体' },
          { exerciseId: '0027', setsCount: 3, reps: '8', rest: 90, note: '杠铃俯身划船' },
          { exerciseId: '0294', setsCount: 3, reps: '10', rest: 75, note: '哑铃二头弯举' }
        ]
      },
      {
        name: 'C 日 · 下肢+上肢辅助',
        focus: '腿 / 背 / 肩',
        actions: [
          { exerciseId: '0043', setsCount: 3, reps: '5', rest: 120, note: '杠铃深蹲（减量）' },
          { exerciseId: '0085', setsCount: 3, reps: '8', rest: 90, note: '罗马尼亚杠铃硬拉' },
          { exerciseId: '0218', setsCount: 3, reps: '10', rest: 75, note: '坐姿宽握绳索划船' },
          { exerciseId: '0334', setsCount: 3, reps: '12', rest: 60, note: '哑铃侧平举' }
        ]
      }
    ]
  },

  /* ============ 2. 增肌 · 10 周容量 ============ */
  {
    id: 'cycle-hypertrophy-10w',
    name: '增肌·10周容量',
    goal: '增肌',
    level: '进阶',
    weeks: 10,
    desc: '推 / 拉 / 腿分化，以高容量刺激肌肥大。前 5 周容量积累，6–9 周强度峰值，第 10 周减量。每周可练 3–6 天。',
    cycle: {
      title: '增肌·10周容量',
      phases: [
        { label: '容量积累', start_week: 1, end_week: 5, intent: '高组数高次数，RPE 7–8，堆容量' },
        { label: '强度峰值', start_week: 6, end_week: 9, intent: '略升强度 RPE 8–9，维持容量' },
        { label: '减量', start_week: 10, end_week: 10, intent: '容量降至约 50%，促进超量恢复' }
      ],
      chart: {
        rpe: [7.5, 7.5, 8, 8, 8, 8.5, 8.5, 8.5, 9, 6.5],
        sets: [30, 30, 33, 33, 36, 30, 33, 33, 36, 18]
      },
      rules: '推 / 拉 / 腿三分化。容量周以 8–15 次、组数多为特征；强度周把主项次数压到 6–8、重量升；减量周组数减半。'
    },
    days: [
      {
        name: '推日 · 胸肩三头',
        focus: '胸 / 肩 / 三头',
        actions: [
          { exerciseId: '0025', setsCount: 4, reps: '8-12', rest: 90, note: '杠铃卧推' },
          { exerciseId: '0314', setsCount: 3, reps: '8-12', rest: 75, note: '上斜哑铃卧推' },
          { exerciseId: '0308', setsCount: 3, reps: '12-15', rest: 60, note: '哑铃飞鸟' },
          { exerciseId: '0091', setsCount: 3, reps: '8-12', rest: 75, note: '坐姿杠铃过顶推举' },
          { exerciseId: '0334', setsCount: 3, reps: '12-15', rest: 60, note: '哑铃侧平举' },
          { exerciseId: '0812', setsCount: 3, reps: '10-15', rest: 60, note: '凳上臂屈伸' }
        ]
      },
      {
        name: '拉日 · 背二头',
        focus: '背 / 二头',
        actions: [
          { exerciseId: '0652', setsCount: 4, reps: '6-10', rest: 90, note: '引体向上' },
          { exerciseId: '0027', setsCount: 4, reps: '8-12', rest: 75, note: '杠铃俯身划船' },
          { exerciseId: '0218', setsCount: 3, reps: '10-12', rest: 60, note: '坐姿宽握绳索划船' },
          { exerciseId: '0294', setsCount: 3, reps: '10-12', rest: 60, note: '哑铃二头弯举' },
          { exerciseId: '0313', setsCount: 3, reps: '10-12', rest: 60, note: '哑铃锤弯举' }
        ]
      },
      {
        name: '腿日 · 股腘小腿',
        focus: '股四 / 腘绳 / 小腿',
        actions: [
          { exerciseId: '0043', setsCount: 4, reps: '8-12', rest: 90, note: '全程杠铃深蹲' },
          { exerciseId: '0085', setsCount: 3, reps: '8-12', rest: 75, note: '罗马尼亚杠铃硬拉' },
          { exerciseId: '0054', setsCount: 3, reps: '10-12', rest: 60, note: '杠铃箭步蹲' },
          { exerciseId: '0130', setsCount: 3, reps: '12-15', rest: 60, note: '凳髋臂屈伸' },
          { exerciseId: '0108', setsCount: 3, reps: '15-20', rest: 60, note: '站姿杠铃腿提踵' }
        ]
      }
    ]
  },

  /* ============ 3. 减脂 · 6 周代谢 ============ */
  {
    id: 'cycle-fatloss-6w',
    name: '减脂·6周代谢',
    goal: '减脂',
    level: '中级',
    weeks: 6,
    desc: '全身循环为主，复合动作 + 短休息提升消耗。前 2 周适应，3–4 周代谢压力，第 5 周峰值，第 6 周减量验证。每周 3 天。',
    cycle: {
      title: '减脂·6周代谢',
      phases: [
        { label: '适应', start_week: 1, end_week: 2, intent: '建立动作模式，RPE 6–7' },
        { label: '代谢压力', start_week: 3, end_week: 4, intent: '短休息高密度，RPE 7–8' },
        { label: '峰值', start_week: 5, end_week: 5, intent: '容量与密度最高点，RPE 8' },
        { label: '验证', start_week: 6, end_week: 6, intent: '减量恢复，巩固习惯' }
      ],
      chart: {
        rpe: [6.5, 7, 7.5, 8, 8, 6.5],
        sets: [21, 21, 23, 23, 25, 13]
      },
      rules: '每次训练覆盖全身大肌群，复合动作为主、组间休息 30–45s 提升消耗。减脂核心在热量缺口，训练维持肌肉量。'
    },
    days: [
      {
        name: '全身循环',
        focus: '全身复合',
        actions: [
          { exerciseId: '1760', setsCount: 3, reps: '12', rest: 45, note: '哑铃高脚杯深蹲' },
          { exerciseId: '0289', setsCount: 3, reps: '12', rest: 45, note: '哑铃卧推' },
          { exerciseId: '0027', setsCount: 3, reps: '12', rest: 45, note: '杠铃俯身划船' },
          { exerciseId: '0405', setsCount: 3, reps: '12', rest: 45, note: '坐姿哑铃肩上推举' },
          { exerciseId: '0294', setsCount: 3, reps: '12', rest: 45, note: '哑铃二头弯举' },
          { exerciseId: '0687', setsCount: 3, reps: '20', rest: 30, note: '俄罗斯转体' },
          { exerciseId: '0464', setsCount: 3, reps: '30秒', rest: 30, note: '平板支撑转体' }
        ]
      }
    ]
  }
];

module.exports = { CYCLES };

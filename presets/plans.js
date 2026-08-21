// presets/plans.js
// 循证训练方案库
// 来源：LZheng-fitness 开源框架（MIT）的循证训练科学知识（Alan Aragon / Schoenfeld / Eric Helms 等蒸馏）
//   —— 仅复用其训练科学方法论，未搬运任何第三方视觉素材，媒体仍用本小程序 cloud:// 资源。
// 数据契约：每个方案 program 含若干训练日 day；day.actions 引用 utils/exercises.js 中真实存在的 id。
//   导入时按「训练日」展开为 store 的计划（扁平 actions），复用 store.addPlan / applyPlanToSelected。
//   训练参数：setsCount=组数，reps=次数区间，rest=建议组间休息(秒，仅作建议展示，不写入 plan)，
//             weight 留空由用户在 App 内自填（循证起点安全，不支持逐动作重量校准）。

const PROGRAMS = [
  /* ============ 1. 增肌 · 推拉腿分化 ============ */
  {
    id: 'ppl-hypertrophy',
    name: '增肌·推拉腿分化',
    goal: '增肌',
    level: '进阶',
    daysPerWeek: 6,
    desc: '按肌群「推 / 拉 / 腿」分化，高频刺激肌肥大。每周可练 3 天（每部位 1 次）或 6 天（每部位 2 次，适合有基础者）。',
    days: [
      {
        name: '推日 · 胸肩三头',
        focus: '胸 / 肩 / 三头',
        actions: [
          { exerciseId: '0025', setsCount: 4, reps: '8-12', rest: 90, note: '大重量复合，首发动作' }, // 杠铃卧推
          { exerciseId: '0314', setsCount: 3, reps: '8-12', rest: 75, note: '上斜哑铃卧推' },        // 上斜哑铃卧推
          { exerciseId: '0308', setsCount: 3, reps: '12-15', rest: 60, note: '哑铃飞鸟' },            // 哑铃飞鸟
          { exerciseId: '0091', setsCount: 3, reps: '8-12', rest: 75, note: '坐姿杠铃过顶推举' },      // 坐姿杠铃过顶推举
          { exerciseId: '0334', setsCount: 3, reps: '12-15', rest: 60, note: '哑铃侧平举' },          // 哑铃侧平举
          { exerciseId: '0812', setsCount: 3, reps: '10-15', rest: 60, note: '凳上臂屈伸' }           // 三头臂屈伸（凳腿）
        ]
      },
      {
        name: '拉日 · 背二头',
        focus: '背 / 二头',
        actions: [
          { exerciseId: '0652', setsCount: 4, reps: '6-10', rest: 90, note: '引体向上；新手可换助力引体(0017)' }, // 引体向上
          { exerciseId: '0027', setsCount: 4, reps: '8-12', rest: 75, note: '杠铃俯身划船' },        // 杠铃俯身划船
          { exerciseId: '0218', setsCount: 3, reps: '10-12', rest: 60, note: '坐姿宽握绳索划船' },    // 坐姿宽握绳索划船
          { exerciseId: '0294', setsCount: 3, reps: '10-12', rest: 60, note: '哑铃二头弯举' },        // 哑铃二头弯举
          { exerciseId: '0313', setsCount: 3, reps: '10-12', rest: 60, note: '哑铃锤弯举' }           // 哑铃锤弯举
        ]
      },
      {
        name: '腿日 · 股腘小腿',
        focus: '股四 / 腘绳 / 小腿',
        actions: [
          { exerciseId: '0043', setsCount: 4, reps: '8-12', rest: 90, note: '全程杠铃深蹲' },         // 全程杠铃深蹲
          { exerciseId: '0085', setsCount: 3, reps: '8-12', rest: 75, note: '罗马尼亚杠铃硬拉' },     // 罗马尼亚杠铃硬拉
          { exerciseId: '0054', setsCount: 3, reps: '10-12', rest: 60, note: '杠铃箭步蹲' },          // 杠铃箭步蹲
          { exerciseId: '0130', setsCount: 3, reps: '12-15', rest: 60, note: '凳髋臂屈伸（臀/腘）' }, // 凳髋臂屈伸
          { exerciseId: '0108', setsCount: 3, reps: '15-20', rest: 60, note: '站姿杠铃腿提踵' }        // 站姿杠铃腿提踵
        ]
      }
    ]
  },

  /* ============ 2. 力量 · 基础五大项 ============ */
  {
    id: 'strength-big5',
    name: '力量·基础五大项',
    goal: '力量',
    level: '中级',
    daysPerWeek: 3,
    desc: '围绕深蹲、卧推、硬拉、肩推、引体五大复合动作构建绝对力量。每周 3 天，低次数高组数，渐进超负荷。',
    days: [
      {
        name: 'A 日 · 下肢推 + 上肢推',
        focus: '腿 / 胸 / 肩 / 三头',
        actions: [
          { exerciseId: '0043', setsCount: 5, reps: '5', rest: 120, note: '杠铃深蹲，主项' },         // 全程杠铃深蹲
          { exerciseId: '0025', setsCount: 5, reps: '5', rest: 120, note: '杠铃卧推，主项' },         // 杠铃卧推
          { exerciseId: '0091', setsCount: 3, reps: '8', rest: 90, note: '坐姿杠铃过顶推举' },        // 坐姿杠铃过顶推举
          { exerciseId: '0812', setsCount: 3, reps: '10', rest: 75, note: '凳上臂屈伸' }             // 三头臂屈伸（凳腿）
        ]
      },
      {
        name: 'B 日 · 髋铰链 + 上肢拉',
        focus: '后链 / 背 / 二头',
        actions: [
          { exerciseId: '0032', setsCount: 3, reps: '5', rest: 120, note: '杠铃硬拉，主项' },         // 杠铃硬拉
          { exerciseId: '0652', setsCount: 4, reps: '6', rest: 90, note: '引体向上；新手可换助力引体(0017)' }, // 引体向上
          { exerciseId: '0027', setsCount: 3, reps: '8', rest: 90, note: '杠铃俯身划船' },            // 杠铃俯身划船
          { exerciseId: '0294', setsCount: 3, reps: '10', rest: 75, note: '哑铃二头弯举' }            // 哑铃二头弯举
        ]
      },
      {
        name: 'C 日 · 下肢+上肢辅助',
        focus: '腿 / 背 / 肩',
        actions: [
          { exerciseId: '0043', setsCount: 3, reps: '5', rest: 120, note: '杠铃深蹲（减量）' },       // 全程杠铃深蹲
          { exerciseId: '0085', setsCount: 3, reps: '8', rest: 90, note: '罗马尼亚杠铃硬拉' },        // 罗马尼亚杠铃硬拉
          { exerciseId: '0218', setsCount: 3, reps: '10', rest: 75, note: '坐姿宽握绳索划船' },        // 坐姿宽握绳索划船
          { exerciseId: '0334', setsCount: 3, reps: '12', rest: 60, note: '哑铃侧平举' }              // 哑铃侧平举
        ]
      }
    ]
  },

  /* ============ 3. 减脂 · 全身循环 ============ */
  {
    id: 'fatloss-fullbody',
    name: '减脂·全身循环',
    goal: '减脂',
    level: '中级',
    daysPerWeek: 3,
    desc: '每次训练覆盖全身大肌群，复合动作为主、短休息提升消耗。每周 3 天，循环操作高效省时。',
    days: [
      {
        name: '全身循环',
        focus: '全身复合',
        actions: [
          { exerciseId: '1760', setsCount: 3, reps: '12', rest: 45, note: '哑铃高脚杯深蹲' },         // 哑铃高脚杯深蹲
          { exerciseId: '0289', setsCount: 3, reps: '12', rest: 45, note: '哑铃卧推' },                // 哑铃卧推
          { exerciseId: '0027', setsCount: 3, reps: '12', rest: 45, note: '杠铃俯身划船' },            // 杠铃俯身划船
          { exerciseId: '0405', setsCount: 3, reps: '12', rest: 45, note: '坐姿哑铃肩上推举' },        // 坐姿哑铃肩上推举
          { exerciseId: '0294', setsCount: 3, reps: '12', rest: 45, note: '哑铃二头弯举' },            // 哑铃二头弯举
          { exerciseId: '0687', setsCount: 3, reps: '20', rest: 30, note: '俄罗斯转体' },              // 俄罗斯转体
          { exerciseId: '0464', setsCount: 3, reps: '30秒', rest: 30, note: '平板支撑转体' }           // 前带平板支撑转体
        ]
      }
    ]
  },

  /* ============ 4. 新手 · 全身入门 ============ */
  {
    id: 'beginner-fullbody',
    name: '新手·全身入门',
    goal: '通用',
    level: '入门',
    daysPerWeek: 3,
    desc: '自重与哑铃为主、低门槛、动作模式友好，帮助新手建立发力感与训练习惯。每周 3 天即可。',
    days: [
      {
        name: '全身入门',
        focus: '全身基础',
        actions: [
          { exerciseId: '0662', setsCount: 3, reps: '10-15', rest: 60, note: '俯卧撑；跪姿退阶亦可' }, // 俯卧撑
          { exerciseId: '1760', setsCount: 3, reps: '12', rest: 60, note: '哑铃高脚杯深蹲' },          // 哑铃高脚杯深蹲
          { exerciseId: '0294', setsCount: 3, reps: '12', rest: 60, note: '哑铃二头弯举' },             // 哑铃二头弯举
          { exerciseId: '0334', setsCount: 3, reps: '12', rest: 60, note: '哑铃侧平举' },               // 哑铃侧平举
          { exerciseId: '0274', setsCount: 3, reps: '15', rest: 45, note: '地面卷腹' },                 // 地面卷腹
          { exerciseId: '0687', setsCount: 3, reps: '15', rest: 45, note: '俄罗斯转体' },               // 俄罗斯转体
          { exerciseId: '0464', setsCount: 3, reps: '30秒', rest: 45, note: '平板支撑转体' }            // 前带平板支撑转体
        ]
      }
    ]
  }
];

module.exports = { PROGRAMS };

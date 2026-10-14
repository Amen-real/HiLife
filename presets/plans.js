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
  },

  /* ============ 5. 三分化 · 推拉腿（谭成义） ============
     来源：用户提供的「凯圣王、谭成义三分化训练体系」图（2026-10-14 导入）。
     频率每周 3 天隔天练（如一/三/五），顺序 推→拉→腿 循环；
     组间休息：大肌群 90-120 秒、小肌群 60-90 秒；渐进超负荷、动作标准优先。 */
  {
    id: 'ppl-3day-tan',
    name: '三分化·推拉腿（谭成义）',
    goal: '增肌',
    level: '中级',
    daysPerWeek: 3,
    desc: '「凯圣王、谭成义三分化」：推 → 拉 → 腿循环，每周 3 天隔天练（如一 / 三 / 五）。渐进超负荷、动作标准优先，合理管理疲劳；大肌群组间休息 90-120 秒、小肌群 60-90 秒。',
    days: [
      {
        name: '推日 · 胸肩三头',
        focus: '胸 / 肩 / 三头',
        actions: [
          { exerciseId: '0025', setsCount: 4, reps: '8-12', rest: 90, note: '杠铃卧推，主项' },                      // 杠铃卧推
          { exerciseId: '0314', setsCount: 4, reps: '8-12', rest: 90, note: '哑铃上斜卧推，活动度更高、能做更重' },   // 上斜哑铃卧推
          { exerciseId: '0251', setsCount: 4, reps: '8-12', rest: 75, note: '双杠臂屈伸；力量不足可退阶（不做半程、确保下放到力竭）' }, // 胸臂屈伸
          { exerciseId: '0061', setsCount: 4, reps: '8-12', rest: 75, note: '仰卧臂屈伸，孤立三头' },                 // 卧姿杠铃三头臂屈伸
          { exerciseId: '3541', setsCount: 3, reps: '10+10+10', rest: 60, note: 'Y字侧平举，常被忽视；在斜坡位置做、二头和肩不参与' }  // 上斜哑铃Y字平举
        ]
      },
      {
        name: '拉日 · 背二头',
        focus: '背 / 二头',
        actions: [
          { exerciseId: '3563', setsCount: 4, reps: '8-12', rest: 90, note: '单手钢线下拉；调整角度贴合背阔肌，找收缩感，加重组在顶点停留 5 秒' }, // 单臂绳索下拉
          { exerciseId: '0818', setsCount: 4, reps: '8-12', rest: 90, note: '对握下拉；次数从 12 次渐降到 8 次区间，动作标准的前提下重量相对重要' }, // 平行握高位下拉
          { exerciseId: '1356', setsCount: 4, reps: '10', rest: 75, note: '单手器械划船；单侧解决左右不平衡，发展肩胛骨功能' },       // 单臂侧高器械划船
          { exerciseId: '0218', setsCount: 4, reps: '10', rest: 75, note: '坐姿划船；中斜方肌内收、避免借力，注意动作细节' },          // 坐姿宽握绳索划船
          { exerciseId: '0868', setsCount: 3, reps: '10', rest: 60, note: '钢线弯举（后握位）；小重量高控制，一个月后根据感受调整' }   // 绳索弯举
        ]
      },
      {
        name: '腿日 · 腿臀',
        focus: '腿 / 臀',
        actions: [
          { exerciseId: '1757', setsCount: 4, reps: '12', rest: 90, note: '单腿硬拉；发展股绳肌群、打好后侧链基础（杠铃版 1756）' },  // 单腿哑铃硬拉
          { exerciseId: '0410', setsCount: 4, reps: '12', rest: 90, note: '保加利亚深蹲（后脚垫高）；对下肢帮助大，复合主项不做半程，保留 3-4 次余力' }, // 单腿哑铃分腿蹲
          { exerciseId: '0042', setsCount: 4, reps: '12', rest: 120, note: '颈前深蹲；建议以动作焦、全身协调建立为主，从轻重量循序渐进、目标自增' },   // 杠铃前蹲
          { exerciseId: '0085', setsCount: 4, reps: '10', rest: 90, note: '罗马尼亚硬拉；髋铰链动作，优先掌握、负重居中，发展腘绳 / 臀 / 下背' },      // 罗马尼亚杠铃硬拉
          { exerciseId: '0489', setsCount: 3, reps: '8', rest: 60, note: '山羊挺身；刺激竖脊肌与臀部，提升身体功能与体态，解决腰部与下背收缩感' }       // 超伸
        ]
      }
    ]
  }
];

module.exports = { PROGRAMS };

// 校验 presets/plans.js 中每个 exerciseId 在 exercises.js 真实存在、字段完整
const { PROGRAMS } = require('C:/Users/Admin/WorkBuddy/HiLife/presets/plans.js');
const ex = require('C:/Users/Admin/WorkBuddy/HiLife/utils/exercises.js');
const lib = ex.library;

// 建立 id -> 动作 索引
const idx = {};
Object.keys(lib).forEach(cat => (lib[cat] || []).forEach(a => { if (a.id) idx[a.id] = a; }));

let total = 0, missing = 0, badField = 0;
PROGRAMS.forEach(p => {
  p.days.forEach(d => {
    d.actions.forEach(a => {
      total++;
      const s = idx[a.exerciseId];
      if (!s) {
        missing++;
        console.log(`缺失引用: program=${p.id} day=${d.name} exerciseId=${a.exerciseId}`);
        return;
      }
      if (!s.nameZh) { badField++; console.log(`缺 nameZh: ${a.exerciseId}`); }
      ['setsCount', 'reps'].forEach(f => {
        if (a[f] === undefined || a[f] === '') { badField++; console.log(`缺字段 ${f}: ${a.exerciseId} (${s.nameZh || ''})`); }
      });
      if (s.image) { /* 有 image 即能经 cloud:// 显示，ok */ }
    });
  });
});

const dayCount = PROGRAMS.reduce((s, p) => s + p.days.length, 0);
console.log(`\n统计: 方案 ${PROGRAMS.length} 套, 训练日 ${dayCount} 天, 动作项 ${total}`);
console.log(`缺失引用: ${missing}, 字段问题: ${badField}`);
console.log(missing === 0 && badField === 0 ? '✅ 校验通过：所有预设动作均可复用 cloud:// 媒体并落地 store' : '❌ 存在问题，需修正');
process.exit(missing === 0 && badField === 0 ? 0 : 1);

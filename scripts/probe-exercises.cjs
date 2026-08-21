// 提取 exercises.js 分类结构 + 基础动作候选（用于构建预设计划库）
const ex = require('C:/Users/Admin/WorkBuddy/HiLife/utils/exercises.js');
const lib = ex.library;

console.log('=== 分类与数量 ===');
Object.keys(lib).forEach(cat => {
  const arr = Array.isArray(lib[cat]) ? lib[cat] : [];
  console.log(`${cat}: ${arr.length}`);
});

console.log('\n=== 基础动作候选（关键词命中） ===');
const KW = ['卧推','深蹲','硬拉','引体','推举','肩上推','弯举','划船','箭步','卷腹','平板','臀桥','下蹲','俯卧撑','高位下拉','腿举','侧平举','飞鸟','臂屈伸','臂弯举','提踵','俄罗斯','登山'];
Object.keys(lib).forEach(cat => {
  const arr = Array.isArray(lib[cat]) ? lib[cat] : [];
  const hit = arr.filter(a => {
    const t = (a.nameZh || '') + ' ' + (a.name || '');
    return KW.some(k => t.indexOf(k) >= 0);
  });
  if (hit.length) {
    console.log(`\n[${cat}]`);
    hit.forEach(a => console.log(`  ${a.id}\t${a.nameZh || a.name}\t(${a.equip || ''})`));
  }
});

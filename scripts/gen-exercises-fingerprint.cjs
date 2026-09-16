// scripts/gen-exercises-fingerprint.cjs —— 重新生成动作库指纹（仅在「确实要改动作库数据」时运行）
//
// 正常改数据 / 改编码的流程：
//   1) 改 scripts/gen-exercises-compact.cjs 或数据源
//   2) node scripts/gen-exercises-compact.cjs        ← 重新生成 utils/exercises.js
//   3) node scripts/verify-exercises-compact.cjs     ← 必须 PASS（此刻还在跟旧指纹比）
//   4) node scripts/gen-exercises-fingerprint.cjs    ← 确认无误后才更新指纹
// 顺序不能颠倒：先更新指纹再验证，等于把尺子改成跟被测物一样长。
const fs = require('fs');
const path = require('path');
const { fingerprint } = require('./lib/exercises-fingerprint.cjs');

const lib = require('../utils/exercises.js').library;
const fp = fingerprint(lib);
const out = path.join(__dirname, 'exercises-fingerprint.json');
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;

fs.writeFileSync(out, JSON.stringify(fp), 'utf8');
console.log('已写入 scripts/exercises-fingerprint.json');
console.log('  动作总数 : ' + fp.total);
console.log('  聚合 digest : ' + fp.digest.slice(0, 32) + '…');
console.log('  文件体积 : ' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB（在 scripts/ 下，不进包）');
if (prev) {
  const changed = [];
  for (const cat of fp.categories) {
    const a = (prev.groups || {})[cat] || [];
    const b = fp.groups[cat] || [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) changed.push(cat + ' 第 ' + (i + 1) + ' 位: ' + (a[i] || '(无)') + ' → ' + (b[i] || '(无)'));
    }
  }
  for (const cat of (prev.categories || [])) if (!fp.categories.includes(cat)) changed.push('分类被删: ' + cat);
  console.log('  与上一版指纹相比 : 变化 ' + changed.length + ' 处' +
    (prev.total !== fp.total ? '（总数 ' + prev.total + ' → ' + fp.total + '）' : ''));
  changed.slice(0, 10).forEach(e => console.log('     · ' + e));
}

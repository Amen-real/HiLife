// scripts/verify-exercises-compact.cjs —— 压缩版与 git HEAD 原版逐字段深比较
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const origSrc = execSync('git show HEAD:utils/exercises.js', { encoding: 'utf8', cwd: path.join(__dirname, '..') });
const tmp = path.join(__dirname, 'tmp-orig-exercises.js');
fs.writeFileSync(tmp, origSrc, 'utf8');
const orig = require('./tmp-orig-exercises.js').library;
const now = require('../utils/exercises.js').library;

let total = 0, bad = [];
Object.keys(orig).forEach(cat => {
  const a = orig[cat], b = now[cat] || [];
  if (a.length !== b.length) bad.push(cat + ' 条数不符 ' + a.length + ' vs ' + b.length);
  for (let i = 0; i < a.length; i++) {
    total++;
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      bad.push(cat + '#' + i + ' (' + a[i].id + ') 字段不一致');
    }
  }
});
const catOrder = JSON.stringify(Object.keys(orig)) === JSON.stringify(Object.keys(now));
fs.unlinkSync(tmp);
console.log('比较动作总数:', total, '| 类别顺序一致:', catOrder);
if (bad.length || !catOrder) {
  console.log('FAIL:\n' + bad.slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('PASS: 压缩版与原版逐动作完全一致');

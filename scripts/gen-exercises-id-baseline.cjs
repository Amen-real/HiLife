#!/usr/bin/env node
/**
 * gen-exercises-id-baseline.cjs —— 生成/更新动作 id 基线快照
 *
 * 快照：scripts/exercises-id-baseline.json（落在 scripts/ 内 ⇒ 已在 packOptions.ignore，
 * **不进主包**；也不该进，因为它只是契约守卫的基准，不是业务数据）。
 *
 * ⚠️⚠️ 更新顺序与 verify-exercises-compact 完全同构，**不能反**：
 *     node scripts/verify-exercises-compact.cjs      ← 先验证内容与固定指纹一致
 *     node scripts/gen-exercises-id-baseline.cjs    ← 数据确实要改时才更新本快照
 *     node scripts/verify-exercise-id-contract.cjs  ← 再验证契约
 *   先更新再验证 = 把尺子改成跟被测物一样长。
 *
 * 快照里**不记全量 id**（那会变成第二份数据源），只记足以发现
 * 「编号重排 / 删除 / 组顺序变化」的信息：总数、min/max、分类顺序、各组首尾 id。
 *
 * 用法：node scripts/gen-exercises-id-baseline.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'scripts', 'exercises-id-baseline.json');

const libSrc = fs.readFileSync(path.join(ROOT, 'utils', 'exercises.js'), 'utf8');
const start = libSrc.indexOf('var _R=') + 'var _R='.length;
let depth = 0, end = start;
for (let i = start; i < libSrc.length; i++) {
  const c = libSrc[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
const rows = JSON.parse(libSrc.slice(start, end));
const groups = Object.keys(rows);
const ids = groups.flatMap(g => rows[g].map(r => r[0]));
const nums = ids.map(Number);

const snap = {
  _note: '动作 id 契约基线 —— 由 gen-exercises-id-baseline.cjs 生成；勿手改。' +
    '更新顺序见该脚本头部（先 verify-exercises-compact，再更新本文件，再 verify-exercise-id-contract）。',
  _contract: 'id 永久不复用；媒体路径含内容 hash；分类与组内顺序是对外契约的一部分。',
  total: ids.length,
  min: Math.min(...nums),
  max: Math.max(...nums),
  groups,
  firstLast: groups.map(g => [g, rows[g][0][0], rows[g][rows[g].length - 1][0]])
};

fs.writeFileSync(OUT, JSON.stringify(snap, null, 2) + '\n', 'utf8');
console.log('已写入 ' + path.relative(ROOT, OUT)
  + '（total=' + snap.total + ' min=' + snap.min + ' max=' + snap.max + ' groups=' + snap.groups.length + '）');
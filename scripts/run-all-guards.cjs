// scripts/run-all-guards.cjs —— 一次性跑全量校验脚本，只输出每项的结论与失败明细
// 用途：改动 js/wxss 后做回归巡检，避免「只跑了记得的那两三个」。
// 注意：不要用它替代理解 —— 它只聚合结果，判定标准仍各自在 verify-*.cjs 里。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.execPath;
const DIR = __dirname;
const ROOT = path.join(DIR, '..');

const files = fs.readdirSync(DIR)
  .filter(f => /^(verify|test)-.*\.cjs$/.test(f) || f === 'scan-main-package.cjs')
  .sort();

const failed = [];
for (const f of files) {
  let out = '';
  try {
    out = execFileSync(NODE, [path.join(DIR, f)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    failed.push(f);
    const lines = out.trim().split(/\r?\n/);
    console.log('✗ ' + f.padEnd(28) + (lines[lines.length - 1] || '').slice(0, 70));
    lines.filter(l => /✗|Error|FAIL|失败/.test(l)).slice(0, 6)
      .forEach(l => console.log('      ' + l.trim().slice(0, 140)));
    continue;
  }
  const lines = out.trim().split(/\r?\n/);
  const summary = lines.filter(l => /passed|failed|通过|一致|PASS|预算内/.test(l));
  console.log('✓ ' + f.padEnd(28) + (summary[summary.length - 1] || lines[lines.length - 1] || '').trim().slice(0, 70));
}

console.log('\n共 ' + files.length + ' 个脚本，失败 ' + failed.length + ' 个' + (failed.length ? '：' + failed.join(', ') : ''));
process.exit(failed.length ? 1 : 0);

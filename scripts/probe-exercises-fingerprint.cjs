/**
 * scripts/probe-exercises-fingerprint.cjs —— 验证「动作库守卫不是安慰剂」
 *
 * 本项目通则：**先确认尺子能看见被测物，再报结论**。
 * 守卫最危险的失效方式是静默变成空操作（全仓 0 命中 → 输出绿灯），
 * 所以每个关键守卫都要有一把「已知违规」的探针。
 *
 * 做法：向 utils/exercises.js 末尾临时追加一段篡改代码（改字段 / 少一条 steps /
 * 删动作 / 换位），跑 verify-exercises-compact.cjs，断言它**必须亮红且定位到具体动作**，
 * 然后无论成败都在 finally 里还原，并复验还原后回到绿灯。
 *
 * ⚠️ 本脚本会**临时改写** utils/exercises.js 再还原。请勿在 devtools 正在编译时运行。
 * 用法： node scripts/probe-exercises-fingerprint.cjs
 * 退出码：0 = 四类篡改全部被抓到；1 = 存在盲区
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'utils', 'exercises.js');
const guard = path.join(root, 'scripts', 'verify-exercises-compact.cjs');

const original = fs.readFileSync(target, 'utf8');
const MUT = 'var _k=Object.keys(library)[0];';

const cases = [
  { name: '字段被改（首个动作 nameZh）', code: MUT + 'library[_k][0].nameZh="篡改测试";' },
  { name: 'steps 少一条（去掉第一步）', code: MUT + 'library[_k][0].steps=library[_k][0].steps.slice(1);' },
  { name: '动作被删（首个分类去掉末位）', code: MUT + 'library[_k].pop();' },
  { name: '动作被换位（顺序敏感）', code: MUT + 'var _t=library[_k][0];library[_k][0]=library[_k][1];library[_k][1]=_t;' }
];

function run() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}
const verdict = out => (out.split(/\r?\n/).find(l => /PASS|FAIL/.test(l)) || '').trim();
const firstIssue = out => (out.split(/\r?\n/).find(l => /^\s+·/.test(l)) || '').trim();

let allOk = true;
try {
  const base = run();
  console.log('基线（未篡改）: exit=' + base.code + '  ' + verdict(base.out));
  if (base.code !== 0) { console.log('✗ 基线就没过 —— 先修守卫，探针无意义'); process.exit(1); }

  for (const c of cases) {
    fs.writeFileSync(target, original + '\n' + c.code + '\n', 'utf8');
    const r = run();
    const caught = r.code === 1;
    if (!caught) allOk = false;
    console.log((caught ? '✓ 抓到' : '✗ 漏掉') + '  ' + c.name.padEnd(24) + '  ' + firstIssue(r.out).slice(0, 88));
    fs.writeFileSync(target, original, 'utf8');
  }
} finally {
  fs.writeFileSync(target, original, 'utf8');
}

const after = run();
console.log('还原后: exit=' + after.code + '  ' + verdict(after.out));
console.log('\n' + (allOk && after.code === 0
  ? 'PROBE OK —— 守卫对四类数据缺失均亮红，且还原后恢复绿灯'
  : 'PROBE FAIL —— 守卫存在盲区，请修 verify-exercises-compact.cjs'));
process.exit(allOk && after.code === 0 ? 0 : 1);

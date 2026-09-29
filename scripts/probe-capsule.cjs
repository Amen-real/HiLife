// scripts/probe-capsule.cjs —— 注入自检：把**真实文件**改成坏状态，确认守卫会红
//
// 为什么必须这么做（本仓通则④⑤）：
//   只跑一遍绿灯不构成「尺子能看见被测物」的证据 —— 一个恒真的断言也是绿灯。
//   只有「已知违规 → 必须红」+「已知良样本 → 必须绿」成对出现，绿灯才算数。
//
// ⚠️ 锚点一律**不含换行**：本仓换行符是混的（.wxml=LF，.js/.wxss=CRLF），
//   带 \n 的锚点在错误的那一侧会静默匹配失败 ⇒ 注入落空却报「通过」。
//   「注入失败」在这里按**错误**处理，不按跳过。
//
// 用法：node scripts/probe-capsule.cjs
// 刻意**不进** run-all-guards —— 它会临时改写源文件（同 probe-exercises*.cjs 的处理）；
// 聚合器只收录 ^(verify|test)-.*.cjs$ 与 scan-main-package，故不会误收。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, 'scripts', 'verify-top-inset.cjs');
const NODE = process.execPath;

const MUTATIONS = [
  { name: 'M1 结果态「完成」那一行去掉内缩',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<view class="r-nav" style="{{navInsetStyle}}">',
    to: '<view class="r-nav">' },
  { name: 'M2 历史态「清空」那一行去掉内缩',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<view class="h-nav" style="{{navInsetStyle}}">',
    to: '<view class="h-nav">' },
  { name: 'M3 取景态闪光灯那一行去掉内缩',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<cover-view class="cam-top" style="{{navInsetStyle}}">',
    to: '<cover-view class="cam-top">' },
  { name: 'M4 把兜底胶囊宽度改小（测不到胶囊的机型上就会重叠）',
    file: 'utils/navMetrics.js',
    from: 'const FALLBACK_CAPSULE_W = 96;',
    to: 'const FALLBACK_CAPSULE_W = 40;' },
  { name: 'M5 让 topRightInset 无视实测胶囊（退化成常量）',
    file: 'utils/navMetrics.js',
    from: '  const r = capsuleRect();',
    to: '  const r = null;' },
  { name: 'M6 页面 onLoad 不再注入内缩',
    file: 'pages/food-scan/food-scan.js',
    from: 'this.setData({ navInsetStyle: navMetrics.topRightStyle() });',
    to: 'this.setData({ navInsetStyle: \'\' });' }
];

function runGuard() {
  try {
    execFileSync(NODE, [GUARD], { cwd: ROOT, stdio: 'pipe' });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status || 1, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

let bad = 0;

// 基线：未改动时必须绿（否则后面的「变红」说明不了任何事）
const base = runGuard();
if (base.code !== 0) {
  bad++;
  console.log('✗ 基线不绿 —— 守卫本身有问题，注入自检无意义\n' + base.out);
} else {
  console.log('✓ 基线：未改动时守卫通过（fail=0）');
}

for (const m of MUTATIONS) {
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  const hits = orig.split(m.from).length - 1;
  if (hits !== 1) {
    bad++;
    console.log('✗ ' + m.name + ' —— 锚点命中 ' + hits + ' 次（应为 1）：' + JSON.stringify(m.from));
    continue;
  }
  fs.writeFileSync(p, orig.replace(m.from, m.to));
  let res;
  try { res = runGuard(); } finally { fs.writeFileSync(p, orig); }

  const restored = fs.readFileSync(p, 'utf8') === orig;
  if (!restored) { bad++; console.log('✗ ' + m.name + ' —— 还原失败，文件已被污染！'); continue; }

  if (res.code === 0) {
    bad++;
    console.log('✗ ' + m.name + ' —— 守卫仍报绿 ⇒ 这条断言是**假绿**（看不见被测物）');
  } else {
    const line = (res.out.match(/✗[^\r\n]*/) || ['(无 ✗ 行)'])[0];
    console.log('✓ ' + m.name + ' → 守卫变红：' + line.trim());
  }
}

// 收尾复核：所有还原后必须回到绿
const after = runGuard();
if (after.code !== 0) { bad++; console.log('✗ 还原后守卫不绿 —— 有毒残留\n' + after.out); }
else console.log('✓ 收尾：全部还原后守卫回到通过');

console.log('\n注入自检：' + (bad ? bad + ' 项异常' : MUTATIONS.length + '/' + MUTATIONS.length + ' 全部按预期变红'));
process.exit(bad ? 1 : 0);

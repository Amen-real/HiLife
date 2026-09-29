// scripts/probe-capsule.cjs —— 注入自检：把**真实文件**改成坏状态，确认守卫会红
//
// 为什么必须这么做（本仓通则④⑤）：
//   只跑一遍绿灯不构成「尺子能看见被测物」的证据 —— 一个恒真的断言也是绿灯。
//   只有「已知违规 → 必须红」+「已知良样本 → 必须绿」成对出现，绿灯才算数。
//
// ⚠️ 锚点一律**不含换行**：本仓换行符是混的（.wxml=LF，.js/.wxss=CRLF），
//   带 \n 的锚点在错误的那一侧会静默匹配失败 ⇒ 注入落空却报「通过」。
//   「注入失败」在这里按**错误**处理，不按跳过。
// ⚠️ 改 wxss 规则块时不能裸替换整行：`.cam-top` / `.h-nav` / `.r-nav` 三块里有
//   **逐字相同**的声明行（`height: 44px; box-sizing: border-box;`），裸锚点会命中 3 次。
//   ⇒ 用 mutateRuleBody() 先定位到「哪一个规则块」，再在块内替换。
//
// 用法：node scripts/probe-capsule.cjs
// 刻意**不进** run-all-guards —— 它会临时改写源文件（同 probe-exercises*.cjs 的处理）；
// 聚合器只收录 ^(verify|test)-.*\.cjs$ 与 scan-main-package，故不会误收。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(ROOT, 'scripts', 'verify-top-inset.cjs');
const NODE = process.execPath;

const RAW = [
  { name: 'M1 结果态「完成」那一行去掉样式串',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<view class="r-nav" style="{{navRowStyle}}">',
    to: '<view class="r-nav">' },
  { name: 'M2 历史态「清空」那一行去掉样式串',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<view class="h-nav" style="{{navRowStyle}}">',
    to: '<view class="h-nav">' },
  { name: 'M3 取景态那一行去掉样式串',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<cover-view class="cam-top" style="{{camRowStyle}}">',
    to: '<cover-view class="cam-top">' },
  { name: 'M4 取景态错挂流式串（覆盖层会失去 top，贴到屏幕最顶端）',
    file: 'pages/food-scan/food-scan.wxml',
    from: '<cover-view class="cam-top" style="{{camRowStyle}}">',
    to: '<cover-view class="cam-top" style="{{navRowStyle}}">' },
  { name: 'M5 导航带高退化成字面量 44（只有「胶囊顶−状态栏=6px」的机型才对）',
    file: 'utils/navMetrics.js',
    from: 'const h = 2 * (r.top - sbh) + r.height;',
    to: 'const h = 44;' },
  { name: 'M6 topRowStyle 丢掉 height（纵向对齐静默失效，只剩横向让位）',
    file: 'utils/navMetrics.js',
    from: "return 'height: ' + navBarHeight() + 'px; padding-right: '",
    to: "return 'padding-right: '" },
  { name: 'M7 把兜底胶囊宽度改小（测不到胶囊的机型上就会重叠）',
    file: 'utils/navMetrics.js',
    from: 'const FALLBACK_CAPSULE_W = 96;',
    to: 'const FALLBACK_CAPSULE_W = 40;' },
  { name: 'M8 让胶囊测量永远失败（退化成常量：横向不再让位、纵向不再同心）',
    file: 'utils/navMetrics.js',
    from: 'const r = wx.getMenuButtonBoundingClientRect();',
    to: 'const r = null;' },
  { name: 'M9 页面 onLoad 不再注入行样式',
    file: 'pages/food-scan/food-scan.js',
    from: 'this.setData({ navRowStyle: navMetrics.topRowStyle() });',
    to: "this.setData({ navRowStyle: '' });" }
];

// 规则块级替换：先确认「这个 class 的规则块」在文件里唯一，再在块内做替换。
const RULES = [
  { name: 'M10 .r-nav 丢掉 box-sizing:border-box（行内 height 变内容盒高，总高≠导航带）',
    file: 'pages/food-scan/food-scan.wxss',
    cls: 'r-nav', from: 'box-sizing: border-box;', to: '' },
  { name: 'M11 .r-nav 竖向 padding 回来了（内容被挤偏，不再居中）',
    file: 'pages/food-scan/food-scan.wxss',
    cls: 'r-nav', from: 'padding: 0 32rpx;', to: 'padding: 16rpx 32rpx;' },
  { name: 'M12 .cam-top 竖向 padding 回来了（取景态又变成手调常量摆位）',
    file: 'pages/food-scan/food-scan.wxss',
    cls: 'cam-top', from: 'padding: 0 36rpx;', to: 'padding: 90rpx 36rpx 0;' },
  { name: 'M13 .h-nav 丢掉 box-sizing:border-box',
    file: 'pages/food-scan/food-scan.wxss',
    cls: 'h-nav', from: 'box-sizing: border-box;', to: '' }
];

function runGuard() {
  try {
    execFileSync(NODE, [GUARD], { cwd: ROOT, stdio: 'pipe' });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status || 1, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

function mutateRuleBody(src, cls, from, to) {
  const count = (src.match(new RegExp('\\.' + cls + '\\s*\\{', 'g')) || []).length;
  if (count !== 1) return { err: '.' + cls + ' 的规则块命中 ' + count + ' 次（应为 1）' };
  const re = new RegExp('(\\.' + cls + '\\s*\\{)([^}]*)(\\})');
  const m = src.match(re);
  if (!m) return { err: '正则没匹配到 .' + cls + ' 规则块' };
  const hits = m[2].split(from).length - 1;
  if (hits !== 1) return { err: '.' + cls + ' 块内锚点命中 ' + hits + ' 次（应为 1）：' + JSON.stringify(from) };
  return { out: src.slice(0, m.index) + m[1] + m[2].replace(from, to) + m[3] + src.slice(m.index + m[0].length) };
}

let bad = 0;
const backup = new Map();
const files = new Set([...RAW.map((m) => m.file), ...RULES.map((m) => m.file)]);
for (const f of files) backup.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
const restore = () => { for (const [f, s] of backup) fs.writeFileSync(path.join(ROOT, f), s); };

try {
  // 基线：未改动时必须绿（否则后面的「变红」说明不了任何事）
  const base = runGuard();
  if (base.code !== 0) {
    bad++;
    console.log('✗ 基线不绿 —— 守卫本身有问题，注入自检无意义\n' + base.out);
  } else {
    console.log('✓ 基线：未改动时守卫通过（fail=0）');
  }

  const cases = RAW.map((m) => ({ ...m, apply: (src) => {
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return { err: '锚点命中 ' + hits + ' 次（应为 1）：' + JSON.stringify(m.from) };
    return { out: src.replace(m.from, m.to) };
  } })).concat(RULES.map((m) => ({ ...m, apply: (src) => mutateRuleBody(src, m.cls, m.from, m.to) })));

  for (const c of cases) {
    const p = path.join(ROOT, c.file);
    const orig = backup.get(c.file);
    const r = c.apply(orig);
    if (r.err) { bad++; console.log('✗ ' + c.name + ' —— ' + r.err); continue; }
    fs.writeFileSync(p, r.out);
    const res = runGuard();
    fs.writeFileSync(p, orig);

    if (res.code === 0) {
      bad++;
      console.log('✗ ' + c.name + ' —— 守卫仍报绿 ⇒ 这条断言是**假绿**（看不见被测物）');
    } else {
      const line = (res.out.match(/✗[^\r\n]*/) || ['(无 ✗ 行)'])[0];
      console.log('✓ ' + c.name + ' → 守卫变红：' + line.trim());
    }
  }
} finally {
  restore();
}

// 收尾复核：全部还原后必须回到绿
const stillDirty = [...backup.keys()].filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8') !== backup.get(f));
if (stillDirty.length) { bad++; console.log('✗ 还原不彻底，仍被污染：' + stillDirty.join(', ')); }
const after = runGuard();
if (after.code !== 0) { bad++; console.log('✗ 还原后守卫不绿 —— 有毒残留\n' + after.out); }
else console.log('✓ 收尾：全部还原后守卫回到通过');

const total = RAW.length + RULES.length;
console.log('\n注入自检：' + (bad ? bad + ' 项异常' : total + '/' + total + ' 全部按预期变红'));
process.exit(bad ? 1 : 0);

/**
 * verify-dark-theme.cjs —— 深色主题守卫（门禁版）
 *
 * 与 scan-dark-token-gaps.cjs 共用 scripts/lib/dark-contrast.cjs 的同一套判定，
 * 区别只在这里**失败即退出 1**，可挂到提交前/CI 上拦住回归。
 *
 * 守的是三类真实事故（本仓都发生过）：
 *   [A] 文字对比度不足 —— 典型是「成对 token 只翻了字侧」：
 *       action-detail 的标签是 --primary-tint 底 + --success 字；--success 翻成了亮绿
 *       (#C8FF00) 而 --primary-tint 没翻（仍是 #F2FFD6 极浅绿）→ 亮绿压浅绿 = 1.13:1，
 *       文字几乎消失。只翻一侧比完全不翻更糟。
 *       另一类是「硬编码色 × 会翻转的 token」错位：
 *       profile .dtile-ic 写死 #0A0A0A 字压 var(--card) 底，深色下 card 变 #161616
 *       → 墨字压近黑 = 1.09:1；action-detail .hero .badge 用 var(--white) 当字色
 *       （--white 在深色下是 #161616 卡面色）压恒定深色遮罩 → 1.05:1。
 *   [B] 浅色面未翻转 —— --glass / --glass-strong / --glass-border 根值是纯白，
 *       不重定义就在深色下渲染出白卡。cycle / food-vision 都漏过，
 *       而且这类规则常常没有 color，[A] 会把它当装饰豁免掉，必须单独守。
 *   [C] 反向红线：本守卫**不**要求把 --primary-ink 翻白。亮绿底上的 #0A0A0A
 *       （16.74:1）是刻意主题无关的，翻了会变成白字压亮绿 ≈1.3:1。守卫把这类判为豁免。
 *
 * 为什么浅色侧默认只报告、现已升为硬失败：
 *   浅色主题曾有一批历史遗留的低对比配色（同色系淡底 + 淡字、红字压红淡底等，
 *   最低到 2.31:1）。它们不是深色主题的回归，若一开始就一并拦死，本关会永远红着而被
 *   无视 —— 门禁一旦长期是红的就等于没有。所以先只**报告**，深色通道硬失败。
 *   2026-09-15 那批债已清完（22 处），门禁随之把浅色通道一并升为硬失败（默认）。
 *
 * 大字判定口径（2026-09-15 修正）：
 *   旧口径是「非粗体 ≥42rpx 或 只要 font-weight:700 就算大号」，把 20~26rpx 的粗体
 *   小标签也放行，漏报了 7 处真缺陷（.tpl-tag 4.38:1、.wo-set-del 浅 2.97/深 4.42 …）。
 *   现按 WCAG 2.1 SC 1.4.3：大号 = ≥24px（48rpx）常规，或 ≥18.66px（≈37rpx）粗体。
 *   字号写成 var(--fs-*) 时会查根 token 再折算，避免把真大号字当正文误伤。
 *
 * 豁免的写法：在 CSS 里给规则加 `/* @contrast-ok: 原因 *\/`。
 *   只允许用于「静态分析算不出来的纸底」（相机画面 / 视频遮罩 / 固定深色弹窗）与
 *   「WCAG 明示豁免」（disabled 控件 / 无字形）。原因必须写在源码里，可 review、可 grep。
 *
 * 用法： node scripts/verify-dark-theme.cjs [--report-light]
 *   默认两侧都硬失败（深色 + 浅色）；--report-light 只报告浅色侧，用于排查历史欠债。
 * 退出码：0 = 通过；1 = 存在缺口
 */
const path = require('path');
const dc = require('./lib/dark-contrast.cjs');

const ROOT = path.resolve(__dirname, '..');
const STRICT = !process.argv.includes('--report-light');
const r = dc.scanDarkGaps(ROOT);

const darkGaps = r.textGaps.filter(x => (x.failModes || []).includes('dark'));
const lightGaps = r.textGaps.filter(x => !(x.failModes || []).includes('dark'));
const fmt = x => x.file + ':' + x.line + '  ' + x.selector + (x.via ? '（宿主 ' + x.via + '）' : '');

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };

console.log('[A] 文字对比度 · 深色通道（WCAG：正文 ' + dc.MIN_TEXT + ':1 / 大号粗体 ' + dc.MIN_LARGE + ':1）');
if (!darkGaps.length) {
  ok('深色下无对比度缺口（合格 ' + r.ok + ' 处；豁免 ' + r.exDecor + ' 装饰 + ' + r.exChip +
    ' 亮底深字 + ' + r.annotated.length + ' 已声明）');
} else {
  for (const x of darkGaps) {
    bad(fmt(x) + '  深色 ' + x.Dbg + '/' + x.Dfg + ' = ' + (x.cD ? x.cD.toFixed(2) : '?') + ':1 < ' + x.min);
  }
  console.log('      ' + darkGaps.length + ' 处 —— 多为一对 token 只翻了一侧，请成对修');
}

console.log('\n[B] 浅色面 token 是否在深色下重定义');
if (!r.surfaceGaps.length) {
  ok('无未翻转的浅色面 token（' + dc.SURFACE_TOKENS.join(' / ') + '）');
} else {
  for (const x of r.surfaceGaps) {
    bad(fmt(x) + ' 用了 ' + x.token + ' 但深色块没重定义 → 深色下是白卡');
  }
}

console.log('\n[C] 声明式豁免备案（源码里的 @contrast-ok）');
if (r.annotated.length) {
  ok(r.annotated.length + ' 处已声明豁免，原因均在 CSS 源文件内');
  for (const a of r.annotated) console.log('      · ' + fmt(a) + ' → ' + a.reason);
} else {
  console.log('  · 无（没有豁免也属正常）');
}

console.log('\n[D] 品牌亮底 + 墨字（刻意不翻的反向红线）');
if (r.exChip > 0) {
  ok('存在 ' + r.exChip + ' 处「品牌亮底 + 墨色字」，判为豁免 —— 禁止把它们翻成白字（会掉到 ~1.3:1）');
} else {
  console.log('  · 本次未覆盖到该用例（正常，取决于当前页面结构）');
}

console.log('\n[E] 浅色通道（默认硬拦）');
if (!lightGaps.length) {
  ok('浅色下无对比度缺口');
} else if (STRICT) {
  for (const x of lightGaps) {
    bad(fmt(x) + '  浅色 ' + x.Lbg + '/' + x.Lfg + ' = ' + (x.cL ? x.cL.toFixed(2) : '?') + ':1 < ' + x.min);
  }
} else {
  const byFile = new Map();
  for (const x of lightGaps) byFile.set(x.file, (byFile.get(x.file) || 0) + 1);
  console.log('  ⚠ ' + lightGaps.length + ' 处浅色侧低对比（--report-light，未计入判定）：' +
    [...byFile].map(([f, n]) => f.split('/').pop() + '×' + n).join(', '));
}

console.log(`\n${fail ? '✗' : '✓'} verify-dark-theme: ${pass} passed, ${fail} failed` +
  (STRICT ? '' : '（--report-light）'));
process.exit(fail ? 1 : 0);

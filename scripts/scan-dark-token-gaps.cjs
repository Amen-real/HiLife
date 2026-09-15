/**
 * scan-dark-token-gaps.cjs —— 深色主题缺口扫描（report-only，不修改任何文件）
 *
 * 判定标准全部在 scripts/lib/dark-contrast.cjs，与守卫 verify-dark-theme.cjs 共用同一份，
 * 保证「扫描器说没问题」和「守卫放行」永远是一回事。
 *
 * 判定不看「token 有没有翻转」这种启发式（它会产出**危险的假阳性**：逼你把亮绿按钮上的
 * #0A0A0A 翻成白色，白字压亮绿只有 1.3:1，比不改还糟），而是算**实际渲染的对比度**：
 *   [A] 文字对比度 —— 取规则的 background/color，无 background 时向上找最近有底色的祖先，
 *       rgba 底色按压在 paper 上合成（paper 自身半透明时先压到页面底），再算 WCAG；
 *       正文 4.5:1、大号粗体 3:1。自动豁免两类主题无关的情形：无文字的纯装饰、
 *       亮底深字的品牌芯片（--primary/--primary-light 底 + 墨色字）。
 *   [B] 浅色面未翻转 —— --glass* 这类根值是白色的「面」token，在深色块没重定义
 *       （且没有 .theme-dark 规则直接用字面色覆盖同一元素）就是白卡，与文字无关。
 *       为什么单独一关：白卡规则常常整条没有 color，会被 [A] 判成「装饰」而漏掉。
 *
 * 组件作用域：组件不能自己写 .page.theme-dark，深色值取决于宿主页；本脚本会反查宿主逐个算
 *   —— 同一段组件 CSS 在一个宿主合格、另一个宿主不合格是可能的（本仓曾经如此）。
 *
 * 用法： node scripts/scan-dark-token-gaps.cjs
 * 退出码：恒为 0（report-only；要门禁请用 verify-dark-theme.cjs）
 */
const path = require('path');
const dc = require('./lib/dark-contrast.cjs');

const ROOT = path.join(__dirname, '..');
const r = dc.scanDarkGaps(ROOT);

console.log('=== 深色主题缺口扫描 ===');
console.log('  阈值：正文 ' + dc.MIN_TEXT + ':1 / 大号粗体 ' + dc.MIN_LARGE + ':1\n');

console.log('[A] 文字对比度');
if (!r.textGaps.length) {
  console.log('  ✓ 无真实缺口\n');
} else {
  const byKey = new Map();
  for (const x of r.textGaps) {
    const k = x.file + (x.via ? '  （宿主 ' + x.via + '）' : '');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(x);
  }
  for (const [k, list] of byKey) {
    console.log('  ' + k);
    for (const x of list) {
      console.log('      ' + String(x.line).padStart(4) + '  ' + x.selector);
      console.log('            底/字：' + (x.bgRaw || '继承祖先') + '  /  ' + x.fgRaw);
      console.log('            浅色 ' + x.Lbg + '/' + x.Lfg + ' → ' + (x.cL ? x.cL.toFixed(2) : '—') + ':1' +
        '    深色 ' + x.Dbg + '/' + x.Dfg + ' → ' + (x.cD ? x.cD.toFixed(2) : '—') + ':1');
      console.log('            ★ 不达标主题：' + (x.failModes || []).join(' + ') + '（阈值 ' + x.min + ':1）');
    }
    console.log('');
  }
}

console.log('[A2] 已声明豁免（源码里写了 @dark-ok 及原因）');
if (!r.annotated.length) {
  console.log('  ✓ 无\n');
} else {
  for (const x of r.annotated) {
    console.log('  ' + x.file + (x.via ? '  （宿主 ' + x.via + '）' : '') + ':' + x.line + '  ' + x.selector);
    console.log('      ' + x.reason);
  }
  console.log('');
}

console.log('[B] 浅色面 token（--glass* 等）是否在深色下重定义');
if (!r.surfaceGaps.length) {
  console.log('  ✓ 无未翻转的浅色面 token\n');
} else {
  for (const x of r.surfaceGaps) {
    console.log('  ' + x.file + (x.via ? '  （宿主 ' + x.via + '）' : '') + ':' + x.line);
    console.log('      ' + x.selector + '  用了 ' + x.token + ' 但深色块没重定义');
    console.log('      → 深色下会渲染出浅色面（白卡 / 浅灰描边）');
  }
  console.log('');
}

console.log('---');
console.log('  [A] 合格 ' + r.ok + ' / 豁免·装饰 ' + r.exDecor + ' / 豁免·品牌亮底深字 ' + r.exChip +
  ' / 已声明豁免 ' + r.annotated.length + ' / 缺口 ' + r.textGaps.length + ' 处');
console.log('  [B] 浅色面未翻转 ' + r.surfaceGaps.length + ' 处');
console.log('\n  提示：豁免的三类都不该再动 —— 装饰/品牌亮底是主题无关；@dark-ok 是纸底算不出来时的');
console.log('        显式声明（原因写在 CSS 里，不是为了消警告）。改前请先跑 check-dark-contrast.cjs 核对成对翻转。');

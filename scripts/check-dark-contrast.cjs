/**
 * check-dark-contrast.cjs —— 深色主题「真实对比度」核算（人工精选点 + 成因批注）
 *
 * 与 scan-dark-token-gaps.cjs 的分工：
 *   · scan-* 全仓自动发现候选点（广度优先，不需要维护清单）
 *   · check-* 只盯**已知的、曾经出过事或容易被误改的**点（深度优先，每条带成因批注）
 *   两者共用 scripts/lib/dark-contrast.cjs 的分析底座，判定标准完全一致。
 *
 * 对「安全」案例的批注特别重要 —— 本仓最容易犯的错是**照着扫描报告做正确的事、结果砸坏对比度**：
 *   .btn-primary { background: var(--primary); color: var(--primary-ink); }
 * 是「亮绿底 + #0A0A0A 字」= 16.74:1，两种主题下都成立且**必须保持不变**。
 * 若在深色块把 --primary-ink 翻成白色，就变成白字压亮绿 ≈1.3:1，比不改还糟。
 * 所以每条豁免都写明「为什么不动」。
 *
 * 用法： node scripts/check-dark-contrast.cjs
 * 退出码：0 = 无真实失败；1 = 存在真实对比度失败（可接 CI）
 */
const fs = require('fs');
const path = require('path');
const dc = require('./lib/dark-contrast.cjs');

// ---------- 待核查点 ----------
// paper：该元素实际压在什么底上（无 background 声明时用于 rgba 合成）
// darkFrom：深色 token 从哪个文件读。组件不能自己写 .page.theme-dark（组件样式有作用域，
//   选不中宿主页根节点），所以组件的深色值必须从**宿主页**解析；一个组件被多页用就要各列一条。
const SPOTS = [
  // —— 成对翻转的正例：补过缺口的点 ——
  { file: 'pages/action-detail/action-detail.wxss', sel: '.title-block .tag', paper: 'var(--card)', note: '浅绿底标签：--primary-tint 与 --success-text 必须成对翻（只翻字侧会更糟，实测 1.13:1）' },
  { file: 'pages/food-vision/food-vision.wxss', sel: '.mock-tip', paper: 'var(--card)', note: '橙色提示条：--accent-soft 与 --accent-ink 成对翻' },
  { file: 'pages/food-vision/food-vision.wxss', sel: '.seg-item.on', paper: 'var(--card)', note: '选中段：原为亮绿字压白底（浅色下就 1.18:1），改用 --n-900 随卡面自动翻' },
  { file: 'pages/cycle/cycle.wxss', sel: '.prog-week', paper: 'var(--glass-strong)', note: '循环页进度字：压在 --glass-strong 卡面上，卡面不翻会变白卡' },
  // —— 必须保持不动的自洽品牌组合 ——
  { file: 'pages/action-detail/action-detail.wxss', sel: '.tip .num-circle', paper: 'var(--card)', note: '亮绿圆底 + 墨字：主题无关，禁止翻转 --primary-ink' },
  { file: 'pages/action-detail/action-detail.wxss', sel: '.muscle .m-tag.primary', paper: 'var(--card)', note: '亮绿标签 + 墨字：同上' },
  { file: 'pages/action-detail/action-detail.wxss', sel: '.btn-primary.add-today', paper: 'var(--card)', note: '亮绿主按钮 + 墨字：同上（16.74:1）' },
  { file: 'pages/train-detail/train-detail.wxss', sel: '.act-sets', paper: 'var(--card)', note: '亮绿徽章 + 橄榄字：亮底橄榄字 5.01:1，两主题通用，勿翻' },
  { file: 'pages/food-vision/food-vision.wxss', sel: '.scan', paper: 'var(--card)', note: '扫码区亮绿底 + 橄榄字：5.01:1 两主题通用；翻 --primary-text 会砸坏它' },
  // —— 纯装饰（无文字，不存在可读性问题） ——
  { file: 'pages/favorites/favorites.wxss', sel: '.action-thumb', paper: 'var(--card)', note: '缩略图占位渐变：无文字' },
  { file: 'pages/profile/profile.wxss', sel: '.goal-fill', paper: 'var(--card)', note: '目标进度条渐变：无文字' },
  // —— 组件 × 各宿主页：同一段 CSS，深色值取决于宿主定义了哪些 token ——
  { file: 'components/training-review/training-review.wxss', sel: '.verdict', paper: 'var(--card)', darkFrom: 'pages/list/list.wxss', note: '结论条（组件 × list 宿主）' },
  { file: 'components/training-review/training-review.wxss', sel: '.verdict', paper: 'var(--card)', darkFrom: 'pages/review/review.wxss', note: '结论条（组件 × review 宿主）' },
  { file: 'components/training-review/training-review.wxss', sel: '.ka-pick', paper: 'var(--card)', darkFrom: 'pages/list/list.wxss', note: '关键动作选择（组件 × list 宿主）' },
  { file: 'components/training-review/training-review.wxss', sel: '.ka-pick', paper: 'var(--card)', darkFrom: 'pages/review/review.wxss', note: '关键动作选择（组件 × review 宿主）' }
];

function ruleIn(css, sel) {
  return dc.rules(css).find(r => r.selector === sel) || null;
}

console.log('=== 深色主题真实对比度核算（精选点）===\n');

const root = dc.tokensIn(fs.readFileSync(path.join(__dirname, '..', 'app.wxss'), 'utf8'));
let okCount = 0, exemptDeco = 0, exemptChip = 0, fails = 0;

for (const s of SPOTS) {
  const abs = path.join(__dirname, '..', s.file);
  if (!fs.existsSync(abs)) { console.log('  ? 文件不存在：' + s.file); continue; }
  const css = fs.readFileSync(abs, 'utf8');
  const rule = ruleIn(css, s.sel);
  if (!rule) { console.log('  ? 找不到规则 ' + s.sel + '（' + s.file + '）'); continue; }

  const darkCss = s.darkFrom ? fs.readFileSync(path.join(__dirname, '..', s.darkFrom), 'utf8') : css;
  const dark = Object.assign({}, root, dc.darkTokensOf(darkCss));

  const a = dc.analyzeRule(rule.body, root, dark, s.paper);

  let verdict;
  if (a.verdict === 'exempt-decoration') { verdict = '豁免·装饰（无文字）'; exemptDeco++; }
  else if (a.verdict === 'exempt-brand-chip') { verdict = '豁免·亮底深字（主题无关，翻任一侧都会砸坏）'; exemptChip++; }
  else if (a.verdict === 'ok') { verdict = 'OK'; okCount++; }
  else { verdict = '★ 真实失败：深色下 ' + a.cD.toFixed(2) + ':1 < ' + a.min; fails++; }

  console.log('  ' + (a.verdict === 'fail' ? '✗' : '·') + ' ' + s.sel + '  —— ' + s.note + (s.darkFrom ? '  ← 深色值取自 ' + s.darkFrom : ''));
  console.log('      ' + s.file + ':' + rule.line);
  console.log('      浅色 底 ' + dc.hex(a.L.bg) + ' / 字 ' + dc.hex(a.L.fg) + ' → ' + (a.cL ? a.cL.toFixed(2) : '—') + ':1');
  console.log('      深色 底 ' + dc.hex(a.D.bg) + ' / 字 ' + dc.hex(a.D.fg) + ' → ' + (a.cD ? a.cD.toFixed(2) : '—') + ':1' + (a.fgRaw ? '  (阈值 ' + a.min + ')' : ''));
  console.log('      → ' + verdict + '\n');
}

console.log('---');
console.log('  OK ' + okCount + ' / 豁免·装饰 ' + exemptDeco + ' / 豁免·亮底深字 ' + exemptChip + ' / 真实失败 ' + fails);
process.exit(fails ? 1 : 0);

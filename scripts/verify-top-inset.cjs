// scripts/verify-top-inset.cjs —— 「顶部可控性」回归守卫（2026-09-29）
//
// 起因（真机）：识别结果页的「返回 / 完成」位置全在最上方，被手机状态栏挡住、点不到。
//
// 根因不在按钮，在**那一段本该撑开 44px 的状态栏占位被压成了 ~0**：
//   · 全仓 16 个页面都是 navigationStyle:custom，顶部内边距得自己撑；
//   · 13 个页面用 <nav-bar> 组件，它的 .nb-fixed 是 position:fixed ⇒ 天然免疫压缩；
//   · 手写占位块的只有 home / profile / food-scan；
//   · home 的 .page-body、profile 的 .p-hero-body 都只是普通块级流 ⇒ 侥幸没事；
//   · **只有 food-scan 的占位块落在 display:flex;flex-direction:column 里**（.result / .hist），
//     而 flex 子项默认 flex-shrink:1 ⇒ 容器一溢出，它就被按「shrink × 尺寸」分摊压缩。
//   · 溢出来自兄弟节点：.r-scroll 是 scroll-view，没有 min-height:0 时它会按**内容**高度
//     撑开、顶破 .result（position:absolute 定高），负空间于是全摊到占位块/导航行头上。
//
// 所以这里守的是两条**配对**的不变量（缺一不可）：
//   [B] 顶部占位块不许可压缩；
//   [C] 定高纵向 flex 容器里的 scroll-view 必须能收缩（min-height:0 或显式 height）。
//
// 覆盖：[A] 自定义导航页必须有顶部占位机制
//       [B] 手写占位块必须显式不可压缩
//       [C] 定高 flex 纵向容器里的 scroll-view 必须能收缩
//       [D] 行为：stub wx 跑真实 onLoad，占位块真的拿到状态栏高度
//       [G] 顶部行的**靠右控件**必须为微信系统胶囊（「··· ⊙」）预留右侧内缩（横向：不许重叠）
//       [H] 顶部行的行高必须按胶囊实测算 ⇒ 行中心 == 胶囊中心（纵向：必须对齐）
//       [D] 行为：stub wx 跑真实 onLoad，占位块拿到真实状态栏高度、两串行内样式真的被注入
// 用法：node scripts/verify-top-inset.cjs
//
// ── [G] 的由来（2026-09-29，紧接 [A]~[C] 修完之后） ──────────────────────
// 把顶部从状态栏里救出来之后，暴露了**下一个**遮挡者：微信系统胶囊。
// 它是微信自己渲染的，不进布局树、不参与 flex、z-index 也压不住 ⇒
// 页面把控件摆进它那一格，触摸就被系统截走，按钮**完全点不到**。
// 几何关键：[胶囊贴屏幕右缘] ⇒ 只要控件右边界在胶囊左边界之左就永远不重叠，
// **与纵向位置无关**。所以解法是横向让位，且内缩量必须实测（胶囊宽度随机型变化）。
// 全仓现状：只有 food-scan 一页把控件放进了这一格（取景态闪光灯 / 结果态「完成」/
// 历史态「清空」），三处都必须接上 utils/navMetrics.js。
// 2026-10-12 补：home 品牌行没有靠右控件，但同样落在胶囊纵向带里、按同一套接上 navRowStyle
// —— 理由是**纵向同心**（[H]），不是横向让位（[G]）。profile 大标题行同日接过又撤掉
// （钉齐只换来 ~4px 位移、收益不抵 wrapper 复杂度，回归为手调摆位），故本段不列 profile。
// 「没有右侧控件」不构成不接的理由：那正是 2026-10-12 之前的样子（手调 rpx 摆位、品牌名偏 ~8px）。
//
// ── [H] 的由来（同日，用户第二轮真机报障） ──────────────────────────────
// 「取景页的返回/闪光灯、结果页的返回/完成没有**对齐**微信自带胶囊」。
// 注意这与 [G] 是**两件事、两个方向**：不重叠是横向的，对齐是**纵向**的。
// 根因还是同一类病 —— 又拿手调 rpx 常量摆位，谁也跟不上胶囊：
//   · 取景态 `padding: 90rpx 36rpx 0` ⇒ 内容中线 65.5px、胶囊中线 69px ⇒ 按钮**偏上 3.5px**；
//   · 结果/历史态行高含 16rpx 上下 padding（49.9px ≠ 导航带 44px）⇒ 按钮**偏下 3.0px**。
// 解法：行高 = 导航带 = 2×(胶囊上沿 − 状态栏) + 胶囊高 ⇒ 行中心恒定 == 胶囊中心。
// ⚠️ 不能用字面量 44：它只在「胶囊顶 − 状态栏 = 6px」时成立，而该差值随机型变。
// ⚠️ 另有两处**联动陷阱**（H11/H12 盯着）：行内 height 必须配 `box-sizing:border-box`，
//    且该行**竖向 padding 必须为 0** —— 否则算得再对，总高也不是导航带、内容也不居中。
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok() { pass++; }
function bad(m) { fail++; console.log('  ✗ ' + m); }
function eq(a, e, l) { if (a === e) ok(); else bad(l + '：期望 ' + JSON.stringify(e) + '，实际 ' + JSON.stringify(a)); }
function truthy(v, l) { if (v) ok(); else bad(l); }
function has(hay, needle, l) { if (String(hay).indexOf(needle) >= 0) ok(); else bad(l + ' → 未找到 ' + JSON.stringify(needle)); }

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripCss = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '');
const stripWxml = (s) => String(s).replace(/<!--[\s\S]*?-->/g, '');

/* ── 规则解析：class → 该 class 全部规则体（拼成一条串） ──
   不展开嵌套选择器：本文件只关心「这个 class 上声明了什么」，够用且不会误判。 */
function rulesOf(wxssText) {
  const src = stripCss(wxssText);
  const map = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[2].replace(/\s+/g, ' ').trim();
    const classes = (m[1].match(/\.([a-zA-Z0-9_-]+)/g) || []).map((s) => s.slice(1));
    for (const c of classes) {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(body);
    }
  }
  return map;
}
const bodyOf = (map, cls) => (map.get(cls) || []).join(' ; ');

/* 「不可压缩」的唯一判据。抽成纯函数，才能喂好坏样本证明它不是恒真/恒假。 */
function isNonShrinkable(body) {
  const b = String(body);
  if (/flex-shrink\s*:\s*0(\s|;|$)/.test(b)) return true;
  if (/flex\s*:\s*none(\s|;|$)/.test(b)) return true;
  if (/flex\s*:\s*0\s+0(\s|;|$)/.test(b)) return true;
  return false;
}

/* 「这个 scroll-view 能不能把超出部分收进自己内部」。
   ⚠️ 注意与下面的 isFixedHeightFlexColumn 是**相反**的两件事，别合并：
     · 容器身上的 max-height ⇒ 制造溢出（危险，见下）；
     · scroll-view 自己身上的 max-height ⇒ 自我封顶，溢出进不来（安全）。
   任一条成立就算安全：min-height:0（把空间让出来、内部滚动）／显式 height／自身 max-height。 */
function scrollCanAbsorb(body) {
  const decls = String(body).split(';').map((s) => s.trim()).filter(Boolean);
  for (const d of decls) {
    const mm = d.match(/^([a-z-]+)\s*:\s*(.+)$/);
    if (!mm) continue;
    const prop = mm[1], val = mm[2].trim();
    if (prop === 'height' && val !== 'auto') return true;
    if (prop === 'max-height' && val !== 'none') return true;
    if (prop === 'min-height' && /^0(px|rpx|em|rem|%)?$/.test(val)) return true;
  }
  return false;
}

/* 纵向 flex 且**定高**（内容撑不下也不会长高）。定高是「必须分出谁能被压」的前提：
   容器能长高时，压根不会产生负空间，也就压不到谁。 */
function isFixedHeightFlexColumn(body) {
  const b = String(body);
  if (!/display\s*:\s*flex/.test(b)) return false;
  if (!/flex-direction\s*:\s*column/.test(b)) return false;
  if (/(^|[;\s])height\s*:\s*(?!auto)[^;]+/.test(b)) return true;         // 显式 height
  if (/(^|[;\s])max-height\s*:\s*[^;]+/.test(b)) return true;             // max-height 封顶
  if (/position\s*:\s*(absolute|fixed)/.test(b) &&
      /top\s*:\s*[^;]+/.test(b) && /(bottom\s*:\s*[^;]+|height\s*:\s*[^;]+)/.test(b)) return true;
  return false;
}

/* ── wxml 轻量解析：给每个 <scroll-view> 找最近的祖先 <view> class ──
   注释必须先剥，否则被注释掉的整块结构会把栈搞乱。 */
function scrollViewsWithParent(wxmlText) {
  const src = stripWxml(wxmlText);
  const stack = [];
  const out = [];
  const tagRe = /<(\/?)([a-zA-Z-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const closing = m[1] === '/', tag = m[2], attrs = m[3], selfClose = m[4] === '/' || tag === 'image' || tag === 'input';
    if (!closing) {
      const cm = attrs.match(/class="([^"]*)"/);
      const cls = cm ? cm[1].trim().split(/\s+/).filter(Boolean) : [];
      if (tag === 'scroll-view') out.push({ cls, parent: stack.length ? stack[stack.length - 1] : null });
      if (!selfClose) stack.push(cls);
    } else if (stack.length) {
      stack.pop();
    }
  }
  return out;
}

const PAGES = fs.readdirSync(path.join(ROOT, 'pages'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);
const jsonOf = (p) => { try { return JSON.parse(read('pages/' + p + '/' + p + '.json')); } catch (e) { return null; } };
const pj = (p) => jsonOf(p) || {};
const wxmlOf = (p) => read('pages/' + p + '/' + p + '.wxml');
const rulesMapOf = (p) => rulesOf(read('pages/' + p + '/' + p + '.wxss'));

/* ═══════════ [A] 自定义导航页必须自己撑出顶部内边距 ═══════════ */
console.log('[A] navigationStyle:custom 的页面必须有顶部占位机制');
const customPages = PAGES.filter((p) => pj(p).navigationStyle === 'custom');
truthy(customPages.length >= 10, 'A1 抽到 ' + customPages.length + ' 个自定义导航页（样本量正常，抽不到说明 json 写法变了）');
{
  const missing = [];
  for (const p of customPages) {
    const w = stripWxml(wxmlOf(p));
    // 两条合法路径：nav-bar 组件（内部 position:fixed），或手写状态栏占位块
    if (!/<nav-bar[\s/>]/.test(w) && !/style="\{\{statusBarStyle\}\}"/.test(w)) missing.push(p);
  }
  eq(missing.length, 0, 'A2 每个自定义导航页都要撑出状态栏高度，否则顶部内容被系统状态栏压住'
    + (missing.length ? ' → 缺 ' + missing.join(', ') : ''));
}

/* ═══════════ [B] 手写状态栏占位块必须不可压缩 ═══════════ */
console.log('[B] 手写占位块不许可压缩（flex 子项默认 shrink:1，容器一溢出就被压成 0）');
/* 尺子自检先行：判据本身必须先证明不是恒真/恒假。 */
eq(isNonShrinkable('width: 100%;'), false, 'B1 尺子自检：只有 width → 判「可压缩」（出事的写法）');
eq(isNonShrinkable('width: 100%; flex: 0 0 auto;'), true, 'B2 尺子自检：flex:0 0 auto → 不可压缩');
eq(isNonShrinkable('flex: none;'), true, 'B3 尺子自检：flex:none → 不可压缩');
eq(isNonShrinkable('flex-shrink: 0;'), true, 'B4 尺子自检：flex-shrink:0 → 不可压缩');
eq(isNonShrinkable('width:100%; flex: 1 1 auto;'), false, 'B5 尺子自检：flex:1 1 auto → 仍判「可压缩」（判据不是恒 true）');

const spacerSites = [];
for (const p of customPages) {
  const w = stripWxml(wxmlOf(p));
  const re = /<view[^>]*class="([^"]*)"[^>]*style="\{\{statusBarStyle\}\}"/g;
  let m;
  while ((m = re.exec(w))) spacerSites.push({ page: p, classes: m[1].trim().split(/\s+/).filter(Boolean) });
}
truthy(spacerSites.length >= 3, 'B6 找到 ' + spacerSites.length + ' 处手写占位块（应为 home / profile / food-scan）');
{
  const notPinned = [];
  for (const s of spacerSites) {
    const map = rulesMapOf(s.page);
    const body = s.classes.map((c) => bodyOf(map, c)).join(' ; ');
    if (!body) { notPinned.push(s.page + ' .' + s.classes.join('.') + '（wxss 里没有规则）'); continue; }
    if (!isNonShrinkable(body)) notPinned.push(s.page + ' .' + s.classes.join('.'));
  }
  eq(notPinned.length, 0, 'B7 每个手写占位块都要显式钉死不可压缩（flex:0 0 auto / flex:none / flex-shrink:0）'
    + (notPinned.length ? ' → 未钉死 ' + notPinned.join(', ') : ''));
}

/* ═══════════ [C] 定高纵向 flex 容器里的 scroll-view 必须能收缩 ═══════════ */
console.log('[C] 定高纵向 flex 里的 <scroll-view> 要能收缩，否则它会顶破容器、把兄弟按比例压掉');
eq(scrollCanAbsorb('flex: 1; padding: 0;'), false, 'C1 尺子自检：只有 flex:1 → 判「收不住」（就是 food-scan 出事的写法）');
eq(scrollCanAbsorb('flex: 1; min-height: 0;'), true, 'C2 尺子自检：min-height:0 → 判「收得住」');
eq(scrollCanAbsorb('flex: 1; height: 64vh;'), true, 'C3 尺子自检：显式 height → 判「收得住」');
eq(scrollCanAbsorb('flex: 1 1 auto; min-height: 120rpx; max-height: 38vh;'), true, 'C4 尺子自检：自身 max-height 自我封顶 → 判「收得住」（plan / training 就是这种，不能误报）');
eq(isFixedHeightFlexColumn('display: flex; flex-direction: column;'), false, 'C5 尺子自检：不定高的纵向 flex 不算（容器能长高就不会压谁）');
eq(isFixedHeightFlexColumn('display: flex; flex-direction: column; max-height: 80vh;'), true, 'C6 尺子自检：**容器**身上的 max-height 算定高（制造溢出）');
eq(isFixedHeightFlexColumn('position:absolute;top:0;bottom:0;display:flex;flex-direction:column;'), true, 'C7 尺子自检：absolute 上下都钉住的纵向 flex 算');
// 父子两侧语义相反，必须留一条断言把这件事钉住，防止后人「顺手统一」成同一个判据
truthy(scrollCanAbsorb('max-height: 56vh;') && isFixedHeightFlexColumn('display:flex;flex-direction:column;max-height:56vh;'),
  'C8 尺子自检：同一个 max-height 在子（收得住）与父（制造溢出）两侧语义相反 —— 不可合并判据');

{
  const offenders = [];
  const examined = [];
  for (const p of customPages) {
    const map = rulesMapOf(p);
    for (const sv of scrollViewsWithParent(wxmlOf(p))) {
      if (!sv.cls.length) continue;
      const body = sv.cls.map((c) => bodyOf(map, c)).join(' ; ');
      if (!body) continue;
      const grows = /\bflex\s*:\s*[1-9]/.test(body) || /flex-grow\s*:\s*[1-9]/.test(body);
      if (!grows) continue;
      if (!sv.parent || !sv.parent.length) continue;
      const parentBody = sv.parent.map((c) => bodyOf(map, c)).join(' ; ');
      if (!parentBody) continue;
      if (!isFixedHeightFlexColumn(parentBody)) continue;
      examined.push(p + ' .' + sv.cls.join('.') + ' ⊂ .' + sv.parent.join('.'));
      if (!scrollCanAbsorb(body)) offenders.push(p + ' .' + sv.cls.join('.') + ' ⊂ .' + sv.parent.join('.'));
    }
  }
  // 尺子能看见被测物：至少应识别出 food-scan 的两处（历史上就是它们出的问题）
  truthy(examined.length >= 2, 'C9 识别到 ' + examined.length + ' 处「定高 flex 纵向容器内的可撑满 scroll-view」'
    + (examined.length ? '：' + examined.join(' | ') : '（一处都没识别到 ⇒ 解析器或扫描范围失效，后面那条绿灯不算数）'));
  eq(offenders.length, 0, 'C10 这些 scroll-view 必须能收住溢出（min-height:0 / 显式 height / 自身 max-height），否则容器溢出时被压的是兄弟节点（顶部返回/关闭按钮会点不到）'
    + (offenders.length ? ' → 缺 ' + offenders.join(' , ') : ''));
}

/* ═══════════ [G] 顶部行靠右控件必须给微信系统胶囊让位 ═══════════ */
console.log('[G] 顶部行的靠右控件必须为系统胶囊（「··· ⊙」）预留右侧内缩');
/* 用可注入的假 wx 驱动**真实模块** utils/navMetrics.js —— 
   只验「模块里有没有那句话」不算验，得让它在两种环境下各跑一次看返回值。 */
function withWx(fake, fn) {
  const prev = global.wx;
  const had = Object.prototype.hasOwnProperty.call(global, 'wx');
  global.wx = fake;
  try { return fn(); } finally { if (had) global.wx = prev; else delete global.wx; }
}
const navMetrics = require(path.join(ROOT, 'utils', 'navMetrics.js'));

const RECT = { left: 296, right: 383, width: 87, top: 53, bottom: 85, height: 32 };
const G1 = withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }),
                    getMenuButtonBoundingClientRect: () => RECT }, () => navMetrics.topRightInset());
const G2 = withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }) },
                  () => navMetrics.topRightInset());
// 实测分支：胶囊左缘距屏右 390-296=94，加呼吸间隙 8 ⇒ 102
eq(G1, 102, 'G1 实测分支：内缩 = 屏右→胶囊左缘(94) + 间隙(8) = 102px');
// 兜底分支：API 不存在（低版本基础库 / 测试环境）也不许返回 0 / NaN / undefined
truthy(Number.isFinite(G2), 'G2 测不到胶囊时返回值必须是有限数（不许 NaN/undefined，否则 style 串会写出 "padding-right: NaNpx"）');
truthy(G2 >= 100, 'G3 兜底值不得小于常见胶囊宽+右边距（实测 ' + G2 + 'px）—— 兜底偏小 = 在测不到胶囊的机型上照样重叠');
// 尺子自检：**证明它不是恒返回同一个数**，否则 G1/G2 是一对假绿
truthy(G1 !== G2, 'G4 尺子自检：实测分支与兜底分支给出的值不同（' + G1 + ' vs ' + G2 + '）⇒ 判据真的读了胶囊，不是常量');
eq(withWx({ getWindowInfo: () => ({ windowWidth: 390 }), getMenuButtonBoundingClientRect: () => ({}) },
          () => navMetrics.topRightInset()), G2, 'G5 胶囊返回空对象时也必须走兜底（不能算出 NaN）');
has(withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }), getMenuButtonBoundingClientRect: () => RECT },
           () => navMetrics.topRowStyle()), 'padding-right: 102px',
  'G6 topRowStyle 含 padding-right: 102px（长写覆盖简写的一侧，不动该行其它 padding）');
has(withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }), getMenuButtonBoundingClientRect: () => RECT },
           () => navMetrics.overlayRowStyle()), 'top: 47px',
  'G6b overlayRowStyle 必须自带 top（覆盖层脱离文档流，没有 top 就会贴在屏幕最顶端、压进状态栏）');

{
  /* 顶部行都接上了样式串。⚠️ 这里刻意**逐个列名 + 逐行核对绑定名**，而不是
     「页面上出现过 navRowStyle 就算过」—— 后者会让「只接了一处」或「覆盖层错挂了流式串」
     这类漏网写法照样绿灯。现有四处分两页、形态还分两类：流式行 vs 绝对定位覆盖层。
     home 品牌行（纵向同心 [H]）2026-10-12 接入；profile 大标题行同日接入后又撤掉
     （钉齐只换 ~4px 位移，回归手调摆位），故此处不列 profile。 */
  const SITES = [
    ['food-scan', 'cam-top', 'camRowStyle', '取景态覆盖层（绝对定位，必须自带 top）'],
    ['food-scan', 'h-nav', 'navRowStyle', '识别历史「清空」（靠右）'],
    ['food-scan', 'r-nav', 'navRowStyle', '识别结果「完成」（靠右）'],
    ['home', 'hero-top', 'navRowStyle', '首页品牌名（装饰性大标题，纵向同心）']
  ];
  const missing = [];
  for (const [page, cls, bind, why] of SITES) {
    const w = stripWxml(wxmlOf(page));
    const tag = (w.match(new RegExp('<[a-z-]+[^>]*class="' + cls + '"[^>]*>')) || [])[0];
    if (!tag) { missing.push(page + ' .' + cls + '（源码里找不到这个元素 ⇒ 结构变了，本段失去对象）'); continue; }
    if (!new RegExp('style="\\{\\{' + bind + '\\}\\}"').test(tag)) missing.push(page + ' .' + cls + ' 应挂 {{' + bind + '}} — ' + why);
  }
  eq(missing.length, 0, 'G7 四处顶部行都要挂对应的样式串（覆盖层挂 camRowStyle，流式行挂 navRowStyle）'
    + (missing.length ? ' → 缺 ' + missing.join(' ; ') : ''));
  truthy(SITES.length >= 4, 'G8 本段盯住了 ' + SITES.length + ' 处（少一处说明清单被改小了）');
}

{
  /* 未来防线：有页面向 <nav-bar> 的右侧 slot 塞控件时，必须同时把顶部行度量接上。
     判据先喂样本证明「看得见被测物」——现在 0 页填充，否则这条就是个不会红的摆设。 */
  const fillsSlot = (text) => /slot="right"/.test(stripWxml(text));
  eq(fillsSlot('<nav-bar title="x"><view slot="right">a</view></nav-bar>'), true, 'G9 尺子自检：能认出填了右侧 slot 的写法');
  eq(fillsSlot('<nav-bar title="x" show-back="{{true}}" />'), false, 'G10 尺子自检：普通 nav-bar 不算填充（本仓 16 页都是这种）');
  const reservers = PAGES.filter((p) => fillsSlot(wxmlOf(p)));
  const bad2 = reservers.filter((p) => !/navRowStyle|camRowStyle/.test(wxmlOf(p)) || !/navRowStyle/.test(read('pages/' + p + '/' + p + '.js')));
  eq(bad2.length, 0, 'G11 填了 nav-bar 右侧 slot 的页面必须同时接上 navRowStyle（横向让位 + 纵向同心）'
    + (bad2.length ? ' → ' + bad2.join(', ') : '（当前 ' + reservers.length + ' 页填充该 slot ⇒ 本条对现状无约束，仅防未来）'));
}

/* ═══════════ [H] 顶部行必须与胶囊**同心**（纵向对齐） ═══════════
   用户第二轮报障：「取景页的返回/闪光灯、结果页的返回/完成没有对齐微信自带胶囊」。
   根因同 [G] 一族 —— 又在用手调的 rpx 常量摆位：取景态 `padding: 90rpx 36rpx 0` 让按钮
   **偏上 3.5px**，结果/历史态行高含 16rpx 上下 padding（行高 49.9px ≠ 导航带 44px）让按钮
   **偏下 3.0px**。⇒ 行高必须按胶囊实测算：navBarHeight = 2×(胶囊上沿 − 状态栏) + 胶囊高。 */
console.log('[H] 顶部导航带高必须按胶囊实测算（行中心 == 胶囊中心），且 wxss 不许把它吃掉');
{
  /* 尺子自检：三个真实机型档案，胶囊顶与状态栏的差值各不相同。
     判据是**不变量**「行中心 == 胶囊中心」，而不是把 44 写死 —— 写死 44 在差值 ≠ 6px 的机型上必偏。 */
  const PROFILES = [
    { name: 'iPhone SE 类（sbh20）', sbh: 20, top: 26, h: 32 },
    { name: 'iPhone X 类（sbh44）', sbh: 44, top: 48, h: 32 },
    { name: 'iPhone 12 类（sbh47）', sbh: 47, top: 53, h: 32 },
    { name: '大胶囊安卓（sbh24/h36）', sbh: 24, top: 32, h: 36 }
  ];
  let allTight = true;
  const rows = [];
  for (const p of PROFILES) {
    const fake = { getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: p.sbh }),
                   getMenuButtonBoundingClientRect: () => ({ left: 296, right: 383, width: 87, top: p.top, bottom: p.top + p.h, height: p.h }) };
    const navH = withWx(fake, () => navMetrics.navBarHeight());
    const rowMid = p.sbh + navH / 2;                 // 行中心：行从状态栏下沿起，内容 align-items:center
    const capMid = p.top + p.h / 2;
    if (Math.abs(rowMid - capMid) > 0.5) allTight = false;
    rows.push(p.name + ' navH=' + navH + ' 行中心=' + rowMid + ' 胶囊中心=' + capMid);
  }
  truthy(allTight, 'H1 四个机型档案下「行中心 == 胶囊中心」全部成立（±0.5px）—— ' + rows.join(' | '));
  eq(rows.length, 4, 'H2 尺子自检：确实跑了 4 个档案（少一个说明循环被改废，H1 就成了空断言）');

  /* 兜底分支同样要能对齐到一个**合理的**默认带高，且不许 NaN */
  const navFallback = withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }) }, () => navMetrics.navBarHeight());
  eq(navFallback, 44, 'H3 测不到胶囊时导航带高兜底为 44（微信自定义导航的标准值），且是有限数');
  truthy(withWx({ getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }),
                  getMenuButtonBoundingClientRect: () => RECT }, () => navMetrics.navBarHeight()) === 44,
    'H4 尺子自检：实测分支在 sbh47/胶囊顶 53 时也应得 44 —— 与兜底值相同 ⇒ 不能靠「值不同」判定分支，故 H1 用不变量而非比数值');
}

{
  /* wxss 侧的两条硬约束：算得再对，被它们吃掉也白搭。
     ① box-sizing: border-box —— 否则行内 height 是内容盒高，加 padding 后总高 ≠ 导航带；
     ② 竖向 padding 归零 —— 居中是 align-items:center 的活，留 padding 会把内容挤偏。 */
  function verticalPaddingIsZero(body) {
    const isZero = (v) => /^0(px|rpx|em|rem|%)?$/.test(v);
    const decls = String(body).split(';').map((s) => s.trim()).filter(Boolean);
    let top = null, bottom = null;
    for (const d of decls) {
      const m = d.match(/^([a-z-]+)\s*:\s*(.+)$/);
      if (!m) continue;
      const prop = m[1], val = m[2].trim().split(/\s+/);
      if (prop === 'padding') {
        if (val.length === 1) { top = val[0]; bottom = val[0]; }
        else if (val.length === 2) { top = val[0]; bottom = val[0]; }
        else if (val.length === 3) { top = val[0]; bottom = val[2]; }
        else if (val.length >= 4) { top = val[0]; bottom = val[2]; }
      } else if (prop === 'padding-top' || prop === 'padding-block-start') top = val[0];
      else if (prop === 'padding-bottom' || prop === 'padding-block-end') bottom = val[0];
    }
    if (top === null && bottom === null) return true;   // 完全没写竖向 padding ⇒ 天然为 0
    return (top === null || isZero(top)) && (bottom === null || isZero(bottom));
  }
  eq(verticalPaddingIsZero('padding: 0 32rpx;'), true, 'H5 尺子自检：padding:0 32rpx → 竖向为 0');
  eq(verticalPaddingIsZero('padding: 16rpx 32rpx;'), false, 'H6 尺子自检：padding:16rpx 32rpx → 竖向非 0（就是出事前的写法）');
  eq(verticalPaddingIsZero('padding: 90rpx 36rpx 0;'), false, 'H7 尺子自检：三值简写取 top/val[2]，90rpx ≠ 0 → 判非 0（取景态出事前的写法）');
  eq(verticalPaddingIsZero('padding: 1px 2px 3px 4px;'), false, 'H8 尺子自检：四值简写取 top=1px / bottom=3px');
  eq(verticalPaddingIsZero('padding: 0;'), true, 'H9 尺子自检：单值 0');
  eq(verticalPaddingIsZero('width: 100%; flex: 0 0 auto;'), true, 'H10 尺子自检：没写 padding ⇒ 判「竖向为 0」，不是恒 false');
  eq(/align-items\s*:\s*center/.test('display:flex; align-items: center;'), true, 'H10b 尺子自检：写了居中 → 认得出');
  eq(/align-items\s*:\s*center/.test('display:flex; align-items: flex-start;'), false, 'H10c 尺子自检：顶对齐 → 判缺失（不是恒真）');

  const ROW_SITES = [
    ['food-scan', 'cam-top'], ['food-scan', 'h-nav'], ['food-scan', 'r-nav'],
    ['home', 'hero-top']
  ];
  const badBox = [], badPad = [], badCenter = [];
  for (const [page, cls] of ROW_SITES) {
    const body = bodyOf(rulesMapOf(page), cls);
    if (!body) { badBox.push(page + ' .' + cls + '（wxss 里没有规则）'); continue; }
    if (!/box-sizing\s*:\s*border-box/.test(body)) badBox.push(page + ' .' + cls);
    if (!verticalPaddingIsZero(body)) badPad.push(page + ' .' + cls);
    if (!/align-items\s*:\s*center/.test(body)) badCenter.push(page + ' .' + cls);
  }
  eq(badBox.length, 0, 'H11 四处顶部行都必须 box-sizing:border-box —— 否则行内 height 是内容盒高，加 padding 后总高 ≠ 导航带，纵向对齐悄悄失效'
    + (badBox.length ? ' → 缺 ' + badBox.join(', ') : ''));
  eq(badPad.length, 0, 'H12 四处顶部行的竖向 padding 必须为 0 —— 内容居中靠 align-items:center，留 padding 会把内容挤偏'
    + (badPad.length ? ' → 非零 ' + badPad.join(', ') : ''));
  eq(badCenter.length, 0, 'H13 四处顶部行都必须 align-items:center —— 行高算了但内容不居中，行中心依然≠胶囊中心（2026-10-12 补：home 接入时才发现这条没守，profile 同日接入又撤）'
    + (badCenter.length ? ' → 缺 ' + badCenter.join(', ') : ''));
}

/* ═══════════ [D] 行为：占位块真的拿到状态栏高度 ═══════════ */
console.log('[D] stub wx 跑真实 onLoad，确认占位块拿到的是真实状态栏高度（不是 0px 兜底）');
(async () => {
  const storage = {};
  // globalData 字段按 app.js 的初始值补全：profile 的 refresh() 会读 userInfo.loggedIn 等，
  // 字段缺失会在 onShow 里抛错（那不是本段要测的东西）。food-scan 的 D0~D6 只用占位/注入值。
  global.getApp = () => ({ globalData: {
    meals: [], trainingLogs: [], weightRecords: [], profile: {}, selectedActions: [],
    userInfo: { loggedIn: false, nickname: '', avatar: '' },
    favorites: [], customActions: [], trainingPlans: [], activePlanId: '',
    reminderOn: false, keyActionPicks: []
  }, persist() {} });
  global.wx = {
    // 机型档案固定为 iPhone 12 类：状态栏 47、胶囊 [53,85] ⇒ 导航带 2×(53−47)+32 = 44。
    // 与 [G]/[H] 用的是同一组数字，改一处就要三处一起改（否则各段互相印证不了）。
    getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 390, windowHeight: 844 }),
    // 走**生产路径**（实测胶囊），而不是让本段落到兜底分支上：
    // 兜底分支已由 [G] 的 G2/G3/G5 与 [H] 的 H3 在模块层覆盖，这里要证明的是「页面真的调了这个模块」。
    getMenuButtonBoundingClientRect: () => RECT,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    showModal: () => {}, showToast: () => {}, openSetting: () => {},
    navigateBack: () => {}, switchTab: () => {}, setClipboardData: () => {},
    // 2026-10-15 起首页 onShow 末尾有首启引导跳转（onboardingDone 标记检测）→ stub 须备齐
    navigateTo: () => {},
    setNavigationBarColor: () => {}, getSystemInfoSync: () => ({ statusBarHeight: 47 })
  };
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  require(path.join(ROOT, 'pages', 'food-scan', 'food-scan.js'));
  if (!cfg || !cfg.data) { bad('D0 food-scan.js 没有调用 Page(...) —— 本段失去对象'); }
  else {
    has(String(cfg.data.statusBarStyle), '0px', 'D1 初始值是 0px（首帧占位为 0，靠 onLoad 补上）');
    const inst = Object.assign({}, cfg);
    inst.data = JSON.parse(JSON.stringify(cfg.data));
    inst.setData = function (patch) { Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; }); };
    try {
      inst.onLoad.call(inst);
      eq(inst.data.statusBarStyle, 'height: 47px', 'D2 onLoad 后占位高度 = 状态栏高度（47px）—— 证明它不是一直被兜底成 0');
    } catch (e) {
      bad('D2 onLoad 抛错：' + (e && e.message));
    }
    eq(inst.data.anSec, 0, 'D3 识别中秒数初值为 0（配合 .an-sec 的 wx:if 门槛）');
    // 两个数都是**有意**写死的，它们同时证明「页面确实调了 navMetrics」而不是自己拍了个常量
    // （若只是摆设，这里多半是 '' 或兜底值 112 / 44）：
    //   102 = 屏宽390 − 胶囊左缘296 + 呼吸间隙8
    //    44 = 导航带 2×(胶囊上沿53 − 状态栏47) + 胶囊高32
    eq(inst.data.navRowStyle, 'height: 44px; padding-right: 102px', 'D4 流式行的行高＝导航带、右侧让开胶囊（真实测量分支）');
    eq(inst.data.camRowStyle, 'top: 47px; height: 44px; padding-right: 102px', 'D5 覆盖层另需自带 top（否则贴屏幕顶端、压进状态栏）');
    truthy(!/navInsetStyle/.test(JSON.stringify(cfg.data)) && !/topRightStyle/.test(JSON.stringify(cfg.data)),
      'D6 旧键名 navInsetStyle / topRightStyle 不得残留（改名后漏改一处 = 该行永远拿到空样式）');
  }

  /* D7 home / profile 的顶部行也要**真的注入**（2026-10-12 接入）。
     只验「wxml 上挂了 {{navRowStyle}}」（[G7]）不算验 —— 那证明不了页面调了 navMetrics，
     得跑真实 onShow 看 data 里落的什么值。两个写死的数与 food-scan 同一组机型档案：
       102 = 屏宽390 − 胶囊左缘296 + 呼吸间隙8
        44 = 导航带 2×(胶囊上沿53 − 状态栏47) + 胶囊高32
     若页面只是摆设，这里多半是 ''（初始值）或兜底值。 */
  for (const [page, hook, cls] of [['home', 'onShow', 'hero-top']]) {
    let cfg2 = null;
    global.Page = (c) => { cfg2 = c; };
    try { require(path.join(ROOT, 'pages', page, page + '.js')); }
    catch (e) { bad('D7 ' + page + '.js 加载失败：' + (e && e.message)); continue; }
    if (!cfg2 || !cfg2.data) { bad('D7 ' + page + '.js 没有调用 Page(...) —— 本段失去对象'); continue; }
    const inst2 = Object.assign({}, cfg2);
    inst2.data = JSON.parse(JSON.stringify(cfg2.data));
    inst2.setData = function (patch) { Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; }); };
    try { inst2[hook].call(inst2); }
    catch (e) { bad('D7 ' + page + ' ' + hook + ' 抛错：' + (e && e.message)); continue; }
    eq(inst2.data.statusBarStyle, 'height: 47px', 'D7 ' + page + ' 占位高度 = 状态栏高度（47px，不再是页面自己拍的 fallback）');
    eq(inst2.data.navRowStyle, 'height: 44px; padding-right: 102px',
      'D7 ' + page + ' .' + cls + ' 行高＝导航带、右侧让开胶囊（真实测量分支）');
  }

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();

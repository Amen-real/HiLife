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
// 用法：node scripts/verify-top-inset.cjs
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

/* ═══════════ [D] 行为：占位块真的拿到状态栏高度 ═══════════ */
console.log('[D] stub wx 跑真实 onLoad，确认占位块拿到的是真实状态栏高度（不是 0px 兜底）');
(async () => {
  const storage = {};
  global.getApp = () => ({ globalData: { meals: [], trainingLogs: [], weightRecords: [], profile: {}, selectedActions: [] } });
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 390, windowHeight: 844 }),
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    showModal: () => {}, showToast: () => {}, openSetting: () => {},
    navigateBack: () => {}, switchTab: () => {}, setClipboardData: () => {}
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
      eq(inst.data.statusBarStyle, 'height: 44px', 'D2 onLoad 后占位高度 = 状态栏高度（44px）—— 证明它不是一直被兜底成 0');
    } catch (e) {
      bad('D2 onLoad 抛错：' + (e && e.message));
    }
    eq(inst.data.anSec, 0, 'D3 识别中秒数初值为 0（配合 .an-sec 的 wx:if 门槛）');
  }

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();

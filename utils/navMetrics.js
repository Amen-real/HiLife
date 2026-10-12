// utils/navMetrics.js —— 顶部安全区唯一真源：状态栏 + 微信系统胶囊
//
// 背景：本仓 16 页全部 navigationStyle: custom，页面顶部整条都归 WebView 自己画。
// 但屏幕右上角有一块**微信自己渲染、页面删不掉也压不住**的胶囊按钮（「··· ⊙」更多/关闭）。
// 它不进 WXSS 布局树、不参与 flex、z-index 对它无效 —— 页面只要把自有控件摆进它那一格，
// 两者必然重叠：轻则误触到系统胶囊，重则该控件**完全点不到**（触摸被系统截走）。
//
// ⚠️ 关键几何性质（决定了本模块的口径，改之前先读这四条）：
//   ① 胶囊**贴屏幕右缘**渲染 ⇒ 只要自有控件的右边界落在胶囊左边界之左，二者就不会重叠，
//      **与纵向位置无关**。所以「不许重叠」的解法是**横向让位**，不是「纵向躲开」。
//   ② 胶囊宽度随机型 / 系统版本变化（约 87~96px），右边距也不固定 ⇒
//      **拍一个 rpx 常量在窄机型上必然再次重叠**，必须实测。
//   ③ 需要预留的内缩量 = 屏幕右缘 → 胶囊左缘的距离 + 一个呼吸间隙；
//      这个量只由胶囊自身决定，**与屏幕宽度无关**（别拿屏幕宽去减出别的数）。
//   ④ 反过来，「与胶囊**对齐**」是**纵向**的事，且必须按胶囊实测算：
//      顶部行的高度 = 2 × (胶囊上沿 − 状态栏) + 胶囊高（见 navBarHeight()）。
//      横向不重叠（①）＋ 纵向同心（④）＝ 顶部行与胶囊的关系才算处理完，
//      少任何一条，真机上要么点不到、要么看着没对齐。
//
// 用法（页面侧只做两件事）：
//   const navMetrics = require('../../utils/navMetrics');
//   this.setData({ navRowStyle: navMetrics.topRowStyle() });        // onLoad 里（流式行）
//   this.setData({ camRowStyle: navMetrics.overlayRowStyle() });    // onLoad 里（绝对定位覆盖层）
//   <view class="r-nav" style="{{navRowStyle}}">                    // 顶部行（含靠右控件的那一行）
// 该 style 含 `height` 与 `padding-right`（覆盖层那条另带 `top`）。
// 长写覆盖简写的一侧，不会动到该行其它的 padding —— 但**竖向 padding 必须为 0**，
// 且该行必须 `box-sizing: border-box`，否则算出来的导航带高到不了手上（见下面 topRowStyle 注释）。
//
// ⚠️ 何时需要它：该行**与胶囊处于同一纵向带**。
//   本仓现状（2026-10-12 全量核对）：落在这一带的顶部行共 5 处、分 3 页 ——
//     · food-scan 三处（取景态闪光灯 / 结果态「完成」/ 历史态「清空」）：有靠右控件，
//       横向让位（①）与纵向同心（④）两条都需要；
//     · home 品牌行 / profile 大标题行：装饰性标题、无靠右控件，2026-10-12 起也接上 ——
//       它们同样要与胶囊**纵向同心**（此前手调 rpx 摆位，实测偏胶囊中线 ~8px / ~4px）。
//       「没有右侧控件」不构成不接的理由。
//   用 <nav-bar> 的 13 页：标题居中、右侧 slot 空置 ⇒ 天然安全；
//   workout 的「完成训练」在 nav-bar 之下（y ≥ statusBarHeight + 导航带高），不进胶囊纵向带。
//   **将来若有页面把行放进顶部带，必须接上本模块**，守卫 scripts/verify-top-inset.cjs
//   的 [G] / [H] 两段会盯着这件事（[G7] 逐个列名核对绑定名，漏一处就红）。

const GAP_PX = 8;               // 自有控件与胶囊之间至少留的呼吸间隙（px）
const FALLBACK_CAPSULE_W = 96;  // 测不到胶囊时的保守宽度（取常见机型上界，宁可多留）
const FALLBACK_CAPSULE_R = 8;   // 测不到胶囊时的保守右边距
const FALLBACK_SBW = 375;       // 测不到窗口信息时的保守屏宽（仅用于兜底分支）
const FALLBACK_NAV_H = 44;      // 测不到胶囊时的导航带高（微信自定义导航的标准值）

function winInfo() {
  try {
    if (typeof wx === 'undefined') return null;
    return (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
  } catch (e) { return null; }
}

// 状态栏高度（px）。与 nav-bar 组件同口径，集中在这里免得两处各写一份。
function statusBarHeight() {
  const i = winInfo();
  return (i && i.statusBarHeight) || 20;
}

// 胶囊矩形（px，相对页面视口）。基础库过低 / 测试 stub 下返回 null（由调用方兜底）。
function capsuleRect() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getMenuButtonBoundingClientRect !== 'function') return null;
    const r = wx.getMenuButtonBoundingClientRect();
    if (!r || !r.width || r.left <= 0) return null;
    return r;
  } catch (e) { return null; }
}

// 顶部行「靠右控件」必须预留的右侧内缩量（px）。
// 实测优先；测不到就退化为保守常量 —— 宁可多留一点（难看），也不能少留（点不到）。
function topRightInset() {
  const i = winInfo();
  const w = (i && i.windowWidth) || FALLBACK_SBW;
  const r = capsuleRect();
  if (r) {
    const inset = Math.round(w - r.left + GAP_PX);
    if (inset > 0) return inset;
  }
  return FALLBACK_CAPSULE_W + FALLBACK_CAPSULE_R + GAP_PX;
}

// 顶部导航带的高度（px）——把顶部行与胶囊**严格同心**的那个值。
//
// 推导（这是本模块第二条铁律，别拿 rpx 常量替它）：
//   顶部行从状态栏下沿起。要让它与胶囊同心，就得把它做成**以胶囊中心为对称轴**的带状：
//     行高 = (胶囊上沿 − 状态栏) + 胶囊高 + (胶囊下沿 − 状态栏)
//          = 2 × (胶囊上沿 − 状态栏) + 胶囊高
//   于是「行中心 == 胶囊中心」恒成立，与机型无关。
//
// ⚠️ 为什么不能用字面量 44：44 只是**典型值**（状态栏与胶囊上沿差 6px 时：2×6+32）。
//   statusBarHeight 与胶囊顶的差值随机型变（刘海屏 47/44/…），差 1px 行中心就差 1px。
//   ⇒ 必须实测。这正是「取景页按钮偏上 3.5px、结果页偏下 3.0px」的成因
//   （2026-09-29 真机：两处都在用手调的 rpx 摆位，谁也跟不上胶囊）。
function navBarHeight() {
  const sbh = statusBarHeight();
  const r = capsuleRect();
  if (r) {
    const h = 2 * (r.top - sbh) + r.height;
    if (h > 0) return Math.round(h);
  }
  return FALLBACK_NAV_H;
}

// 便捷：直接可用的 style 串（本仓惯例 —— 行内 style 由 JS 拼整串注入，不做 Mustache 拼接）。
//
// 两种形态，按顶部行**怎么参与布局**选（选错就是「差了半个行高」那种对不齐）：
//   · topRowStyle()     —— 常规流式行：排在状态栏占位块之后，它只需要「高度」和「右侧让位」。
//   · overlayRowStyle() —— 绝对定位覆盖层：<camera> 里的 cover-view 那类，脱离文档流，
//                          必须自己带上 top（否则它会贴在屏幕最顶端、压进状态栏）。
//
// ⚠️ 配套的 wxss 必须满足两条，否则这里算得再对也白搭：
//   ① 该行 `box-sizing: border-box` —— 不然行内 height 是**内容盒**高，加上 padding 后总高 ≠ 导航带；
//   ② 该行**竖向 padding 归零** —— 留 padding 会把内容挤偏（居中是 align-items: center 的活）。
//   守卫 verify-top-inset.cjs 的 [H] 段盯着这两条。
function topRowStyle() {
  return 'height: ' + navBarHeight() + 'px; padding-right: ' + topRightInset() + 'px';
}

function overlayRowStyle() {
  return 'top: ' + statusBarHeight() + 'px; height: ' + navBarHeight() + 'px; padding-right: ' + topRightInset() + 'px';
}

module.exports = { statusBarHeight, capsuleRect, navBarHeight, topRightInset, topRowStyle, overlayRowStyle, GAP_PX };

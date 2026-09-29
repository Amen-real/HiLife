// utils/navMetrics.js —— 顶部安全区唯一真源：状态栏 + 微信系统胶囊
//
// 背景：本仓 16 页全部 navigationStyle: custom，页面顶部整条都归 WebView 自己画。
// 但屏幕右上角有一块**微信自己渲染、页面删不掉也压不住**的胶囊按钮（「··· ⊙」更多/关闭）。
// 它不进 WXSS 布局树、不参与 flex、z-index 对它无效 —— 页面只要把自有控件摆进它那一格，
// 两者必然重叠：轻则误触到系统胶囊，重则该控件**完全点不到**（触摸被系统截走）。
//
// ⚠️ 关键几何性质（决定了本模块的口径，改之前先读这三条）：
//   ① 胶囊**贴屏幕右缘**渲染 ⇒ 只要自有控件的右边界落在胶囊左边界之左，二者就不会重叠，
//      **与纵向位置无关**。所以解法是「横向让位」，不是「纵向躲开」。
//   ② 胶囊宽度随机型 / 系统版本变化（约 87~96px），右边距也不固定 ⇒
//      **拍一个 rpx 常量在窄机型上必然再次重叠**，必须实测。
//   ③ 需要预留的内缩量 = 屏幕右缘 → 胶囊左缘的距离 + 一个呼吸间隙；
//      这个量只由胶囊自身决定，**与屏幕宽度无关**（别拿屏幕宽去减出别的数）。
//
// 用法（页面侧只做两件事）：
//   const navMetrics = require('../../utils/navMetrics');
//   this.setData({ navInsetStyle: navMetrics.topRightStyle() });   // onLoad 里
//   <view class="r-nav" style="{{navInsetStyle}}">                 // 顶部行（含靠右控件的那一行）
// 该 style 只含 `padding-right`。长写覆盖简写的一侧，不会动到该行其它的 padding。
//
// ⚠️ 何时需要它：该行**与胶囊处于同一纵向带** 且 行内**有靠右控件**。
//   本仓现状（2026-09-29 全量侦察）：只有 food-scan 一页把控件放进了这一格 ——
//   取景态闪光灯 / 结果态「完成」/ 历史态「清空」。
//   用 <nav-bar> 的 13 页：标题居中、右侧 slot 空置 ⇒ 天然安全；
//   home / profile 顶部只有左对齐标题；workout 的「完成训练」在 nav-bar 之下
//   （y ≥ statusBarHeight + 44px），不进胶囊纵向带。
//   **将来若有页面把控件放进顶部带，必须接上本模块**，守卫 scripts/verify-top-inset.cjs
//   的 [G] 段会盯着这件事。

const GAP_PX = 8;               // 自有控件与胶囊之间至少留的呼吸间隙（px）
const FALLBACK_CAPSULE_W = 96;  // 测不到胶囊时的保守宽度（取常见机型上界，宁可多留）
const FALLBACK_CAPSULE_R = 8;   // 测不到胶囊时的保守右边距
const FALLBACK_SBW = 375;       // 测不到窗口信息时的保守屏宽（仅用于兜底分支）

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

// 便捷：直接可用的 style 串（本仓惯例 —— 行内 style 由 JS 拼整串注入，不做 Mustache 拼接）。
function topRightStyle() {
  return 'padding-right: ' + topRightInset() + 'px';
}

module.exports = { statusBarHeight, capsuleRect, topRightInset, topRightStyle, GAP_PX };

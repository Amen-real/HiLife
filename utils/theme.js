// utils/theme.js —— 全局主题（浅色 light / 深色 dark）
// 持久化在 wx.StorageSync('app_theme')，同时镜像到 app.globalData.theme 便于隔离组件（custom-tab-bar）读取。
// 页面用法：
//   const theme = require('../../utils/theme.js');
//   onShow() { this.setData({ theme: theme.sync() }); }
//   wxml: <view class="page {{theme}}">
// WXSS：浅色为默认样式；深色覆盖写在 `.theme-dark` 后代选择器下（特异性更高，自然赢）。

const KEY = 'app_theme';
const LIGHT = 'light';
const DARK = 'dark';

// 页面根背景色（与 app.wxss 的 --n-50 / 深色 #0A0A0A 保持一致）
const BG = { light: '#F7F7F5', dark: '#0A0A0A' };

// 同步 page 根元素背景（避免短内容页 / 回弹时露出另一主题底色）
function applyWindowBg(t) {
  try {
    if (typeof wx.setBackgroundColor === 'function') {
      const c = t === DARK ? BG.dark : BG.light;
      wx.setBackgroundColor({ backgroundColor: c, backgroundColorTop: c, backgroundColorBottom: c });
    }
  } catch (e) {}
}

// 读取当前主题（默认浅色）
function get() {
  try {
    const v = wx.getStorageSync(KEY);
    return v === DARK ? DARK : LIGHT;
  } catch (e) {
    return LIGHT;
  }
}

// 写入主题；返回实际生效值
function set(theme) {
  const t = theme === DARK ? DARK : LIGHT;
  try {
    wx.setStorageSync(KEY, t);
  } catch (e) {
    // 存储不可用时仅内存生效
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.theme = t;
  } catch (e) {}
  applyWindowBg(t);
  return t;
}

// 浅深互切；返回切换后的主题
function toggle() {
  return set(get() === DARK ? LIGHT : DARK);
}

// 供页面 onShow 调用：返回当前主题并同步 globalData
function sync() {
  const t = get();
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.theme = t;
  } catch (e) {}
  applyWindowBg(t);
  return t;
}

module.exports = { get, set, toggle, sync, LIGHT, DARK };

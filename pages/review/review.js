// pages/review/review.js —— 复用训练复盘组件（样式与逻辑均在 component 内）
// 组件通过 lifetimes.attached + pageLifetimes.show 自行 rebuild，本页仅负责主题同步
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'theme-light'
  },
  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    // 页面根 .theme-dark 重定义 CSS 变量后，training-review 组件经变量继承自动跟随
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  }
});

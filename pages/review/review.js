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
  },

  // 分享给好友：本页是「分享卡」从外部进来的落点，也是卡片图片消息上小程序入口的默认路径。
  // 不做 onShareTimeline：朋友圈走单页模式（无 tabBar、交互受限），本页含弹层与画布，落地体验不完整。
  onShareAppMessage() {
    return { title: '衡砺健身记录 · 训练复盘', path: '/pages/review/review' };
  }
});

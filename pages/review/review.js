// pages/review/review.js —— 复用训练复盘组件（样式与逻辑均在 component 内）
// 组件通过 lifetimes.attached + pageLifetimes.show 自行 rebuild，本页仅负责主题同步
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'theme-light',
    // 从训练页「完成并生成分享图」跳进来时带 share=1 → 透传给组件，由它自动打开分享卡。
    // 组件在 attached 里读一次这个属性（不监听后续变化），所以这个值只需要在 onLoad 定下来。
    autoShare: false
  },

  // 入口：训练页保存完训练后 redirectTo 过来（既给复盘页，也把分享卡一并打开）
  onLoad(options) {
    if (options && options.share === '1') this.setData({ autoShare: true });
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

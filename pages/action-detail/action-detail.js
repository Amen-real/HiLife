// pages/action-detail/action-detail.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const { media, resolveUrl } = require('../../utils/media.js');

Page({
  data: {
    act: null,
    favorited: false,
    showVideoOverlay: false   // 视频放大覆盖层是否显示
  },

  onLoad() {
    const raw = store.get().currentAction || null;
    const act = raw ? { ...raw, image: media(raw.image), video: media(raw.video) } : null;
    this.setData({
      act,
      favorited: act ? store.isFavorite(act.id) : false
    });
  },

  toggleFav() {
    if (!this.data.act) return;
    if (!auth.requireLogin()) return;
    store.toggleFavorite(this.data.act.id);
    this.setData({ favorited: store.isFavorite(this.data.act.id) });
  },

  addToToday() {
    if (!this.data.act) return;
    if (!auth.requireLogin()) return;
    store.toggleSelect(this.data.act);
    const on = store.isSelected(this.data.act.id);
    wx.showToast({ title: on ? '已加入今日训练' : '已移出', icon: 'none' });
  },

  // 点击演示图全屏看原图（GIF 动图也完整显示）
  previewHero(e) {
    const url = e.currentTarget.dataset.url;
    // url 可能是 cloud:// 文件 ID，previewImage 只认 HTTPS，先解析
    resolveUrl(url, (u) => wx.previewImage({ current: u, urls: [u] }));
  },

  // 自定义放大覆盖层：弹出半透明全屏 GIF（gif 用 image 标签渲染、自动循环播放，规避原生 video 在真机误退出的 bug）
  // 打开时卡片内 gif 由 wx:if 销毁，避免与覆盖层 gif 重叠；关闭后自动重建
  openVideoOverlay() {
    this.setData({ showVideoOverlay: true });
  },
  closeVideoOverlay() {
    this.setData({ showVideoOverlay: false });
  }
});

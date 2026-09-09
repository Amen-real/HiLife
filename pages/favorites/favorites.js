// pages/favorites/favorites.js
const exercises = require('../../utils/exercises.js');
const { media, thumb } = require('../../utils/media.js');
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');

// 按 id 回查完整动作对象：自建动作优先（id 唯一且可能覆盖内置），其次遍历内置库各部位
function findActionById(id) {
  const custom = store.get().customActions || [];
  const c = custom.find(a => a.id === id);
  if (c) return c;
  const lib = exercises.library || {};
  for (const cat of Object.keys(lib)) {
    const arr = lib[cat];
    if (Array.isArray(arr)) {
      const m = arr.find(a => a.id === id);
      if (m) return m;
    }
  }
  return null;
}

Page({
  data: {
    theme: 'theme-light',
    list: []
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    this.refresh();
  },

  // 把收藏 id 数组解析成可渲染的动作卡片
  refresh() {
    const favIds = store.get().favorites || [];
    const list = favIds.map(id => {
      const a = findActionById(id);
      if (!a) return null; // 已被删除的自建动作等，直接跳过
      return {
        ...a,
        nameZh: a.nameZh || a.name,
        image: thumb(a.image || ''),
        video: media(a.video || ''),
        emoji: a.emoji || '🏋️'
      };
    }).filter(Boolean);
    this.setData({ list });
  },

  // 点击卡片 → 进入动作详情页
  tapAction(e) {
    const id = e.currentTarget.dataset.id;
    const act = this.data.list.find(a => a.id === id);
    if (!act) return;
    store.get().currentAction = act;
    wx.navigateTo({ url: '/pages/action-detail/action-detail' });
  },

  // 点击 ♥ → 取消收藏（二次确认，避免误删）
  toggleFav(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const it = this.data.list.find(a => a.id === id);
    const name = it ? (it.nameZh || it.name) : '该动作';
    wx.showModal({
      title: '取消收藏',
      content: '确定取消收藏「' + name + '」吗？',
      confirmText: '取消收藏',
      confirmColor: '#F2545B',
      success: (r) => {
        if (!r.confirm) return;
        store.toggleFavorite(id);
        this.refresh();
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      }
    });
  }
});

// pages/action-detail/action-detail.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const { media, resolveUrl } = require('../../utils/media.js');
const { collectSlugs, buildMuscles, targetCn, drawBody } = require('../../utils/bodymap.js');
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'theme-light',
    act: null,
    heroSrc: '',
    heroBadge: '',
    tags: [],
    steps: [],
    muscles: { front: [], back: [] },
    history: [],
    showVideoOverlay: false
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  },

  onLoad() {
    const raw = store.get().currentAction || null;
    if (!raw) { this.setData({ act: null }); return; }
    const act = { ...raw, image: media(raw.image), video: media(raw.video) };
    const heroSrc = act.video || act.image || '';
    const tags = [act.category];
    const tc = targetCn(act);
    if (tc) tags.push(tc);
    tags.push(act.equip || '徒手');
    const steps = (act.steps && act.steps.length) ? act.steps : [];
    const slugSet = collectSlugs(act);
    this._slugSet = slugSet;
    this.setData({
      act,
      heroSrc,
      heroBadge: act.video ? '动作演示 · GIF' : '动作演示',
      tags,
      steps,
      muscles: buildMuscles(act)
    });
    this.buildHistory(act.id);
  },

  onReady() {
    // canvas 节点在首次渲染后才可取，于 onReady 内绘制
    if (this._slugSet) this.renderBody(this._slugSet);
  },

  // 用 canvas 2d 绘制真实人体肌肉解剖图（前/后），高亮当前动作涉及肌群
  renderBody(slugSet) {
    const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
    const draw = (id, side) => {
      wx.createSelectorQuery().in(this).select('#' + id).fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        drawBody(canvas, ctx, side, slugSet, {});
      });
    };
    draw('bodyFront', 'front');
    draw('bodyBack', 'back');
  },

  // 从训练日志中提取该动作的最近 5 次记录（日期倒序）
  buildHistory(id) {
    const logs = store.get().trainingLogs || [];
    const out = [];
    for (const log of logs) {
      if (out.length >= 5) break;
      const hit = (log.actions || []).find(a => a.id === id);
      if (!hit) continue;
      const sets = hit.sets || [];
      const first = sets[0] || {};
      out.push({
        date: log.date,
        sets: sets.length,
        reps: (first.reps != null && first.reps !== '') ? String(first.reps) : '—',
        weight: (first.weight != null && first.weight !== '') ? String(first.weight) : '—'
      });
    }
    this.setData({ history: out });
  },

  addToToday() {
    if (!this.data.act) return;
    if (!auth.requireLogin()) return;
    store.toggleSelect(this.data.act);
    const on = store.isSelected(this.data.act.id);
    wx.showToast({ title: on ? '已加入今日训练' : '已移出', icon: 'none' });
  },

  // 点击 Hero：有媒体则弹放大层；仅有图片则调起系统预览（GIF 也会完整显示）
  onHeroTap() {
    if (this.data.heroSrc) {
      this.setData({ showVideoOverlay: true });
    } else if (this.data.act && this.data.act.image) {
      resolveUrl(this.data.act.image, (u) => wx.previewImage({ current: u, urls: [u] }));
    }
  },
  closeVideoOverlay() { this.setData({ showVideoOverlay: false }); }
});

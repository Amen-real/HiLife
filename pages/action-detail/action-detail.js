// pages/action-detail/action-detail.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const { media, resolveUrl } = require('../../utils/media.js');
const { collectSlugs, buildMuscles, targetCn, drawBody } = require('../../utils/bodymap.js');
const { muscleStatusOf } = require('../../utils/muscleStatus.js');
const theme = require('../../utils/theme.js');

// 三态的中文名与一句话解释。
// ⚠️ 「文案只写实现得了的事」：这里每一句都必须能从 muscleStatusOf 的返回值直接推出来，
//   不能写「建议休息」这种模型给不出的结论 —— 模型只给疲劳值与三态，解释权在文案。
const STATE_META = {
  fatigued: { label: '还有疲劳', hint: '刚练过，恢复中' },
  trained: { label: '可再练', hint: '已恢复到可再上强度' },
  detrained: { label: '久未刺激', hint: '很久没练了，可以练回来' }
};

Page({
  data: {
    theme: 'theme-light',
    act: null,
    heroSrc: '',
    heroBadge: '',
    tags: [],
    steps: [],
    muscles: { front: [], back: [] },
    // 肌群当前状态（来自 muscleStatus.js 唯一真源；本页只渲染不计算）
    statusChips: [],
    statusSummary: '',
    statusHint: '',
    hasStatus: false,
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
    this.buildStatus(slugSet);
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

  // 本动作涉及肌群的「当前疲劳状态」。
  //
  // ⚠️ 本页只做两件事：把 slugSet 交给 muscleStatus.js 算、把结果转成可渲染的字段。
  //   **禁在本页重算疲劳、禁复制阈值、禁自己判断三态** —— 那是 utils/muscleStatus.js 的
  //   单源职责，改一份必然漂移（2026-10-13 已因此立过守卫 [B]）。
  //
  // ⚠️ 状态里可能混进「该动作没练到、但被协同肌群牵连」的情况：模型按实际受累肌群累加，
  //   所以协同肌群也可能显示有疲劳 —— 这在语义上是对的（它确实参与过），措辞已按三态中性表述。
  buildStatus(slugSet) {
    const logs = (store.get().trainingLogs) || [];
    const all = muscleStatusOf(logs, Date.now());
    const chips = [];
    let fatigued = 0, detrained = 0;
    slugSet.forEach(slug => {
      const st = all.get(slug);
      if (!st) return;                        // 21 天内没练过 ⇒ 不给状态（不编造）
      if (st.state === 'fatigued') fatigued++;
      if (st.state === 'detrained') detrained++;
      const meta = STATE_META[st.state] || STATE_META.trained;
      chips.push({ slug, name: st.cn, state: st.state, label: meta.label });
    });
    // 摘要句：只描述数据本身，不给建议（模型没有「该不该练」的判断能力）
    let summary = '', hint = '';
    if (!chips.length) {
      summary = '最近还没练过相关肌群';
      hint = '从一次训练开始，这里会显示恢复状态';
    } else if (fatigued) {
      summary = chips.length + ' 块肌群里有 ' + fatigued + ' 块还没恢复';
      hint = STATE_META.fatigued.hint;
    } else if (detrained) {
      summary = chips.length + ' 块肌群里有 ' + detrained + ' 块久未刺激';
      hint = STATE_META.detrained.hint;
    } else {
      summary = chips.length + ' 块肌群都已恢复';
      hint = STATE_META.trained.hint;
    }
    this.setData({ statusChips: chips, statusSummary: summary, statusHint: hint, hasStatus: true });
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

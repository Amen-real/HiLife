// pages/training/training.js
const mock = require('../../utils/mock.js');
const exercises = require('../../utils/exercises.js');
const { media, thumb } = require('../../utils/media.js');
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const categoryEmoji = mock.categoryEmoji;
const theme = require('../../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 深色主题」开关控制，onShow 同步
    theme: 'theme-light',
    mode: 'lib', // lib=动作库 / fav=收藏
    categories: ['全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心', '我的动作'],
    catIcons: { '全部': 'all', '胸部': 'chest', '背部': 'muscleback', '肩膀': 'shoulder', '腿部': 'leg', '手臂': 'arm', '核心': 'core', '我的动作': 'myaction' },
    activeCat: '全部',
    keyword: '',
    list: [],
    selectedIds: {},
    favoriteIds: {},
    selectedCount: 0,
    showCreate: false,
    newName: '',
    parts: ['胸部', '背部', '肩膀', '腿部', '手臂', '核心', '其他'],
    partIndex: 0,
    newWeight: '',
    newReps: '',
    newSets: '',
    catCounts: {},
    selList: [],
    showSelPanel: false,
    selMinimized: false,
    showSelEdit: false,
    editId: '',
    editWeight: '',
    editReps: '',
    editSets: ''
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, theme: themeCls });
    }
    this.syncState();
    this.refresh();
    this.computeCounts();
    this.loadSelList();
  },

  syncState() {
    const sel = {};
    store.get().selectedActions.forEach(a => { sel[a.id] = true; });
    const fav = {};
    store.get().favorites.forEach(id => { fav[id] = true; });
    this.setData({
      selectedIds: sel,
      favoriteIds: fav,
      selectedCount: store.get().selectedActions.length
    });
  },

  refresh() {
    const cat = this.data.activeCat;
    let base = [];
    if (this.data.mode === 'fav') {
      // 收藏：库 + 自建动作里筛出已收藏的
      const lib = exercises.library;
      Object.keys(lib).forEach(k => { if (Array.isArray(lib[k])) base = base.concat(lib[k]); });
      base = base.concat(store.get().customActions);
      const favIds = store.get().favorites;
      base = base.filter(a => favIds.indexOf(a.id) >= 0);
    } else if (cat === '我的动作') {
      base = store.get().customActions;
    } else if (cat === '全部') {
      const lib = exercises.library;
      Object.keys(lib).forEach(k => { if (Array.isArray(lib[k])) base = base.concat(lib[k]); });
    } else {
      base = (exercises.library[cat] || []).slice();
    }
    const isCustomTab = cat === '我的动作' && this.data.mode === 'lib';
    let list = base.map(a => ({
      ...a,
      // 「我的动作」下展示的必然是自建动作，强制打标，覆盖旧数据（无 custom 字段）也能显示删除按钮
      custom: isCustomTab ? true : (a.custom || false),
      nameZh: a.nameZh || a.name,
      image: thumb(a.image || a.video || '', 600, 600),
      // 动作图标用演示 GIF 动图（优先 video，无则回退静态 image）；<image> 渲染 GIF 自动循环播放，不额外加角标
      gif: media(a.video || a.image || ''),
      video: media(a.video || ''),
      emoji: a.emoji || categoryEmoji[a.category] || '🏋️'
    }));
    const kw = this.data.keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(a =>
        (a.name || '').toLowerCase().indexOf(kw) >= 0 ||
        (a.nameZh || '').indexOf(kw) >= 0 ||
        (a.desc || '').toLowerCase().indexOf(kw) >= 0 ||
        (a.equip || '').toLowerCase().indexOf(kw) >= 0 ||
        (a.target || '').toLowerCase().indexOf(kw) >= 0
      );
    }
    this.setData({ list });
  },

  computeCounts() {
    const map = {};
    this.data.categories.forEach(cat => {
      let base = [];
      if (cat === '我的动作') {
        base = store.get().customActions;
      } else if (cat === '全部') {
        const lib = exercises.library;
        Object.keys(lib).forEach(k => { if (Array.isArray(lib[k])) base = base.concat(lib[k]); });
      } else {
        base = (exercises.library[cat] || []).slice();
      }
      map[cat] = base.length;
    });
    this.setData({ catCounts: map });
  },

  switchCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat, keyword: '' }, () => this.refresh());
  },

  // 动作库 / 收藏 切换
  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, keyword: '' }, () => this.refresh());
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.refresh());
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.refresh());
  },

  tapAction(e) {
    const id = e.currentTarget.dataset.id;
    const act = this.data.list.find(a => a.id === id);
    if (!act) return;
    store.get().currentAction = act;
    wx.navigateTo({ url: '/pages/action-detail/action-detail' });
  },

  toggleSelect(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const act = this.data.list.find(a => a.id === id);
    if (!act) return;
    store.toggleSelect(act);
    this.syncState();
  },

  toggleFav(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    store.toggleFavorite(id);
    this.syncState();
  },

  openCreate() { if (!auth.requireLogin()) return; this.setData({ showCreate: true, newName: '', partIndex: 0, newWeight: '', newReps: '', newSets: '' }); },
  closeCreate() { this.setData({ showCreate: false }); },
  onName(e) { this.setData({ newName: e.detail.value }); },
  onPart(e) { this.setData({ partIndex: Number(e.detail.value) }); },
  onWeight(e) { this.setData({ newWeight: e.detail.value }); },
  onReps(e) { this.setData({ newReps: e.detail.value }); },
  onSets(e) { this.setData({ newSets: e.detail.value }); },
  // 由当前弹窗输入构造自定义动作对象（含训练参数）
  buildAction(name) {
    const part = this.data.parts[this.data.partIndex];
    const weight = this.data.newWeight.trim();
    const reps = this.data.newReps.trim();
    const sets = parseInt(this.data.newSets, 10) || 0;
    return {
      id: 'u' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      name: name,
      nameZh: name,
      category: '我的动作',
      custom: true,
      part: part,
      equip: '',
      weight: weight,
      reps: reps,
      setsCount: sets,
      desc: '',
      emoji: '⭐',
      image: '',
      steps: null,
      video: ''
    };
  },
  // 转为带预置组的训练动作，供「本次训练」使用
  toTrainAction(act) {
    const n = Math.max(1, Number(act.setsCount) || 1);
    const reps = act.reps != null && act.reps !== '' ? String(act.reps) : '';
    const weight = act.weight != null && act.weight !== '' ? String(act.weight) : '';
    const sets = Array.from({ length: n }, () => ({ reps, weight, trainSec: 0, restSec: 0 }));
    return {
      id: act.id,
      name: act.name,
      nameZh: act.nameZh || act.name,
      category: act.category,
      part: act.part,
      equip: act.equip,
      image: act.image || '',
      video: act.video || '',
      sets: sets
    };
  },
  // 仅保存到「我的动作」库
  submitCreate() {
    if (!auth.requireLogin()) return;
    const name = this.data.newName.trim();
    if (!name) { wx.showToast({ title: '请输入动作名称', icon: 'none' }); return; }
    store.addCustomAction(this.buildAction(name));
    this.setData({ showCreate: false });
    this.computeCounts(); // 自定义动作永远归「我的动作」，数量徽标需实时 +1
    if (this.data.activeCat === '我的动作') this.refresh();
    wx.showToast({ title: '已创建', icon: 'success' });
  },
  // 保存并直接加入本次训练
  submitAndUse() {
    if (!auth.requireLogin()) return;
    const name = this.data.newName.trim();
    if (!name) { wx.showToast({ title: '请输入动作名称', icon: 'none' }); return; }
    const act = this.buildAction(name);
    store.addCustomAction(act);
    store.addSelected(this.toTrainAction(act));
    this.setData({ showCreate: false });
    this.computeCounts();
    if (this.data.activeCat === '我的动作') this.refresh();
    this.syncState();
    wx.showToast({ title: '已加入本次训练', icon: 'success' });
  },

  noop() {},

  /* ---------- 已选动作总览弹窗（可最小化） ---------- */
  // 打开总览弹窗（从 pill / 底部计数 / 气泡还原 进入）
  openSelPanel() {
    this.loadSelList();
    this.setData({ showSelPanel: true, selMinimized: false });
  },
  // 最小化：弹窗缩成右下角悬浮气泡，训练页可继续操作
  minimizeSelPanel() {
    this.setData({ showSelPanel: false, selMinimized: true });
  },
  // 从悬浮气泡还原弹窗
  restoreSelPanel() {
    this.loadSelList();
    this.setData({ showSelPanel: true, selMinimized: false });
  },
  // 完全关闭（点遮罩 ✕）：连悬浮气泡一并收起
  closeSelPanel() {
    this.setData({ showSelPanel: false, selMinimized: false });
  },

  /* ---------- 已选动作（本次训练）列表与编辑 ---------- */
  // 把 store.selectedActions 映射成便于展示的列表（重量/次数取首组，组数取 sets 长度）
  loadSelList() {
    const arr = store.get().selectedActions.map(a => {
      const sets = a.sets || [];
      const first = sets[0] || {};
      return {
        id: a.id,
        name: a.nameZh || a.name,
        part: a.part || a.category || '',
        weight: (first.weight != null && first.weight !== '') ? String(first.weight) : '',
        reps: (first.reps != null && first.reps !== '') ? String(first.reps) : '',
        setsCount: sets.length
      };
    });
    this.setData({ selList: arr });
  },
  // 打开编辑弹窗并预填当前参数
  editSelected(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.selList.find(s => s.id === id);
    if (!it) return;
    this.setData({
      showSelEdit: true,
      editId: id,
      editWeight: it.weight,
      editReps: it.reps,
      editSets: String(it.setsCount || 1)
    });
  },
  onEditWeight(e) { this.setData({ editWeight: e.detail.value }); },
  onEditReps(e) { this.setData({ editReps: e.detail.value }); },
  onEditSets(e) { this.setData({ editSets: e.detail.value }); },
  closeSelEdit() { this.setData({ showSelEdit: false }); },
  // 保存编辑：用新重量/次数/组数重建该动作的 sets 数组（保留各组已记录的计时秒数）
  saveSelEdit() {
    if (!auth.requireLogin()) return;
    const id = this.data.editId;
    const weight = this.data.editWeight.trim();
    const reps = this.data.editReps.trim();
    const n = Math.max(1, parseInt(this.data.editSets, 10) || 1);
    const cur = store.get().selectedActions.find(a => a.id === id);
    const oldSets = (cur && cur.sets) || [];
    const sets = Array.from({ length: n }, (_, i) => ({
      reps: reps,
      weight: weight,
      trainSec: oldSets[i] ? oldSets[i].trainSec : 0,
      restSec: oldSets[i] ? oldSets[i].restSec : 0
    }));
    store.updateSelected(id, { sets });
    this.setData({ showSelEdit: false });
    this.loadSelList();
    wx.showToast({ title: '已更新', icon: 'success' });
  },
  // 从本次训练移除某个已选动作
  removeSelected(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const it = this.data.selList.find(s => s.id === id);
    const name = it ? it.name : '该动作';
    wx.showModal({
      title: '移除动作',
      content: '确定从本次训练中移除「' + name + '」吗？',
      confirmColor: '#E53E3E',
      success: (res) => {
        if (!res.confirm) return;
        store.removeSelected(id);
        this.loadSelList();
        this.syncState();
        if (store.get().selectedActions.length === 0) {
          this.closeSelPanel();
        }
        wx.showToast({ title: '已移除', icon: 'success' });
      }
    });
  },

  // 删除手动添加的动作（仅「我的动作」中的自建动作有此按钮）
  deleteCustom(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const act = this.data.list.find(a => a.id === id);
    const name = act ? (act.nameZh || act.name) : '该动作';
    wx.showModal({
      title: '删除动作',
      content: '确定删除「' + name + '」吗？该动作将从「我的动作」移除。',
      confirmColor: '#E53E3E',
      success: (res) => {
        if (!res.confirm) return;
        store.removeCustomAction(id);
        this.computeCounts();
        if (this.data.activeCat === '我的动作') this.refresh();
        this.syncState();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  startTraining() {
    if (!auth.requireLogin()) return;
    let sel = store.get().selectedActions;
    if (!sel.length) {
      // 未选动作：自动预选各部位代表动作，保证「开始训练」一定能开练
      const picks = [];
      ['胸部', '背部', '腿部', '核心'].forEach(cat => {
        const arr = exercises.library[cat] || [];
        if (arr[0]) picks.push(arr[0]);
      });
      if (!picks.length) picks.push(...mock.myActions.slice(0, 3));
      picks.forEach(a => store.toggleSelect(a));
      wx.showToast({ title: '已自动选好 ' + picks.length + ' 个动作', icon: 'none' });
    }
    wx.navigateTo({ url: '/pages/workout/workout' });
  }
});

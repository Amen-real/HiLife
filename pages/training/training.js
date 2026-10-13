// pages/training/training.js
const exercises = require('../../utils/exercises.js');
const { media, thumb } = require('../../utils/media.js');
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');

// 分类 -> emoji 占位图。原先来自 utils/mock.js，但那个文件另外三个导出
// （actionLibrary / dietRecommend / myActions）已全部无人引用，为这 7 行养一个 12KB
// 的模块不划算，故随 mock.js 一起删掉、就地保留。只有本页用，不必再抽公共常量。
const CATEGORY_EMOJI = {
  '胸部': '💪',
  '背部': '🔙',
  '肩膀': '🤷',
  '腿部': '🦵',
  '手臂': '💪',
  '核心': '🔥',
  '我的动作': '⭐'
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// ══════════════════════════════════════════════════════════════════════════
// 器械维度（equip）
//
// 为什么需要它（2026-10-13）：动作库一直只有【身体部位】一个筛选维度，但
// equip 是真实存在且信息量很大的一维 —— 实测 1295 条动作里：
//   自重 304(23.5%) · 哑铃 293 · 其他 219 · 绳索 157 · 杠铃 156 ·
//   器械 48 · 壶铃 41 · 瑞士球 28 · 雪橇 15 · 药球 13 · 泡沫轴 10 · 战绳 9 ·
//   有氧器械 1 · 轮胎 1
// **「自重」是最大的一类（304条，比哑铃还多），却完全不可见** —— 用户搜得到、看不见入口。
//
// 为什么不是「把自重加进分类行」：分类是【身体部位】（胸/背/肩/腿/手臂/核心），
// 器械是另一个维度；混进同一行会让两种语义打架，且自重动作横跨全部 6 个分类
// （腿部 83 / 核心 91 / 背部 59 / 胸部 36 / 手臂 33 / 肩膀 2），无处安放。
// ⇒ 独立成第二行，且**与分类叠加**（器械=哑铃 + 分类=胸部 → 只看哑铃练胸）。
//
// 为什么尾部合并：14 个器械里 6 个只有 1~15 条，全铺开筛选条会长到 15 项没法用。
// ⇒ 只把 ≥ EQUIP_MIN_COUNT 的独立成项，其余归入「其他器械」（实测共 49 条）。
// ⚠️ 阈值不是拍脑袋：28 条（瑞士球）以下全并入，合并后仍有 49 条，够用户用。
// ⚠️ 数量是**实测统计**，改动动作库后必须重跑 guard（见 verify-training-equip-filter）。
const EQUIP_MIN_COUNT = 28;
// 兜底桶名；不在此列的器械一律归它
const EQUIP_OTHER = '其他器械';

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 深色主题」开关控制，onShow 同步
    theme: 'theme-light',
    mode: 'lib', // lib=动作库 / fav=收藏
    categories: ['全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心', '我的动作'],
    catIcons: { '全部': 'all', '胸部': 'chest', '背部': 'muscleback', '肩膀': 'shoulder', '腿部': 'leg', '手臂': 'arm', '核心': 'core', '我的动作': 'myaction' },
    activeCat: '全部',
    // 器械筛选：equips 由 buildEquips() 依实测分布生成，activeEquip='全部' 表示不限
    equips: [],
    equipCounts: {},
    activeEquip: '全部',
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
    this.computeCounts();
    this.computeEquips();   // 器械条随 onShow 重算（动作库可能已变）
    // ⚠️ 顺序：refresh 必须在 computeEquips【之后】—— refresh 要读 activeEquip 做叠加过滤，
    //   而 computeEquips 可能把已失效的 activeEquip 回落成「全部」。先算后刷才不会用旧值过滤。
    this.refresh();
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

  // 器械桶：把 < EQUIP_MIN_COUNT 的零散器械合并进 EQUIP_OTHER，其余独立成项。
  // ⚠️ 只统计**内置动作库**（含自建动作），但自建动作 equip 恒为空（创建表单只填 part），
  //   所以它们天然不落进任何器械桶 —— 见 refresh() 里的处理说明。
  equipBuckets() {
    const lib = exercises.library;
    const raw = {};
    Object.keys(lib).forEach(k => {
      if (!Array.isArray(lib[k])) return;
      lib[k].forEach(a => {
        const e = a.equip || '';
        if (!e) return;
        raw[e] = (raw[e] || 0) + 1;
      });
    });
    const main = Object.keys(raw).filter(e => raw[e] >= EQUIP_MIN_COUNT).sort((a, b) => raw[b] - raw[a]);
    const rest = Object.keys(raw).filter(e => raw[e] < EQUIP_MIN_COUNT);
    const names = main.slice();
    if (rest.length) names.push(EQUIP_OTHER);
    const counts = {};
    names.forEach(n => { counts[n] = (n === EQUIP_OTHER) ? rest.reduce((s, e) => s + raw[e], 0) : raw[n]; });
    return { names, counts, rest };
  },

  // 动作 a 是否属于当前选中的器械桶
  matchesEquip(a) {
    const pick = this.data.activeEquip;
    if (pick === '全部') return true;
    if (pick === EQUIP_OTHER) {
      const rest = this._equipRest || {};
      const e = a.equip || '';
      return !!e && rest.indexOf(e) >= 0;
    }
    return (a.equip || '') === pick;
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
      emoji: a.emoji || CATEGORY_EMOJI[a.category] || '🏋️'
    }));

    // 器械维度叠加（在搜索之前，两者是 AND 关系）
    // ⚠️ 自建动作 equip 恒为空（创建表单只有 part），所以选中任一器械时它们会被过滤掉。
    //   这是**有意行为**：器械筛选回答的是「用这类器械的动作有哪些」，而自建动作
    //   没有器械信息，拿它冒充任何一类都是编造。想找自建动作请切回「我的动作」分类。
    if (this.data.activeEquip !== '全部') {
      list = list.filter(a => this.matchesEquip(a));
    }

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

  // 器械条的数据：名称顺序 + 各桶数量（供 UI 显示条数）。
  // ⚠️ 数量统计的是**内置动作库**；自建动作 equip 为空，不计入任何桶（见 refresh 注释）。
  //   若 activeEquip 已不在新列表里（例如动作库更新后某器械被删），回落到「全部」——
  //   否则用户会停在一个永远为空的筛选上，且没有任何办法察觉。
  computeEquips() {
    const { names, counts, rest } = this.equipBuckets();
    this._equipRest = rest;
    const patch = { equips: ['全部'].concat(names), equipCounts: counts };
    if (this.data.activeEquip !== '全部' && names.indexOf(this.data.activeEquip) < 0) {
      patch.activeEquip = '全部';
    }
    this.setData(patch);
  },

  switchCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat, keyword: '' }, () => this.refresh());
  },

  // 器械筛选条：与分类【叠加】（AND），切换不清空分类 —— 目的是「哑铃 × 胸部」这类组合。
  // ⚠️ 切换器械**要**清空关键词：用户刚搜的词可能只对上一个器械留着，留着会让新筛选「看起来是空的」，
  //   而这不是用户能理解的因果。与分类栏行为一致（switchCat 也清 keyword）。
  switchEquip(e) {
    this.setData({ activeEquip: e.currentTarget.dataset.equip, keyword: '' }, () => this.refresh());
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
      // 兜底不再塞 mock 假动作（旧写法 mock.myActions.slice(0,3)）：那些动作在
      // exercises.library 里根本不存在，一旦灌进 selectedActions，训练页取不到动作图/步骤，
      // 整场训练都是坏的；更糟的是用户分不清「库没加载」还是「自己选错了」。
      // 四分类同时为空 = 动作库异常，唯一正确的做法是明说并中止，别带着坏数据进训练页。
      if (!picks.length) {
        wx.showToast({ title: '动作库未加载，请退出重进本页', icon: 'none' });
        return;
      }
      picks.forEach(a => store.toggleSelect(a));
      wx.showToast({ title: '已自动选好 ' + picks.length + ' 个动作', icon: 'none' });
    }
    wx.navigateTo({ url: '/pages/workout/workout' });
  }
});

// pages/plan/plan.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const exercises = require('../../utils/exercises.js');
const presets = require('../../presets/plans.js');
const theme = require('../../utils/theme.js');

// 把预设训练日的动作展开为 store 计划动作（回查 exercises 补全展示字段）
function buildPlanActions(day) {
  const lib = exercises.library;
  const find = (id) => {
    for (const k in lib) {
      const f = (lib[k] || []).find(a => a.id === id);
      if (f) return f;
    }
    return null;
  };
  return day.actions.map(a => {
    const s = find(a.exerciseId) || {};
    return {
      actionId: a.exerciseId,
      name: s.name || '',
      nameZh: s.nameZh || s.name || '',
      part: s.category || '',
      category: s.category || '',
      setsCount: a.setsCount || 0,
      reps: a.reps || '',
      weight: ''
    };
  });
}

// 推荐模板缩略图（小程序不渲染 SVG，用深色渐变块 + emoji 模拟 03 设计稿的 SVG 剪影）
const GOAL_THUMB = {
  '增肌': { emoji: '🏋️', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' },
  '力量': { emoji: '💪', bg: 'linear-gradient(180deg,#1E2A4A,#0A0F1E)', accent: '#3E8BFF' },
  '减脂': { emoji: '🔥', bg: 'linear-gradient(180deg,#3A1F1F,#1A0A0A)', accent: '#FF9500' },
  '耐力': { emoji: '🏃', bg: 'linear-gradient(180deg,#1E3A2A,#0A1A12)', accent: '#6F9F00' },
  '全身': { emoji: '🤸', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' }
};
const DEFAULT_THUMB = { emoji: '🏋️', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' };

const CATEGORIES = ['我的动作', '全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心'];

// 按分类取动作池；'全部' 合并「我的动作」与动作库所有部位
function poolOf(cat) {
  if (cat === '我的动作') return store.get().customActions;
  if (cat === '全部') {
    let b = store.get().customActions.slice();
    Object.keys(exercises.library).forEach(k => { if (Array.isArray(exercises.library[k])) b = b.concat(exercises.library[k]); });
    return b;
  }
  return exercises.library[cat] || [];
}

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 深色主题」开关控制，onShow 同步
    theme: 'theme-light',
    mode: 'list',          // list | create
    seg: 'mine',           // mine（我的计划） | tpl（模板推荐）
    plans: [],
    activePlanId: '',
    // 新建流程
    catList: CATEGORIES,
    activeCat: '我的动作',
    actionPool: [],        // 当前分类过滤后的动作（单分类小列表，避免千条全量渲染）
    pickedMap: {},         // 已选动作 id -> true（仅驱动样式，详情存实例变量）
    pickedCount: 0,
    planName: '',          // 编辑模式回填到 name input 的受控值（仅初始显示，输入走实例变量 _planName）
    isEdit: false,         // true=编辑已有计划，false=新建
    // 推荐方案（预设计划库）
    programs: [],
    expandedId: ''
  },

  onLoad() {
    // 预设计划库一次性映射进 data（纯展示，无需每次 onShow 重算）
    this.setData({
      programs: (presets.PROGRAMS || []).map(p => {
        const th = GOAL_THUMB[p.goal] || DEFAULT_THUMB;
        return {
          id: p.id, name: p.name, goal: p.goal, level: p.level,
          daysPerWeek: p.daysPerWeek, desc: p.desc, days: p.days,
          sub: p.level + ' · ' + p.daysPerWeek + '天/周',
          emoji: th.emoji, thumbBg: th.bg, accent: th.accent
        };
      })
    });
  },

  // 分段切换：我的计划 / 模板推荐
  switchSeg(e) {
    this.setData({ seg: e.currentTarget.dataset.seg });
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    // 「计划」现为 tab 页（第 3 个，索引 2）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, theme: themeCls });
    }
    this.loadPlans();
  },

  loadPlans() {
    const g = store.get();
    this.setData({
      plans: g.trainingPlans.map(p => ({
        id: p.id,
        name: p.name,
        count: (p.actions || []).length,
        isActive: p.id === g.activePlanId
      })),
      activePlanId: g.activePlanId
    });
  },

  // 进入新建：重置选择，按当前分类加载动作池
  goCreate() {
    this._editId = null;
    this._planName = '';
    this._pickedDetails = {};   // 已选动作详情（实例变量，供保存用，不进 data）
    this.setData({
      mode: 'create',
      isEdit: false,
      planName: '',
      pickedMap: {},
      pickedCount: 0,
      activeCat: '我的动作',
      actionPool: []
    }, () => this.loadActions());
  },
  backToList() { this.loadPlans(); this.setData({ mode: 'list' }); },

  // 展开/收起推荐方案详情
  toggleProgram(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  // 把某方案的某训练日导入为「今日训练计划」
  importDay(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const di = Number(e.currentTarget.dataset.di);
    const program = (presets.PROGRAMS || []).find(p => p.id === pid);
    if (!program) return;
    const day = program.days[di];
    if (!day) return;
    const created = store.addPlan({
      name: program.name + ' · ' + day.name,
      actions: buildPlanActions(day)
    });
    store.setActivePlan(created.id);
    store.applyPlanToSelected(created);
    wx.showToast({ title: '已导入今日训练', icon: 'success' });
    wx.switchTab({ url: '/pages/home/home' });
  },

  // 动作选择器：按分类加载，单分类渲染（避坑：不一次渲染千条）；'全部' 合并所有部位
  loadActions() {
    const list = poolOf(this.data.activeCat).map(a => ({
      id: a.id,
      name: a.name,
      nameZh: a.nameZh || a.name,
      category: a.category || a.part || this.data.activeCat,
      part: a.part || a.category || this.data.activeCat
    }));
    this.setData({ actionPool: list });
  },

  switchCat(e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat }, () => this.loadActions());
  },
  onSearch(e) {
    const kw = e.detail.value.trim().toLowerCase();
    let list = poolOf(this.data.activeCat).map(a => ({
      id: a.id, name: a.name, nameZh: a.nameZh || a.name,
      category: a.category || a.part || this.data.activeCat,
      part: a.part || a.category || this.data.activeCat
    }));
    if (kw) {
      list = list.filter(a =>
        (a.name || '').toLowerCase().indexOf(kw) >= 0 ||
        (a.nameZh || '').indexOf(kw) >= 0
      );
    }
    this.setData({ actionPool: list });
  },
  // 选/取消动作：data 只存 pickedMap(id->bool) 驱动样式，详情存实例变量供保存用（避免大对象进 data）
  togglePick(e) {
    const id = e.currentTarget.dataset.id;
    const act = this.data.actionPool.find(a => a.id === id);
    if (!act) return;
    const exist = !!this.data.pickedMap[id];
    const map = Object.assign({}, this.data.pickedMap);
    this._pickedDetails = this._pickedDetails || {};
    if (exist) {
      delete map[id];
      delete this._pickedDetails[id];
    } else {
      map[id] = true;
      this._pickedDetails[id] = {
        actionId: act.id, name: act.name, nameZh: act.nameZh,
        part: act.part, category: act.category, setsCount: 0, reps: '', weight: ''
      };
    }
    this.setData({ pickedMap: map, pickedCount: Object.keys(map).length });
  },
  // 计划名称输入：暂存实例变量，不 setData（避坑：避免整页重渲染丢字）
  onPlanName(e) { this._planName = e.detail.value; },

  savePlan() {
    if (!auth.requireLogin()) return;
    const name = (this._planName || '').trim();
    if (!name) { wx.showToast({ title: '请输入计划名称', icon: 'none' }); return; }
    const actions = Object.keys(this._pickedDetails || {}).map(id => this._pickedDetails[id]);
    if (!actions.length) { wx.showToast({ title: '请至少选择一个动作', icon: 'none' }); return; }
    if (this._editId) {
      store.updatePlan(this._editId, { name, actions });
      wx.showToast({ title: '已更新', icon: 'success' });
      this._finishCreate();
    } else {
      const created = store.addPlan({ name, actions });
      // 创建成功不直接默认为“使用中”，让用户确认是否作为今日计划
      wx.showModal({
        title: '创建成功',
        content: '是否立即使用「' + name + '」作为今日训练计划？',
        confirmText: '确认使用',
        confirmColor: '#1AA885',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) this._confirmUse(created.id);
          else this._finishCreate();
        }
      });
    }
  },

  // 确认使用：设为当前计划 + 注入今日训练（首页「今日训练计划」随即显示），再跳回首页
  _confirmUse(id) {
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) { this._finishCreate(); return; }
    store.setActivePlan(id);
    store.applyPlanToSelected(plan);
    this._finishCreate();
    wx.switchTab({ url: '/pages/home/home' });
  },

  // 收尾：清空表单并回到列表（编辑/取消/确认共用，避免重复）
  _finishCreate() {
    this._editId = null;
    this._planName = '';
    this._pickedDetails = {};
    this.setData({ mode: 'list', isEdit: false, planName: '' });
    this.loadPlans();
  },

  startPlan(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    store.applyPlanToSelected(plan);
    wx.switchTab({ url: '/pages/training/training' });
  }
});

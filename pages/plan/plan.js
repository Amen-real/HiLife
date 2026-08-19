// pages/plan/plan.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const exercises = require('../../utils/exercises.js');

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
    mode: 'list',          // list | create
    plans: [],
    activePlanId: '',
    // 新建流程
    catList: CATEGORIES,
    activeCat: '我的动作',
    actionPool: [],        // 当前分类过滤后的动作（单分类小列表，避免千条全量渲染）
    pickedMap: {},         // 已选动作 id -> true（仅驱动样式，详情存实例变量）
    pickedCount: 0,
    planName: '',          // 编辑模式回填到 name input 的受控值（仅初始显示，输入走实例变量 _planName）
    isEdit: false          // true=编辑已有计划，false=新建
  },

  onShow() {
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
  // 进入编辑：复用新建表单，预填名称与已选动作
  goEdit(e) {
    const id = e.currentTarget.dataset.id;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    this._editId = id;
    this._planName = plan.name;
    this._pickedDetails = {};
    const map = {};
    (plan.actions || []).forEach(a => {
      this._pickedDetails[a.actionId] = {
        actionId: a.actionId, name: a.name, nameZh: a.nameZh,
        part: a.part, category: a.category, setsCount: a.setsCount || 0, reps: a.reps || '', weight: a.weight || ''
      };
      map[a.actionId] = true;
    });
    this.setData({
      mode: 'create',
      isEdit: true,
      planName: plan.name,
      pickedMap: map,
      pickedCount: Object.keys(map).length,
      activeCat: '全部',
      actionPool: []
    }, () => this.loadActions());
  },
  backToList() { this.loadPlans(); this.setData({ mode: 'list' }); },

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

  setActive(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    store.setActivePlan(id);
    // 关键修复：首页「今日训练计划」读取的是 selectedActions，仅 setActivePlan 不会在首页显示；
    // 必须 applyPlanToSelected 把计划注入今日训练，首页才会显示动作
    store.applyPlanToSelected(plan);
    this.loadPlans();
    wx.showToast({ title: '已设为今日计划', icon: 'success' });
    wx.switchTab({ url: '/pages/home/home' });
  },
  startPlan(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    store.applyPlanToSelected(plan);
    wx.switchTab({ url: '/pages/training/training' });
  },
  deletePlan(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    const name = (plan && plan.name) || '该计划';
    wx.showModal({
      title: '删除计划',
      content: '确定删除「' + name + '」吗？',
      confirmColor: '#E53E3E',
      success: (res) => {
        if (!res.confirm) return;
        store.deletePlan(id);
        this.loadPlans();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  }
});

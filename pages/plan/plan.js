// pages/plan/plan.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const exercises = require('../../utils/exercises.js');
const presets = require('../../presets/plans.js');
const theme = require('../../utils/theme.js');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return fmtDate(new Date()); }

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

// 按 id 回查动作名（优先 nameZh，回退 note / id），用于模板详情弹层展示
function resolveExerciseName(id, fallback) {
  const lib = exercises.library;
  for (const k in lib) {
    const f = (lib[k] || []).find(a => a.id === id);
    if (f) return f.nameZh || f.name || fallback || id;
  }
  return fallback || id;
}

// 推荐模板缩略图：深色渐变块 + 目标图标（mask 图标体系，颜色由 accent 决定）。
// 图标映射：增肌=arm / 力量=dumbbell / 减脂=flame / 耐力=pulse / 全身=body / 通用=body
// 注：'通用' 曾被注释标记为 all 却漏建键，导致预设计划「新手·全身入门」静默落到 DEFAULT_THUMB；
//     此处补齐。给 body 图标（全身性计划）以与兜底态区分，且与 '全身' 语义一致。
const GOAL_THUMB = {
  '增肌': { icon: 'arm', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' },
  '力量': { icon: 'dumbbell', bg: 'linear-gradient(180deg,#1E2A4A,#0A0F1E)', accent: '#3E8BFF' },
  '减脂': { icon: 'flame', bg: 'linear-gradient(180deg,#3A1F1F,#1A0A0A)', accent: '#FF9500' },
  '耐力': { icon: 'pulse', bg: 'linear-gradient(180deg,#1E3A2A,#0A1A12)', accent: '#6F9F00' },
  '全身': { icon: 'body', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' },
  '通用': { icon: 'body', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' }
};
const DEFAULT_THUMB = { icon: 'all', bg: 'linear-gradient(180deg,#2C2C2C,#0A0A0A)', accent: '#C8FF00' };

// 红线：wxml 行内 style 禁止 Mustache 插值，必须在 JS 侧拼好「完整 CSS 字符串」，wxml 只写 style="{{xxx}}"。
function thumbStyles(th, size) {
  return {
    icon: th.icon,
    thumbStyle: 'background: ' + th.bg,
    accentStyle: 'background: ' + th.accent,
    icoStyle: 'width: ' + size + 'rpx; height: ' + size + 'rpx; background-color: ' + th.accent
  };
}

const CATEGORIES = ['我的动作', '全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心'];

function poolOf(cat) {
  if (cat === '我的动作') return store.get().customActions;
  if (cat === '全部') {
    let b = store.get().customActions.slice();
    Object.keys(exercises.library).forEach(k => { if (Array.isArray(exercises.library[k])) b = b.concat(exercises.library[k]); });
    return b;
  }
  return exercises.library[cat] || [];
}

// 本周一 00:00（周一为一周起点）
function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

// 本周训练 Dashboard 数据：本周已训练天数 / 目标(active 计划的 daysPerWeek 或默认5) / 进度% / 连续天数
function computeWeek() {
  const g = store.get();
  const logs = g.trainingLogs || [];
  const dates = new Set(logs.map(l => l.date));
  const now = new Date();
  const mon = mondayOf(now);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 7);
  const monStr = fmtDate(mon), sunStr = fmtDate(sun);
  let done = 0;
  dates.forEach(dt => { if (dt >= monStr && dt < sunStr) done++; });
  // 连续训练天数（截至今天）
  let streak = 0;
  const d = new Date(todayStr() + 'T00:00:00');
  while (dates.has(fmtDate(d))) { streak++; d.setDate(d.getDate() - 1); }
  const active = store.getActivePlan();
  const target = (active && active.daysPerWeek) ? Number(active.daysPerWeek) : 5;
  const pct = target > 0 ? Math.min(100, Math.round(done / target * 100)) : 0;
  return { done, target, pct, streak, barStyle: 'width:' + pct + '%' };
}

// 计划卡的派生指标：动作数 / 时长(分钟) / 预计消耗(kcal)
function planMetrics(plan) {
  const acts = plan.actions || [];
  const count = acts.length;
  let totalSets = 0;
  acts.forEach(a => { totalSets += Number(a.setsCount) || 0; });
  const minutes = Math.max(10, Math.round(totalSets * 1.5));
  const kcal = Math.max(60, Math.round(minutes * 10));
  return { count, minutes, kcal };
}

Page({
  data: {
    theme: 'theme-light',
    mode: 'list',          // list | create
    seg: 'mine',           // mine（我的计划） | tpl（模板推荐）
    plans: [],
    activePlanId: '',
    week: { done: 0, target: 5, pct: 0, streak: 0, barStyle: 'width:0%' },
    // 更多菜单
    showMenu: false,
    menuId: '',
    menuName: '',
    // 计划详情（查看）
    showPlanDetail: false,
    planDetail: null,
    // 新建流程
    catList: CATEGORIES,
    activeCat: '我的动作',
    actionPool: [],
    pickedMap: {},
    pickedCount: 0,
    planName: '',
    isEdit: false,
    programs: [],
    showTpl: false,
    tplDetail: null,
    goalOptions: ['增肌', '力量', '减脂', '耐力', '全身', '通用'],
    levelOptions: ['入门', '中级', '进阶'],
    goal: '',
    level: '',
    daysPerWeek: '',
    desc: '',
    pickedList: []
  },

  onLoad() {
    this.setData({
      programs: (presets.PROGRAMS || []).map(p => {
        const th = GOAL_THUMB[p.goal] || DEFAULT_THUMB;
        return Object.assign({
          id: p.id, name: p.name, goal: p.goal, level: p.level,
          daysPerWeek: p.daysPerWeek, desc: p.desc, days: p.days,
          sub: p.level + ' · ' + p.daysPerWeek + '天/周'
        }, thumbStyles(th, 64));
      })
    });
  },

  switchSeg(e) {
    this.setData({ seg: e.currentTarget.dataset.seg });
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, theme: themeCls });
    }
    this.dedupeTemplatePlans();
    this.loadPlans();
  },

  // 清理重复的模板计划（早期版本每次导入模板都新建），手动计划不受影响
  dedupeTemplatePlans() {
    const tplNames = {};
    (presets.PROGRAMS || []).forEach(p => {
      (p.days || []).forEach(d => { tplNames[p.name + ' · ' + d.name] = true; });
    });
    const g = store.get();
    const list = g.trainingPlans || [];
    const seen = {};
    const drop = [];
    list.forEach(p => {
      const isTpl = !!p.programId || !!tplNames[p.name];
      if (!isTpl) return;
      if (seen[p.name]) drop.push(p.id);
      else seen[p.name] = p.id;
    });
    if (!drop.length) return;
    let activeId = g.activePlanId;
    if (drop.indexOf(activeId) >= 0) activeId = seen[list.find(p => p.id === activeId).name] || '';
    g.trainingPlans = list.filter(p => drop.indexOf(p.id) < 0);
    g.activePlanId = activeId;
    store.persist();
  },

  loadPlans() {
    const g = store.get();
    const today = todayStr();
    const trainedToday = (g.trainingLogs || []).some(l => l.date === today);
    const activeId = g.activePlanId;
    let plans = (g.trainingPlans || []).map(p => {
      const m = planMetrics(p);
      const isActive = p.id === activeId;
      let statusText, statusCls, statusDot;
      if (isActive) {
        if (trainedToday) { statusText = '今日已完成'; statusCls = 'done'; statusDot = 'solid'; }
        else { statusText = '今日未训练'; statusCls = 'todo'; statusDot = 'hollow'; }
      } else {
        if (trainedToday) { statusText = '今日已完成'; statusCls = 'done'; statusDot = 'solid'; }
        else { statusText = '未训练'; statusCls = 'idle'; statusDot = 'muted'; }
      }
      return {
        id: p.id,
        name: p.name,
        count: m.count,
        minutes: m.minutes,
        kcal: m.kcal,
        goal: p.goal || '',
        level: p.level || '',
        isActive,
        featured: isActive,    // 首卡（active 计划）作为今日重点
        todayTag: isActive,   // [今日] Lime Green 标签
        statusText, statusCls, statusDot
      };
    });
    // active 计划排最前，作为「今天最值得完成的训练」
    plans.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    this.setData({
      plans,
      activePlanId: activeId,
      week: computeWeek()
    });
  },

  // —— 新建 / 编辑 表单 ——
  goCreate() {
    this._editId = null;
    this._planName = '';
    this._goal = '';
    this._level = '';
    this._daysPerWeek = '';
    this._desc = '';
    this._pickedDetails = {};
    this.setData({
      mode: 'create', isEdit: false, planName: '', pickedMap: {}, pickedCount: 0, pickedList: [],
      goal: '', level: '', daysPerWeek: '', desc: '', activeCat: '我的动作', actionPool: []
    }, () => this.loadActions());
  },
  backToList() {
    this._editId = null;
    this._goal = ''; this._level = ''; this._daysPerWeek = ''; this._desc = '';
    this.loadPlans();
    this.setData({ mode: 'list', goal: '', level: '', daysPerWeek: '', desc: '', pickedList: [] });
  },

  // —— 模板推荐 ——
  openProgram(e) {
    const id = e.currentTarget.dataset.id;
    const p = (presets.PROGRAMS || []).find(x => x.id === id);
    if (!p) return;
    const th = GOAL_THUMB[p.goal] || DEFAULT_THUMB;
    const detail = Object.assign({
      id: p.id, name: p.name, goal: p.goal, level: p.level, daysPerWeek: p.daysPerWeek, desc: p.desc,
      days: p.days.map((d, di) => ({
        idx: di, name: d.name, focus: d.focus,
        actions: d.actions.map(a => ({
          exerciseId: a.exerciseId, name: resolveExerciseName(a.exerciseId, a.note),
          note: a.note || '', setsCount: a.setsCount, reps: a.reps
        }))
      }))
    }, thumbStyles(th, 52));
    this.setData({ showTpl: true, tplDetail: detail });
  },
  closeTpl() { this.setData({ showTpl: false }); },
  noop() {},
  importDay(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const di = Number(e.currentTarget.dataset.di);
    const program = (presets.PROGRAMS || []).find(p => p.id === pid);
    if (!program) return;
    const day = program.days[di];
    if (!day) return;
    const planName = program.name + ' · ' + day.name;
    let plan = store.get().trainingPlans.find(
      p => (p.programId === pid && p.dayIndex === di) || p.name === planName
    );
    if (!plan) {
      plan = store.addPlan({
        name: planName, programId: pid, dayIndex: di, source: 'template',
        actions: buildPlanActions(day)
      });
    }
    store.setActivePlan(plan.id);
    // 注意：计划流程不写 selectedActions（训练页「已选动作」只存手动勾选），今日推荐卡片由 activePlanId 驱动
    this.setData({ showTpl: false });
    this.loadPlans();
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    const homePage = pages.find(p => p && p.route === 'pages/home/home');
    if (homePage && typeof homePage.refresh === 'function') homePage.refresh();
    wx.showToast({ title: '已导入今日训练', icon: 'success' });
  },

  // —— 动作选择器 ——
  loadActions() {
    const list = poolOf(this.data.activeCat).map(a => ({
      id: a.id, name: a.name, nameZh: a.nameZh || a.name,
      category: a.category || a.part || this.data.activeCat,
      part: a.part || a.category || this.data.activeCat
    }));
    this.setData({ actionPool: list });
  },
  switchCat(e) { this.setData({ activeCat: e.currentTarget.dataset.cat }, () => this.loadActions()); },
  onSearch(e) {
    const kw = e.detail.value.trim().toLowerCase();
    let list = poolOf(this.data.activeCat).map(a => ({
      id: a.id, name: a.name, nameZh: a.nameZh || a.name,
      category: a.category || a.part || this.data.activeCat,
      part: a.part || a.category || this.data.activeCat
    }));
    if (kw) list = list.filter(a => (a.name || '').toLowerCase().indexOf(kw) >= 0 || (a.nameZh || '').indexOf(kw) >= 0);
    this.setData({ actionPool: list });
  },
  togglePick(e) {
    const id = e.currentTarget.dataset.id;
    const act = this.data.actionPool.find(a => a.id === id);
    if (!act) return;
    const exist = !!this.data.pickedMap[id];
    const map = Object.assign({}, this.data.pickedMap);
    this._pickedDetails = this._pickedDetails || {};
    let list = this.data.pickedList.slice();
    if (exist) {
      delete map[id];
      delete this._pickedDetails[id];
      list = list.filter(x => x.actionId !== id);
    } else {
      const detail = { actionId: act.id, name: act.name, nameZh: act.nameZh, part: act.part, category: act.category, setsCount: 3, reps: '8-12', rest: 60, weight: '' };
      map[id] = true;
      this._pickedDetails[id] = detail;
      list.push(detail);
    }
    this.setData({ pickedMap: map, pickedCount: list.length, pickedList: list });
  },
  onPlanName(e) { this._planName = e.detail.value; },
  onGoal(e) { this._goal = e.currentTarget.dataset.v; this.setData({ goal: this._goal }); },
  onLevel(e) { this._level = e.currentTarget.dataset.v; this.setData({ level: this._level }); },
  onDaysPerWeek(e) { this._daysPerWeek = e.detail.value; },
  onDesc(e) { this._desc = e.detail.value; },
  onActionSets(e) {
    const id = e.currentTarget.dataset.aid;
    const n = parseInt(e.detail.value, 10) || 0;
    if (this._pickedDetails[id]) this._pickedDetails[id].setsCount = n;
    const idx = this.data.pickedList.findIndex(x => x.actionId === id);
    if (idx >= 0) this.setData({ ['pickedList[' + idx + '].setsCount']: n });
  },
  onActionReps(e) {
    const id = e.currentTarget.dataset.aid;
    const v = e.detail.value;
    if (this._pickedDetails[id]) this._pickedDetails[id].reps = v;
    const idx = this.data.pickedList.findIndex(x => x.actionId === id);
    if (idx >= 0) this.setData({ ['pickedList[' + idx + '].reps']: v });
  },

  savePlan() {
    if (!auth.requireLogin()) return;
    const name = (this._planName || '').trim();
    if (!name) { wx.showToast({ title: '请输入计划名称', icon: 'none' }); return; }
    const actions = Object.keys(this._pickedDetails || {}).map(id => this._pickedDetails[id]);
    if (!actions.length) { wx.showToast({ title: '请至少选择一个动作', icon: 'none' }); return; }
    if (this._editId) {
      store.updatePlan(this._editId, {
        name, goal: this._goal, level: this._level,
        daysPerWeek: this._daysPerWeek ? Number(this._daysPerWeek) : 0,
        desc: this._desc, actions
      });
      wx.showToast({ title: '已更新', icon: 'success' });
      this._finishCreate();
    } else {
      const created = store.addPlan({
        name, goal: this._goal, level: this._level,
        daysPerWeek: this._daysPerWeek ? Number(this._daysPerWeek) : 0,
        desc: this._desc, actions
      });
      wx.showModal({
        title: '创建成功',
        content: '是否立即使用「' + name + '」作为今日训练计划？',
        confirmText: '确认使用',
        confirmColor: '#1AA885',
        cancelText: '暂不',
        success: (res) => { if (res.confirm) this._confirmUse(created.id); else this._finishCreate(); }
      });
    }
  },
  _confirmUse(id) {
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) { this._finishCreate(); return; }
    store.setActivePlan(id);
    // 计划流程不写 selectedActions：首页今日推荐卡片由 activePlanId 驱动，训练页已选列表保持纯净
    this._finishCreate();
    wx.switchTab({ url: '/pages/home/home' });
  },
  _finishCreate() {
    this._editId = null;
    this._planName = '';
    this._goal = ''; this._level = ''; this._daysPerWeek = ''; this._desc = '';
    this._pickedDetails = {};
    this.setData({ mode: 'list', isEdit: false, planName: '', goal: '', level: '', daysPerWeek: '', desc: '', pickedList: [] });
    this.loadPlans();
  },

  // —— 开始训练（卡片 CTA / 详情页）：直接进入训练中页 ——
  // 动作由 workout 页自己解析（活跃计划优先，其次手动已选），本页不写 selectedActions。
  startPlan(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.showPlanDetail) this.setData({ showPlanDetail: false });
    if (!auth.requireLogin()) return;
    let plan;
    if (id) plan = store.get().trainingPlans.find(p => p.id === id);
    else plan = store.getActivePlan();
    if (plan) {
      if (store.get().activePlanId !== plan.id) {
        store.setActivePlan(plan.id);
        if (typeof this.loadPlans === 'function') this.loadPlans(); // 刷新「今日」标签
      }
      wx.navigateTo({ url: '/pages/workout/workout' });
      return;
    }
    // 无计划：回退用手动已选动作直接开练；都没有则提示
    if ((store.get().selectedActions || []).length) {
      wx.navigateTo({ url: '/pages/workout/workout' });
      return;
    }
    wx.showToast({ title: '请先导入或创建训练计划', icon: 'none' });
  },

  // —— 导入今日训练：仅标记 active + 停留本页 ——
  // 用户要求（2026-09-07）：导入后「不要跳转到首页」，停留在计划页；且不再注入训练页「已选动作」
  //（selectedActions 只存手动勾选），今日推荐卡片由 activePlanId 驱动，训练中页由 workout 从 activePlan 解析动作。
  // 故此处只做数据写入 + 本页列表刷新 + toast；首页数据由 home.onShow 自行 refresh 保证一致。
  // 与模板 importDay 行为统一：写完就停留，不切 tab。
  _useAsToday(id) {
    if (!auth.requireLogin()) return;
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    store.setActivePlan(id);
    // 刷新本页列表：让该卡片立即显示「今日」标签 + 「今日未训练」状态（isActive/featured/todayTag 由 activePlanId 推导）
    if (typeof this.loadPlans === 'function') this.loadPlans();
    // 同步首页数据（尽力而为，失败不影响本页；首页 onShow 也会再刷一次）
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    const homePage = pages.find(p => p && p.route === 'pages/home/home');
    if (homePage && typeof homePage.refresh === 'function') {
      try { homePage.refresh(); }
      catch (err) { console.error('[plan] home.refresh skipped:', err); }
    }
    wx.showToast({ title: '已导入今日训练', icon: 'success' });
  },
  useAsToday(e) {
    if (this.data.showPlanDetail) this.setData({ showPlanDetail: false });
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._useAsToday(id);
  },

  // —— 编辑计划 ——
  _editPlan(id) {
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    const list = (plan.actions || []).map(a => ({
      actionId: a.actionId, name: a.name, nameZh: a.nameZh || a.name,
      part: a.part || a.category || '', category: a.category || a.part || '',
      setsCount: a.setsCount || 3, reps: a.reps || '8-12', rest: a.rest || 60, weight: a.weight || ''
    }));
    const pickedMap = {}; list.forEach(d => { pickedMap[d.actionId] = true; });
    this._editId = id;
    this._planName = plan.name || '';
    this._goal = plan.goal || '';
    this._level = plan.level || '';
    this._daysPerWeek = plan.daysPerWeek ? String(plan.daysPerWeek) : '';
    this._desc = plan.desc || '';
    this._pickedDetails = {}; list.forEach(d => { this._pickedDetails[d.actionId] = d; });
    this.setData({
      mode: 'create', isEdit: true, planName: plan.name || '',
      goal: this._goal, level: this._level, daysPerWeek: this._daysPerWeek, desc: this._desc,
      pickedMap, pickedCount: list.length, pickedList: list, activeCat: '我的动作', actionPool: []
    }, () => this.loadActions());
  },
  editPlan(e) { const id = e.currentTarget.dataset.id; if (id) this._editPlan(id); },

  // —— 删除计划（二次确认）——
  _deletePlan(id) {
    const plan = store.get().trainingPlans.find(p => p.id === id);
    if (!plan) return;
    wx.showModal({
      title: '删除计划',
      content: '确定删除「' + (plan.name || '未命名计划') + '」吗？此操作不可撤销。',
      confirmText: '删除', confirmColor: '#E5484D',
      success: (res) => { if (res.confirm) { store.deletePlan(id); this.loadPlans(); wx.showToast({ title: '已删除', icon: 'none' }); } }
    });
  },
  deletePlan(e) { const id = e.currentTarget.dataset.id; if (id) this._deletePlan(id); },

  // —— 更多菜单 ——
  openMenu(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.data.plans.find(x => x.id === id);
    this.setData({ showMenu: true, menuId: id, menuName: p ? p.name : '训练计划' });
  },
  closeMenu() { this.setData({ showMenu: false }); },
  menuAction(e) {
    const act = e.currentTarget.dataset.act;
    const id = this.data.menuId;
    this.setData({ showMenu: false });
    if (!id) return;
    if (act === 'edit') this._editPlan(id);
    else if (act === 'use') this._useAsToday(id);
    else if (act === 'delete') this._deletePlan(id);
  },

  // —— 计划详情（查看）——
  openPlanDetail(e) {
    const id = e.currentTarget.dataset.id;
    const p = store.get().trainingPlans.find(x => x.id === id);
    if (!p) return;
    const m = planMetrics(p);
    this.setData({
      showPlanDetail: true,
      planDetail: {
        id: p.id, name: p.name, goal: p.goal || '', level: p.level || '',
        count: m.count, minutes: m.minutes, kcal: m.kcal,
        actions: (p.actions || []).map(a => ({ name: a.nameZh || a.name, setsCount: a.setsCount, reps: a.reps }))
      }
    });
  },
  closePlanDetail() { this.setData({ showPlanDetail: false }); }
});

// pages/plan/plan.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const exercises = require('../../utils/exercises.js');
const presets = require('../../presets/plans.js');
const theme = require('../../utils/theme.js');
const planRotation = require('../../utils/planRotation.js');
// 日期口径统一走 utils/dateRange.js（自然周，周一 00:00 起），避免各页各写一套
const dateRange = require('../../utils/dateRange.js');
const { todayStr } = dateRange;

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

// 把「模板 → 某个训练日」落地为一个 store 计划；已存在（同 programId + dayIndex，或同名）则复用。
// 关键：同步写入 goal / level / daysPerWeek —— 计划页「本周训练」目标、首页展示都依赖 daysPerWeek。
function ensurePlanForDay(program, di, day) {
  const name = program.name + ' · ' + day.name;
  let plan = store.get().trainingPlans.find(p => p.programId === program.id && p.dayIndex === di)
    || store.get().trainingPlans.find(p => p.name === name);
  if (!plan) {
    plan = store.addPlan({
      name, programId: program.id, dayIndex: di, source: 'template',
      goal: program.goal, level: program.level,
      daysPerWeek: Number(program.daysPerWeek) || 0,
      actions: buildPlanActions(day)
    });
  } else if (!plan.daysPerWeek || !plan.goal || !plan.level) {
    // 老版本导入的模板计划缺 daysPerWeek / goal / level，就地补齐（不覆盖已有值）
    store.updatePlan(plan.id, {
      daysPerWeek: plan.daysPerWeek || Number(program.daysPerWeek) || 0,
      goal: plan.goal || program.goal,
      level: plan.level || program.level,
      programId: plan.programId || program.id,
      dayIndex: (plan.dayIndex != null ? plan.dayIndex : di)
    });
    plan = store.get().trainingPlans.find(p => p.id === plan.id) || plan;
  }
  return plan;
}

// 把整套模板展开为「我的计划」里的 N 张卡片，返回按 dayIndex 升序的计划数组。
function ensureProgramPlans(program) {
  return (program.days || []).map((day, di) => ensurePlanForDay(program, di, day));
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

// 本周（周一 00:00 ~ 下周一 00:00，半开区间 [monStr, sunStr)）的起止日期串，
// 供方案组头「本周进度」使用。口径统一在 utils/dateRange.js —— 与训练复盘组件同一套自然周。
function weekRange() {
  return dateRange.weekRange();
}

// 计划卡的派生指标：动作数 / 时长(分钟) / 预计消耗(kcal)
// 注意：这里是**开练前的计划估算**（按计划组数 × 时长推），与记录页「训练消耗」
// （按实际训练秒 × trainingStats.EST_KCAL_PER_MIN）是两套语义，故意不同——
// 计划卡要保守给出「能消耗这么多」的承诺值，故取值更高。改名成常量避免被误当成同一口径。
const PLAN_KCAL_PER_MIN = 10;
function planMetrics(plan) {
  const acts = plan.actions || [];
  const count = acts.length;
  let totalSets = 0;
  acts.forEach(a => { totalSets += Number(a.setsCount) || 0; });
  const minutes = Math.max(10, Math.round(totalSets * 1.5));
  const kcal = Math.max(60, Math.round(minutes * PLAN_KCAL_PER_MIN));
  return { count, minutes, kcal };
}

Page({
  data: {
    theme: 'theme-light',
    mode: 'list',          // list | create
    seg: 'mine',           // mine（我的计划） | tpl（模板推荐）
    groups: [],            // 「我的计划」按方案分组：[{ key, name, isProgram, isActive, count, weekDone, weekTarget, plans:[卡] }]
    activePlanId: '',
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
    const { monStr, sunStr } = weekRange();
    const activeId = g.activePlanId;
    const logs = g.trainingLogs || [];

    // —— 归属统计：本场训练属于哪张计划 / 哪套模板 ——
    // 只有「计划流」的训练日志带 planId/programId（见 workout.saveWorkout）；自由训练二者为空。
    // 归集逻辑收敛到 planRotation 的纯函数（零依赖，可被 verify-plan-rotation.cjs 直接单测）。
    const byProgram = planRotation.weekDatesByKey(logs, 'programId', monStr, sunStr); // 方案组头周进度
    const byPlan = planRotation.weekDatesByKey(logs, 'planId', monStr, sunStr);       // 单卡完成态
    const freeTrainedToday = logs.some(l => l && l.date === today && !l.planId);      // 今天有无未归属训练

    // —— 分组：一套方案 = 一个组；无 programId 的手动计划归入同一个「自定义计划」组 ——
    const buckets = planRotation.groupPlans(g.trainingPlans, activeId);
    const activePlan = (g.trainingPlans || []).find(p => p.id === activeId) || null;
    const activeGroupKey = planRotation.groupKeyOf(activePlan);

    let flat = [];
    const groups = buckets.map(b => {
      const isTpl = b.key !== planRotation.MANUAL_KEY;
      const isActiveGroup = !!activeId && b.key === activeGroupKey;
      const cards = b.plans.map(p => {
        const m = planMetrics(p);
        const isActive = p.id === activeId;
        const lastDay = planRotation.weekLastDay(byPlan, p.id);
        // 状态口径：完成态按「本场训练的归属」判定；未归属的自由训练只点亮当前激活计划。
        // 这样多套方案并存时不会出现「练了 A 套，B 套的卡也全绿」的串台。
        let statusText, statusCls, statusDot;
        if (lastDay === today || (isActive && !lastDay && freeTrainedToday)) {
          statusText = '今日已完成'; statusCls = 'done'; statusDot = 'solid';
        } else if (lastDay) {
          statusText = '本周已完成'; statusCls = 'done'; statusDot = 'solid';
        } else if (isActive) {
          statusText = '今日未训练'; statusCls = 'todo'; statusDot = 'hollow';
        } else if (isActiveGroup) {
          statusText = '待轮换'; statusCls = 'idle'; statusDot = 'muted';
        } else {
          statusText = '未启用'; statusCls = 'idle'; statusDot = 'muted';
        }
        return {
          id: p.id,
          name: p.name,
          // 模板计划：卡片标题只显示训练日（A 日 · 下肢推 + 上肢推），方案名由组头承载
          cardTitle: isTpl ? planRotation.dayFullName(p.name) : p.name,
          goal: p.goal || '',
          level: p.level || '',
          count: m.count,
          minutes: m.minutes,
          kcal: m.kcal,
          isActive,
          featured: isActive,   // 当天所在卡作为「今日重点」
          todayTag: isActive,   // [今日] Lime Green 标签
          statusText, statusCls, statusDot
        };
      });
      flat = flat.concat(cards);

      const first = b.plans[0] || {};
      const target = isTpl ? (Number(first.daysPerWeek) || 0) : 0;
      const done = isTpl ? planRotation.weekDayCount(byProgram, b.key) : 0;
      return {
        key: b.key,
        pid: isTpl ? b.key : '',
        name: isTpl ? planRotation.programLabel(first.name) : '自定义计划',
        isProgram: isTpl,
        isActive: isActiveGroup,
        count: cards.length,
        weekDone: done,
        weekTarget: target,
        plans: cards
      };
    });

    this._plansFlat = flat;
    this.setData({ groups, activePlanId: activeId });
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
      dayCount: (p.days || []).length,
      multiDay: (p.days || []).length > 1,
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

  // 同步首页数据（尽力而为，失败不影响本页；首页 onShow 也会再刷一次）
  _syncHome() {
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    const homePage = pages.find(p => p && p.route === 'pages/home/home');
    if (homePage && typeof homePage.refresh === 'function') {
      try { homePage.refresh(); }
      catch (err) { console.error('[plan] home.refresh skipped:', err); }
    }
  },

  // 一键导入整套模板（主入口）：把全部训练日生成为「我的计划」卡片，
  // 默认激活第 0 天（A 日）；此后每完成一次训练自动轮转（见 store.advanceActivePlan）。
  // 本周训练目标取自模板的 daysPerWeek（导入时已写入每个计划）。
  importProgram(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const program = (presets.PROGRAMS || []).find(p => p.id === pid);
    if (!program) return;
    const plans = ensureProgramPlans(program);
    if (!plans.length) return;
    store.setActivePlan(plans[0].id);
    this.setData({ showTpl: false });
    this.loadPlans();
    this._syncHome();
    wx.showToast({ title: '已导入 ' + plans.length + ' 个训练日', icon: 'success' });
  },

  // 方案组头：「设为使用中」——把该模板的第 0 个训练日设为今日计划，让它进入轮转队列。
  // 允许并存多套方案后，这是方案之间切换的唯一入口（不删旧方案，只改激活指针）。
  useProgram(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const plan = store.setActiveProgram(pid);
    if (!plan) return;
    this.loadPlans();
    this._syncHome();
    wx.showToast({ title: '已切换为「' + planRotation.dayFullName(plan.name) + '」', icon: 'none' });
  },

  // 方案组头：「整套移除」——删除该模板的全部训练日计划（二次确认）。
  // 删的若是当前激活方案，activePlanId 会被清空，首页今日推荐随之回退（不擅自替用户改选另一套）。
  removeProgram(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const program = (presets.PROGRAMS || []).find(p => p.id === pid);
    const name = program ? program.name : '该方案';
    const sibs = store.getProgramPlans(pid);
    if (!sibs.length) return;
    const activeId = store.get().activePlanId;
    const inUse = sibs.some(p => p.id === activeId);
    wx.showModal({
      title: '移除整套方案',
      content: '将删除「' + name + '」的 ' + sibs.length + ' 个训练日计划'
        + (inUse ? '（该方案正在使用，移除后首页今日推荐会清空）' : '')
        + '。此操作不可撤销。',
      confirmText: '移除', confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        store.removeProgramPlans(pid);
        this.loadPlans();
        this._syncHome();
        wx.showToast({ title: '已移除 ' + sibs.length + ' 个训练日', icon: 'none' });
      }
    });
  },

  // 导入单个训练日（模板内某天）：同样补齐 daysPerWeek，使其成为「今日计划」
  importDay(e) {
    if (!auth.requireLogin()) return;
    const pid = e.currentTarget.dataset.pid;
    const di = Number(e.currentTarget.dataset.di);
    const program = (presets.PROGRAMS || []).find(p => p.id === pid);
    if (!program) return;
    const day = program.days[di];
    if (!day) return;
    const plan = ensurePlanForDay(program, di, day);
    store.setActivePlan(plan.id);
    // 注意：计划流程不写 selectedActions（训练页「已选动作」只存手动勾选），今日推荐卡片由 activePlanId 驱动
    this.setData({ showTpl: false });
    this.loadPlans();
    this._syncHome();
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
  // 计划重量：手动微调入口（此前只靠复盘卡「应用到计划」回填，用户没有别的出口）
  // 存字符串，与 store 中 plan.actions[].weight 的类型保持一致（空串 = 未设定）
  onActionWeight(e) {
    const id = e.currentTarget.dataset.aid;
    const v = e.detail.value;
    if (this._pickedDetails[id]) this._pickedDetails[id].weight = v;
    const idx = this.data.pickedList.findIndex(x => x.actionId === id);
    if (idx >= 0) this.setData({ ['pickedList[' + idx + '].weight']: v });
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
    this._syncHome();
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
  // editPlan(e) 已删除：无任何 wxml 绑定（计划卡的编辑入口走 .more -> openMenu 的 actionSheet，
  // 在 openMenu 里直接调 _editPlan(id)），是从旧版「卡片上直接放编辑按钮」遗留下来的包装方法。

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
    const p = (this._plansFlat || []).find(x => x.id === id);
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
        actions: (p.actions || []).map((a, i) => ({
          k: 'pa' + i,
          name: a.nameZh || a.name,
          // 组/次/重量拼成整串：wxml 侧不做表达式，且重量为 0/空时整段省略（不显示 "0kg"）
          paramTxt: (a.setsCount || 0) + ' 组 · ' + (a.reps || '') + (Number(a.weight) > 0 ? ' · ' + Number(a.weight) + 'kg' : '')
        }))
      }
    });
  },
  closePlanDetail() { this.setData({ showPlanDetail: false }); }
});

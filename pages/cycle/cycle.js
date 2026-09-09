// pages/cycle/cycle.js
// 周期规划页（Phase 2）：浏览循证周期模板 → 一键导入为带 cycle 字段的训练计划（记录开始日）→ 展示当前周进度
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const exercises = require('../../utils/exercises.js');
const cycles = require('../../presets/cycles.js');
const theme = require('../../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function parseDate(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function weekKey(s) {
  const d = parseDate(s);
  const day = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - day);
  return mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate());
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 把周期某训练日的动作展开为 store 计划动作（回查 exercises 补全展示字段）
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

Page({
  data: {
    theme: 'theme-light',
    cycles: [],          // 周期模板列表（展示用）
    hasActiveCycle: false,
    // 当前周期进度（若有激活的周期计划）
    progress: null       // { name, weeks, curWeek, phaseLabel, phaseIntent, rpeTarget, setsTarget, trainedDays, avgRpe, totalSets }
  },

  onLoad() {
    this.setData({
      cycles: (cycles.CYCLES || []).map(c => ({
        id: c.id, name: c.name, goal: c.goal, level: c.level, weeks: c.weeks,
        desc: c.desc,
        phases: c.cycle.phases,
        rpeChart: c.cycle.chart.rpe,           // 处方 RPE 走势（迷你 sparkline）
        cycle: c.cycle                          // 整段 cycle（导入时原样带入计划）
      }))
    });
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    this.loadProgress();
  },

  // 计算当前激活周期计划的周进度（基于 cycleStartedAt）
  loadProgress() {
    const active = store.getActivePlan();
    if (!active || !active.cycle || !active.cycleStartedAt) {
      this.setData({ hasActiveCycle: false, progress: null });
      return;
    }
    const cyc = active.cycle;
    const startMonday = weekKey(active.cycleStartedAt);
    const todayMonday = weekKey(todayStr());
    const diffWeeks = Math.round((parseDate(todayMonday) - parseDate(startMonday)) / 604800000);
    const curWeek = diffWeeks + 1;
    const phase = (cyc.phases || []).find(p => curWeek >= p.start_week && curWeek <= p.end_week) || null;
    const rxRpe = (cyc.chart && cyc.chart.rpe && cyc.chart.rpe[curWeek - 1] != null) ? cyc.chart.rpe[curWeek - 1] : null;
    const rxSets = (cyc.chart && cyc.chart.sets && cyc.chart.sets[curWeek - 1] != null) ? cyc.chart.sets[curWeek - 1] : null;

    // 本周实际：训练天数 + 平均 RPE + 总组数（仅统计周期开始日之后的日志）
    const logs = (store.get().trainingLogs || []).filter(l => l.date >= active.cycleStartedAt);
    const wkLogs = logs.filter(l => weekKey(l.date) === todayMonday);
    const trainedDays = new Set(wkLogs.map(l => l.date)).size;
    let vals = [], totalSets = 0;
    wkLogs.forEach(l => l.actions.forEach(a => {
      const detail = (a.setsDetail && a.setsDetail.length) ? a.setsDetail : (Array.isArray(a.sets) ? a.sets : []);
      totalSets += detail.length;
      detail.forEach(s => { if (s.rpe != null && s.rpe !== '') vals.push(Number(s.rpe)); });
    }));
    const avgRpe = vals.length ? +(vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(1) : null;

    this.setData({
      hasActiveCycle: true,
      progress: {
        name: active.name,
        weeks: cyc.phases ? cyc.phases[cyc.phases.length - 1].end_week : (active.weeks || curWeek),
        curWeek: curWeek > 0 ? curWeek : 1,
        phaseLabel: phase ? phase.label : (curWeek <= 0 ? '未开始' : '已结束'),
        phaseIntent: phase ? phase.intent : '',
        rpeTarget: rxRpe,
        setsTarget: rxSets,
        trainedDays,
        avgRpe,
        totalSets
      }
    });
  },

  // 导入周期：展开全部训练日为计划动作 + 带 cycle 字段 + 记录开始日 → 设为当前计划
  importCycle(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const cyc = (cycles.CYCLES || []).find(c => c.id === id);
    if (!cyc) return;
    let actions = [];
    (cyc.days || []).forEach(day => { actions = actions.concat(buildPlanActions(day)); });
    const created = store.addPlan({
      name: cyc.name,
      actions,
      cycle: cyc.cycle,
      cycleStartedAt: todayStr()
    });
    store.setActivePlan(created.id);
    // 计划流程不写 selectedActions（训练页已选列表只存手动勾选），训练中页由 workout 从 activePlan 解析
    wx.showToast({ title: '已导入周期计划', icon: 'success' });
    setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 900);
  },

  // 跳复盘查看「实际 vs 处方」对比
  goReview() { wx.navigateTo({ url: '/pages/review/review' }); },

  noop() {}
});

// pages/review/review.js
// 训练复盘：按「记录数 + 是否有周期」自动分流四种模式（单次 / 滚动 / 基准 / 周）
// 数据全部来自 store.trainingLogs 与当前激活计划（store.getActivePlan），无后端、无运行费用。
const store = require('../../utils/store.js');

const WEEK_TARGET = 3; // 每周目标训练天数（无周期计划时的默认基准）

const MODE_DESC = {
  single: '单次复盘 · 每次训练后的执行判断与下次处方',
  rolling: '滚动复盘 · 同动作跨场次的渐进对比',
  baseline: '基准复盘 · 建立可信样本前的校准引导',
  weekly: '周训练复盘 · 一周完成度 / 力量 / 努力度汇总'
};

/* ---------- 通用工具 ---------- */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function parseDate(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function weekday(s) { return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseDate(s).getDay()]; }
function weekKey(s) { // 周一为起点的周键
  const d = parseDate(s);
  const day = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - day);
  return mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate());
}
function weekLabel(key) { const d = parseDate(key); return (d.getMonth() + 1) + '/' + d.getDate() + ' 周'; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
// 统一取某次训练某动作的「组明细数组」：
// 新数据存 setsDetail（saveWorkout 产出），老/测试数据可能直接把数组放在 sets；
// 当前 saveWorkout 把计数放在 a.sets、明细放在 a.setsDetail，故优先 setsDetail。
// 与 utils/report.js 的 getDetail 保持同一口径，避免 a.sets 是数字时 .map 崩溃。
function setsOf(a) {
  if (a.setsDetail && a.setsDetail.length) return a.setsDetail;
  if (Array.isArray(a.sets)) return a.sets;
  return [];
}

Page({
  data: {
    mode: 'weekly',
    logsCount: 0,
    hasCycle: false,
    cycleLabel: '',
    modeDesc: '',
    // 单次
    sessions: [], curSid: '', session: null,
    // 滚动
    rollableActions: [], curActionId: '', roll: null,
    // 基准
    baseline: null,
    // 周
    weeks: [], curWeek: '', week: null
  },

  onLoad() { this.rebuild(); },
  onShow() { this.rebuild(); },

  /* 重算全部派生数据，并按路由规则决定默认模式 */
  rebuild() {
    const g = store.get();
    const logs = (g.trainingLogs || []).slice();
    const n = logs.length;
    // —— 路由规则：记录数 + 是否有周期 ——
    const defaultMode = n < 2 ? 'baseline' : 'weekly';
    const active = store.getActivePlan();
    const hasCycle = !!(active && active.cycle && active.cycle.phases && active.cycle.phases.length);

    this._logs = logs;
    this._active = active;
    const base = this.computeBase(logs, active);

    const curSid = (base.sessions[0] || {}).sid || '';
    const curActionId = (base.rollableActions[0] || {}).actionId || '';
    const curWeek = (base.weeks[base.weeks.length - 1] || {}).key || '';

    this.setData({
      mode: defaultMode,
      logsCount: n,
      hasCycle,
      sessions: base.sessions,
      rollableActions: base.rollableActions,
      weeks: base.weeks,
      baseline: base.baseline,
      curSid, curActionId, curWeek,
      modeDesc: MODE_DESC[defaultMode]
    }, () => this.applyMode());
  },

  /* 计算基础聚合（不依赖模式），结果缓存到实例供 applyMode 细算 */
  computeBase(logs, active) {
    const n = logs.length;
    // —— 单次：场次列表 ——
    const sessions = logs.map(l => ({
      sid: l.sid, date: l.date, weekday: weekday(l.date),
      actionCount: l.actions.length,
      totalSets: l.actions.reduce((s, a) => s + setsOf(a).length, 0),
      maxWeight: Math.max(0, ...l.actions.flatMap(a => setsOf(a).map(s => num(s.weight) || 0)))
    }));

    // —— 滚动：按动作聚合可比记录 ——
    const map = {};
    logs.forEach(l => l.actions.forEach(a => {
      const top = Math.max(0, ...setsOf(a).map(s => num(s.weight) || 0));
      const rpes = setsOf(a).map(s => (s.rpe != null && s.rpe !== '') ? num(s.rpe) : null).filter(v => v != null);
      const avgRpe = rpes.length ? rpes.reduce((s, x) => s + x, 0) / rpes.length : null;
      if (!map[a.id]) map[a.id] = { actionId: a.id, nameZh: a.nameZh || a.name, records: [] };
      map[a.id].records.push({ date: l.date, weekday: weekday(l.date), maxWeight: top, avgRpe });
    }));
    this._rollMap = map;
    const rollableActions = Object.values(map)
      .filter(x => x.records.length >= 2)
      .map(x => ({ actionId: x.actionId, nameZh: x.nameZh, count: x.records.length }))
      .sort((a, b) => b.count - a.count);

    // —— 周：按周分组 ——
    const weeksMap = {};
    logs.forEach(l => { const k = weekKey(l.date); (weeksMap[k] = weeksMap[k] || []).push(l); });
    const weekKeys = Object.keys(weeksMap).sort();
    this._weeksMap = weeksMap;
    this._weekKeys = weekKeys;
    const weeks = weekKeys.map(k => ({
      key: k, label: weekLabel(k),
      pct: Math.min(100, Math.round(new Set(weeksMap[k].map(l => l.date)).size / WEEK_TARGET * 100))
    }));

    // —— 基准：全局状态 ——
    let status, desc;
    if (n === 0) { status = '0 次训练'; desc = '还没有任何训练记录。先完成一次训练，建立第一个样本。'; }
    else if (n === 1) { status = '仅 1 次可靠记录'; desc = '只有 1 次记录时无法推算精确进阶。先完成一次 RPE 校准训练（用自觉费力度评估重量），建立第二个可比样本，再进入滚动 / 周复盘。'; }
    else { status = n + ' 次训练'; desc = '你已有充足记录，可切换到「周」或「滚动」查看进阶与努力度趋势。基准态用于单动作记录 <2 次时的引导。'; }
    const baseline = { status, desc, session: n ? { date: logs[0].date, actionCount: logs[0].actions.length } : null };

    return { sessions, rollableActions, weeks, baseline };
  },

  /* 根据当前模式计算其专属明细 */
  applyMode() {
    const mode = this.data.mode;
    if (mode === 'single') this.buildSession();
    else if (mode === 'rolling') this.buildRoll();
    else if (mode === 'weekly') this.buildWeek();
    // baseline 明细已在 data.baseline 中，无需重算
  },

  buildSession() {
    const log = this._logs.find(l => l.sid === this.data.curSid);
    if (!log) { this.setData({ session: null }); return; }
    const active = this._active;
    const actions = log.actions.map(a => {
      const sets = setsOf(a).map(s => ({
        weight: num(s.weight), reps: num(s.reps),
        rpe: (s.rpe != null && s.rpe !== '') ? num(s.rpe) : null
      }));
      const planned = active ? (active.actions || []).find(p => p.actionId === a.id) : null;
      const actualSets = sets.length;
      const plannedSets = planned ? num(planned.setsCount) : null;
      let badge, badgeClass;
      if (plannedSets != null) {
        badge = actualSets >= plannedSets ? '达标' : '欠量';
        badgeClass = actualSets >= plannedSets ? 'ok' : 'low';
      } else { badge = '已完成'; badgeClass = 'ok'; }
      const top = sets.reduce((m, s) => s.weight > m.weight ? s : m, { weight: 0, reps: 0, rpe: null });
      let next = '';
      if (top.rpe != null) {
        if (top.rpe <= 7) next = '余力充足，下次可 +2.5kg 或 +1 次';
        else if (top.rpe >= 9) next = '接近力竭，下次维持或 -5% 重量恢复';
        else next = '强度合适，维持并渐进';
      } else next = '维持当前强度，目标渐进超负荷（+1 次或 +2.5kg）';
      return { id: a.id, nameZh: a.nameZh || a.name, sets, badge, badgeClass, next };
    });
    const lowCount = actions.filter(a => a.badgeClass === 'low').length;
    const verdict = lowCount ? '部分达标' : '完成训练';
    const verdictClass = lowCount ? 'warn' : 'ok';
    this.setData({ session: { verdict, verdictClass, actions } });
  },

  buildRoll() {
    const id = this.data.curActionId;
    const x = this._rollMap[id];
    if (!x) { this.setData({ roll: null }); return; }
    const records = x.records.slice().sort((a, b) => a.date.localeCompare(b.date));
    const maxW = Math.max(...records.map(r => r.maxWeight), 1);
    const recs = records.map(r => ({ ...r, h: Math.round(r.maxWeight / maxW * 100) }));
    const last = records[records.length - 1], prev = records[records.length - 2];
    let suggest, suggestClass;
    if (last.maxWeight > prev.maxWeight) { suggest = '力量进步，维持渐进；下次目标再 +2.5kg 或 +1 次'; suggestClass = 'ok'; }
    else if (last.maxWeight === prev.maxWeight) { suggest = '进入平台，下一次只改一个变量：重量 +2.5kg 或 次数 +1（不要同时改）'; suggestClass = 'warn'; }
    else { suggest = '强度回落，优先恢复与技术；维持重量，保证完成度'; suggestClass = 'low'; }
    const rpeVals = records.map(r => r.avgRpe).filter(v => v != null);
    const rpeTrend = rpeVals.length ? ('近 ' + rpeVals.length + ' 次均值 ' + (rpeVals.reduce((s, x) => s + x, 0) / rpeVals.length).toFixed(1)) : '暂未记录 RPE';
    if (!rpeVals.length) suggest += '；建议记录 RPE 以便精确判定';
    this.setData({ roll: { nameZh: x.nameZh, records: recs, rpeTrend, suggest, suggestClass } });
  },

  buildWeek() {
    const k = this.data.curWeek;
    const logsW = this._weeksMap[k] || [];
    const days = new Set(logsW.map(l => l.date));
    const trainedDays = days.size;
    const pct = Math.min(100, Math.round(trainedDays / WEEK_TARGET * 100));

    // 力量进展：本周出现次数最多的 3 个动作的逐周峰值
    const actCount = {};
    logsW.forEach(l => l.actions.forEach(a => { actCount[a.id] = (actCount[a.id] || 0) + 1; }));
    const topIds = Object.keys(actCount).sort((a, b) => actCount[b] - actCount[a]).slice(0, 3);
    const strength = topIds.map(id => {
      const nameZh = (logsW.flatMap(l => l.actions).find(a => a.id === id) || {}).nameZh || id;
      const points = this._weekKeys.map(wk => {
        let mw = 0;
        (this._weeksMap[wk] || []).forEach(l => l.actions.forEach(a => {
          if (a.id === id) { const t = Math.max(0, ...setsOf(a).map(s => num(s.weight) || 0)); if (t > mw) mw = t; }
        }));
        return mw;
      });
      const maxV = Math.max(...points, 1);
      const pts = points.map(v => ({ h: v ? Math.round(v / maxV * 100) : 2 }));
      const delta = points[points.length - 1] - points[0];
      return {
        actionId: id, nameZh, points: pts,
        delta: delta > 0 ? ('▲' + delta + 'kg') : delta < 0 ? ('▼' + (-delta) + 'kg') : '—',
        deltaClass: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
      };
    });

    // 努力度（RPE）逐周均值
    const rpe = this._weekKeys.map(wk => {
      const vals = [];
      (this._weeksMap[wk] || []).forEach(l => l.actions.forEach(a => setsOf(a).forEach(s => {
        if (s.rpe != null && s.rpe !== '') { const v = num(s.rpe); if (v) vals.push(v); }
      })));
      const val = vals.length ? +(vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(1) : 0;
      return { val, h: val ? Math.round(val / 10 * 100) : 2 };
    });

    // 决策规则（维持 / 调整 / 进阶）
    const completionFlag = pct >= 80 ? '优' : pct >= 60 ? '良' : '不足';
    let decision, decisionClass, reason, effortFlag = '—';
    if (pct < 60) {
      decision = '调整'; decisionClass = 'low';
      reason = '本周出勤不足（' + trainedDays + '/' + WEEK_TARGET + ' 天），优先保证训练频率。';
    } else {
      const rpeVals = rpe.map(r => r.val).filter(v => v > 0);
      let rising = false;
      if (rpeVals.length >= 2) rising = (rpeVals[rpeVals.length - 1] - rpeVals[0]) >= 1;
      effortFlag = rpeVals.length ? (rising ? '上升⚠' : '平稳') : '未记录';
      if (rising) {
        decision = '调整'; decisionClass = 'warn';
        reason = '努力度（RPE）逐周上升，留意恢复与技术，必要时安排减量周。';
      } else {
        const progressed = strength.some(s => s.delta > 0);
        if (progressed) { decision = '进阶'; decisionClass = 'ok'; reason = '完成度达标且主要动作力量上升，可进入下一阶段渐进。'; }
        else { decision = '维持'; decisionClass = 'ok'; reason = '完成度达标、力量稳定，维持当前处方继续积累。'; }
      }
    }

    // 周期联动（是否有周期 → 周复盘展示当前阶段 + 实际 vs 处方对比）
    let cycleLabel = '';
    let cycleRx = null, cycleActual = null;
    if (this.data.hasCycle && this._active && this._active.cycle) {
      const cyc = this._active.cycle;
      // 优先按「周期开始日」算第几周；无开始日则回退到全局周轴索引
      const wi = (this._active.cycleStartedAt)
        ? (Math.round((parseDate(k) - parseDate(weekKey(this._active.cycleStartedAt))) / 604800000) + 1)
        : (this._weekKeys.indexOf(k) + 1);
      const ph = (cyc.phases || []).find(p => wi >= p.start_week && wi <= p.end_week);
      cycleLabel = ph ? ph.label : (wi <= 0 ? '未开始' : (cyc.title || '周期'));
      // 处方锚点（逐周 RPE / 组数）
      const rxRpe = (cyc.chart && cyc.chart.rpe && cyc.chart.rpe[wi - 1] != null) ? cyc.chart.rpe[wi - 1] : null;
      const rxSets = (cyc.chart && cyc.chart.sets && cyc.chart.sets[wi - 1] != null) ? cyc.chart.sets[wi - 1] : null;
      // 实际（本周）
      let vals = [], totalSets = 0;
      logsW.forEach(l => l.actions.forEach(a => {
        const detail = setsOf(a);
        totalSets += detail.length;
        detail.forEach(s => { if (s.rpe != null && s.rpe !== '') vals.push(num(s.rpe)); });
      }));
      const avgRpe = vals.length ? +(vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(1) : null;
      cycleRx = { weekIdx: wi, phaseLabel: cycleLabel, rpe: rxRpe, sets: rxSets };
      cycleActual = {
        rpe: avgRpe, sets: totalSets,
        // RPE 偏差：±0.5 内算匹配，高于处方=偏高（可能过度疲劳），低于=偏低
        rpeMatch: (rxRpe != null && avgRpe != null)
          ? (Math.abs(avgRpe - rxRpe) <= 0.5 ? 'match' : (avgRpe > rxRpe ? 'high' : 'low'))
          : 'na',
        // 容量偏差：达处方 85% 以上算达标
        setsMatch: (rxSets != null) ? (totalSets >= rxSets * 0.85 ? 'ok' : 'low') : 'na'
      };
    }

    this.setData({
      week: {
        trainedDays, target: WEEK_TARGET, pct, strength, rpe,
        decision, decisionClass, decisionReason: reason,
        flags: { completion: completionFlag, effort: effortFlag, tech: '—' },
        cycleRx, cycleActual
      },
      cycleLabel
    });
  },

  /* ---------- 交互 ---------- */
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode, modeDesc: MODE_DESC[mode] }, () => this.applyMode());
  },
  selectSession(e) {
    this.setData({ curSid: e.currentTarget.dataset.sid }, () => this.buildSession());
  },
  selectAction(e) {
    this.setData({ curActionId: e.currentTarget.dataset.id }, () => this.buildRoll());
  },
  selectWeek(e) {
    this.setData({ curWeek: e.currentTarget.dataset.key }, () => this.buildWeek());
  },
  goTrain() { wx.switchTab({ url: '/pages/training/training' }); }
});

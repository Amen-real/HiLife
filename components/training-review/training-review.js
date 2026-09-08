// components/training-review/training-review.js
// 训练复盘组件 —— 严格按 12-review.html（单次复盘为主，其他 tab 占位）
// 数据源：store.trainingLogs（saveWorkout 产出）。可供 review 页 / list 页（数据页）复用。
const store = require('../../utils/store.js');

const WEEK_TARGET = 3;       // 完成度参考基准（无计划时）
const CAL_PER_MIN = 8;       // kcal/分钟（与 06-records 一致）
const DAILY_LOAD_MAX = 12500; // 柱状图 100% 对应的 kg（实测 12k 档）

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function setsOf(a) {
  if (a.setsDetail && a.setsDetail.length) return a.setsDetail;
  if (Array.isArray(a.sets)) return a.sets;
  return [];
}
function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function minutesFromLog(log) {
  if (log.durationMin) return log.durationMin;
  let sec = 0;
  log.actions.forEach(a => setsOf(a).forEach(s => { sec += num(s.trainSec) || 0; }));
  return Math.max(0, Math.round(sec / 60));
}
function loadOfLog(log) {
  // 训练量 = Σ 重量 × 次数
  return log.actions.reduce((s, a) => s + setsOf(a).reduce((ss, x) => ss + (num(x.weight) || 0) * (num(x.reps) || 0), 0), 0);
}
function actionKey(a) {
  // 同动作 + 同器械 = 可比场次（P2）
  return (a.id || a.name || '动作') + ' ' + (a.equip || '');
}

// 下次处方：单次复盘内基于本次 RPE 给轻量建议（不依赖历史，历史对比留给滚动/基准模式）
function planFor(avgRpe) {
  if (avgRpe >= 9) return '接近力竭 · 下次维持容量，谨慎加重';
  if (avgRpe > 0 && avgRpe <= 6) return '状态轻松 · 下次可加重 2.5–5%';
  if (avgRpe > 0) return '保持容量 · 稳步推进';
  return '记录 RPE 以评估强度';
}

Component({
  data: {
    tab: 'single',

    // 单次复盘所需
    hero: { name: '', date: '', setIdx: 0, setTotal: 0 },
    stats: { duration: '--:--', kcal: 0, completion: 0 },
    // 动作判断（逐动作表现）/ 下次处方 / 训练感受（P0 补全）
    perAction: [],
    feelings: [],
    // 周度复盘（P1）：完成度 / 训练天数 / 平均 RPE / 力量进展 / 努力度趋势
    weekly: { weeklyTarget: 3, trainDays: 0, completion: 0, avgRpe: 0, prog: [], weeks: [], compStyle: '' },
    // 滚动复盘（P2）：同动作同器械跨场次渐进对比
    rolling: { groups: [], selKey: '', view: null },
    // 基准对比（P2）：可靠 RPE 样本计数 + 基准 vs 当前
    baseline: { reliableCount: 0, enough: false, blRingStyle: '', rec: '' },
    analysis: {
      totalLabel: '0',
      deltaPct: 0, deltaLabel: '',
      bars: [], xAxis: []
    },
    rpe: {
      totalPct: 0,
      pct10: 0, pct8: 0, pct6: 0, pct5: 0,
      ringStyle: 'background: conic-gradient(from -90deg, #2A3310 0% 100%, #4F8A2A 100% 100%, #C8FF00 100% 100%, #6F9F00 100% 100%, #B8D45A 100% 100%);',
      ariaLabel: '暂无 RPE 数据'
    }
  },

  lifetimes: {
    attached() { this.rebuild(); }
  },
  pageLifetimes: {
    show() { this.rebuild(); }
  },

  methods: {
    /* ===== 主流程 ===== */
    rebuild() {
      const g = store.get();
      const logs = (g.trainingLogs || []).slice();
      if (!logs.length) {
        this.setData({
          hero: { name: '', date: '', setIdx: 0, setTotal: 0 },
          stats: { duration: '--:--', kcal: 0, completion: 0 },
          perAction: [],
          feelings: [],
          weekly: { weeklyTarget: 3, trainDays: 0, completion: 0, avgRpe: 0, prog: [], weeks: [], compStyle: '' },
          rolling: { groups: [], selKey: '', view: null },
          baseline: { reliableCount: 0, enough: false, blRingStyle: '', rec: '' },
          analysis: { totalLabel: '0', deltaPct: 0, deltaLabel: '—', bars: [], xAxis: [] },
          rpe: { totalPct: 0, pct10: 0, pct8: 0, pct6: 0, pct5: 0,
            ringStyle: 'background: conic-gradient(from -90deg, #2A3310 0% 100%, #4F8A2A 100% 100%, #C8FF00 100% 100%, #6F9F00 100% 100%, #B8D45A 100% 100%);',
            ariaLabel: '暂无 RPE 数据' }
        });
        return;
      }

      // —— 取最新一场训练 ——
      const latest = logs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];

      // —— 主动作 = 最大重量的动作 ——
      let mainAct = null, mainTop = 0;
      latest.actions.forEach(a => {
        const t = Math.max(0, ...setsOf(a).map(s => num(s.weight) || 0));
        if (t > mainTop) { mainTop = t; mainAct = a; }
      });
      const mainSets = mainAct ? setsOf(mainAct) : [];
      const setTotal = mainSets.length || latest.actions.reduce((s, a) => s + setsOf(a).length, 0);
      const setIdx = mainSets.length || 1;

      // —— 3 stat ——
      const dur = minutesFromLog(latest);
      const kcal = Math.round(dur * CAL_PER_MIN);
      const active = store.getActivePlan();
      let completion = 0;
      if (active && active.actions) {
        const planMap = {};
        active.actions.forEach(p => { planMap[p.actionId] = p; });
        let planned = 0, actual = 0;
        latest.actions.forEach(a => {
          const p = planMap[a.id];
          if (p) { planned += num(p.setsCount) || 0; actual += setsOf(a).length; }
        });
        completion = planned ? Math.min(100, Math.round(actual / planned * 100)) : 100;
      } else {
        const totalSets = latest.actions.reduce((s, a) => s + setsOf(a).length, 0);
        completion = Math.min(100, Math.round(totalSets / (WEEK_TARGET * 8) * 100));
      }

      this.setData({
        hero: {
          name: (mainAct && (mainAct.nameZh || mainAct.name)) || '本次训练',
          date: latest.date.replace(/-/g, '/'),
          setIdx, setTotal
        },
        stats: {
          duration: Math.floor(dur / 60) + ':' + pad(dur % 60),
          kcal, completion
        }
      });

      // —— 数据分析 ——
      this.buildAnalysis(logs);
      // —— RPE 分布 ——
      this.buildRpe(logs);
      // —— 动作判断 / 下次处方 / 训练感受（P0 补全）——
      this.buildPerAction(latest);
      // —— 周度复盘（P1）——
      this.buildWeekly(logs);
      // —— 滚动复盘 / 基准对比（P2）——
      this.buildRolling(logs);
      this.buildBaseline(logs);
    },

    /* ===== 数据分析：本周 7 天柱状图 ===== */
    buildAnalysis(logs) {
      const today = new Date();
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        days.push({ key: dateKey(d), date: d, label: (d.getMonth() + 1) + '/' + d.getDate() });
      }
      const byDate = {};
      logs.forEach(l => { byDate[l.date] = (byDate[l.date] || 0) + loadOfLog(l); });

      const values = days.map(d => byDate[d.key] || 0);
      const total = values.reduce((s, v) => s + v, 0);
      const maxV = Math.max(...values, 1);

      const bars = days.map((d, i) => {
        const v = values[i];
        const h = v ? Math.max(2, Math.round(v / maxV * 100)) : 2;
        let color = 'g-dim';
        if (h >= 75) color = 'g-peak';
        else if (h >= 55) color = 'g-top';
        else if (h >= 35) color = 'g-mid';
        return {
          date: d.key,
          style: 'height: ' + h + '%;',
          color,
          label: v >= 1000 ? (v / 1000).toFixed(1) + 'k' : (v > 0 ? (v + '') : '')
        };
      });

      // 上一个 7 天
      const prevDays = [];
      for (let i = 13; i >= 7; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        prevDays.push(dateKey(d));
      }
      const prevTotal = prevDays.reduce((s, k) => s + (byDate[k] || 0), 0);
      const deltaPct = prevTotal ? Math.round((total - prevTotal) / prevTotal * 100) : 0;
      const deltaLabel = (deltaPct > 0 ? '+' : '') + deltaPct + '%';

      // 千分位格式化 total
      const totalLabel = total >= 1000
        ? (Math.round(total / 100) / 10 + '').replace(/\.0$/, '')
        : (total + '');

      this.setData({
        analysis: {
          totalLabel,
          deltaPct, deltaLabel,
          bars,
          xAxis: days.map((d, i) => ({ label: d.label, hot: i === days.length - 1 }))
        }
      });
    },

    /* ===== RPE 分布：全量训练集 4 档聚合 + 圆环渐变 ===== */
    buildRpe(logs) {
      const all = [];
      logs.forEach(l => l.actions.forEach(a => setsOf(a).forEach(s => {
        if (s.rpe != null && s.rpe !== '') {
          const v = num(s.rpe);
          if (v > 0 && v <= 10) all.push(v);
        }
      })));
      const n = all.length;
      if (!n) {
        this.setData({
          rpe: { totalPct: 0, pct10: 0, pct8: 0, pct6: 0, pct5: 0,
            ringStyle: 'background: conic-gradient(from -90deg, #2A3310 0% 100%, #4F8A2A 100% 100%, #C8FF00 100% 100%, #6F9F00 100% 100%, #B8D45A 100% 100%);',
            ariaLabel: '暂无 RPE 数据' }
        });
        return;
      }
      const c10 = all.filter(v => v >= 10).length;
      const c8 = all.filter(v => v >= 8 && v < 10).length;
      const c6 = all.filter(v => v >= 6 && v < 8).length;
      const c5 = all.filter(v => v > 0 && v < 6).length;
      const p10 = Math.round(c10 / n * 100);
      const p8 = Math.round(c8 / n * 100);
      const p6 = Math.round(c6 / n * 100);
      const p5 = 100 - p10 - p8 - p6;

      const a1 = p10, a2 = a1 + p8, a3 = a2 + p6, a4 = a3 + p5;
      const ringStyle =
        'background: conic-gradient(from -90deg,' +
        ' #2A3310 0% ' + a1 + '%,' +
        ' #4F8A2A ' + a1 + '% ' + a2 + '%,' +
        ' #C8FF00 ' + a2 + '% ' + a3 + '%,' +
        ' #6F9F00 ' + a3 + '% ' + a4 + '%,' +
        ' #B8D45A ' + a4 + '% 100%);';

      this.setData({
        rpe: {
          totalPct: 100,
          pct10: p10, pct8: p8, pct6: p6, pct5: p5,
          ringStyle,
          ariaLabel: 'RPE 分布：RPE 10 ' + p10 + '%，RPE 8–9 ' + p8 + '%，RPE 6–7 ' + p6 + '%，RPE ≤5 ' + p5 + '%'
        }
      });
    },

    /* ===== 动作判断 / 下次处方 / 训练感受（P0 补全）=====
       逐动作列出容量 / 峰值重量 / 强度(e1RM) / 平均 RPE，按 RPE 给下次处方，
       并聚合动作级备注（action.note）作为「训练感受」。 */
    buildPerAction(log) {
      const rows = (log.actions || []).map((a, idx) => {
        const ss = setsOf(a);
        const vol = ss.reduce((s, x) => s + (num(x.weight) || 0) * (num(x.reps) || 0), 0);
        let peakW = 0, peakReps = 0;
        ss.forEach(x => {
          const w = num(x.weight) || 0;
          if (w > peakW) { peakW = w; peakReps = num(x.reps) || 0; }
        });
        const rpes = ss.map(x => num(x.rpe)).filter(v => v > 0);
        const avgRpe = rpes.length ? Math.round(rpes.reduce((s, v) => s + v, 0) / rpes.length * 10) / 10 : 0;
        const e1rm = peakW ? Math.round(peakW * (1 + peakReps / 30)) : 0;
        return {
          key: idx,
          name: (a.nameZh || a.name) || '动作',
          vol, peakW, avgRpe, e1rm,
          note: (a.note || '').trim(),
          plan: planFor(avgRpe)
        };
      });
      const feelings = rows.filter(r => r.note).map(r => ({ name: r.name, note: r.note }));
      this.setData({ perAction: rows, feelings });
    },

    /* ===== 周度复盘（P1）=====
       本周完成度（训练天数 / 周目标）、训练天数、平均 RPE；
       力量进展（逐动作本周 vs 上周峰值 e1RM）；近 6 周平均 RPE 趋势。 */
    buildWeekly(logs) {
      const g = store.get();
      const weeklyTarget = (g.profile && g.profile.weeklyTarget) || WEEK_TARGET;
      const today = new Date();
      const keyOf = a => a.id || a.name;
      const daysOf = (from, to) => {
        const arr = [];
        for (let i = to; i >= from; i--) { const d = new Date(today); d.setDate(d.getDate() - i); arr.push(dateKey(d)); }
        return arr;
      };
      const thisWeek = daysOf(0, 6);
      const lastWeek = daysOf(7, 13);

      // 本周训练天数（去重日期）
      const trainDays = new Set(logs.filter(l => thisWeek.indexOf(l.date) >= 0).map(l => l.date)).size;
      const completion = weeklyTarget ? Math.min(100, Math.round(trainDays / weeklyTarget * 100)) : 0;
      const compStyle = 'background: conic-gradient(from -90deg, #C8FF00 0% ' + completion + '%, #E6E6E1 ' + completion + '% 100%);';

      // 本周平均 RPE
      let rpeSum = 0, rpeN = 0;
      logs.filter(l => thisWeek.indexOf(l.date) >= 0).forEach(l => l.actions.forEach(a => setsOf(a).forEach(s => {
        const v = num(s.rpe); if (v > 0) { rpeSum += v; rpeN++; }
      })));
      const avgRpe = rpeN ? Math.round(rpeSum / rpeN * 10) / 10 : 0;

      // 力量进展：逐动作本周 vs 上周 峰值 e1RM
      const peakE1 = (dateList) => {
        const m = {};
        logs.filter(l => dateList.indexOf(l.date) >= 0).forEach(l => l.actions.forEach(a => {
          const ss = setsOf(a); let pw = 0, pr = 0;
          ss.forEach(x => { const w = num(x.weight) || 0; if (w > pw) { pw = w; pr = num(x.reps) || 0; } });
          const e = pw ? Math.round(pw * (1 + pr / 30)) : 0;
          const k = keyOf(a);
          if (!m[k] || e > m[k].e1) m[k] = { name: (a.nameZh || a.name) || '动作', e1: e };
        }));
        return m;
      };
      const curM = peakE1(thisWeek), prevM = peakE1(lastWeek);
      const prog = [];
      Object.keys(curM).forEach(k => {
        const cur = curM[k].e1, prev = prevM[k] ? prevM[k].e1 : 0;
        prog.push({ name: curM[k].name, cur, prev, delta: cur - prev, isNew: !prevM[k] });
      });
      prog.sort((a, b) => b.cur - a.cur);

      // 近 6 周平均 RPE 趋势（W-5 → 本周）
      const weeks = [];
      for (let w = 5; w >= 0; w--) {
        const ds = daysOf(7 * w, 7 * w + 6);
        let s = 0, n = 0;
        logs.filter(l => ds.indexOf(l.date) >= 0).forEach(l => l.actions.forEach(a => setsOf(a).forEach(x => {
          const v = num(x.rpe); if (v > 0) { s += v; n++; }
        })));
        const wrpe = n ? Math.round(s / n * 10) / 10 : 0;
        weeks.push({
          label: w === 0 ? '本周' : ('W-' + w),
          rpe: wrpe,
          has: n > 0,
          barStyle: n ? ('height: ' + Math.round(wrpe * 10) + '%;') : ''
        });
      }

      this.setData({ weekly: { weeklyTarget, trainDays, completion, avgRpe, prog, weeks, compStyle } });
    },

    /* ===== 滚动复盘（P2）=====
       同动作 + 同器械分组，跨场次渐进对比。样本 <2 时诚实降级：不硬算公斤数，引导再练一次。 */
    buildRolling(logs) {
      const map = {};
      logs.forEach(l => l.actions.forEach(a => {
        const k = actionKey(a);
        if (!map[k]) map[k] = { key: k, name: (a.nameZh || a.name) || '动作', equip: a.equip || '', sessions: [] };
        const ss = setsOf(a);
        const vol = ss.reduce((s, x) => s + (num(x.weight) || 0) * (num(x.reps) || 0), 0);
        let pw = 0, pr = 0;
        ss.forEach(x => { const w = num(x.weight) || 0; if (w > pw) { pw = w; pr = num(x.reps) || 0; } });
        const e1 = pw ? Math.round(pw * (1 + pr / 30)) : 0;
        map[k].sessions.push({ date: l.date, vol, peakE1: e1, sets: ss.length });
      }));

      const groups = Object.keys(map).map(k => map[k]);
      groups.forEach(g => {
        g.sessions.sort((a, b) => a.date.localeCompare(b.date));
        g.count = g.sessions.length;
        g.firstDate = g.count ? g.sessions[0].date.replace(/-/g, '/') : '';
        g.lastDate = g.count ? g.sessions[g.count - 1].date.replace(/-/g, '/') : '';
        g.enough = g.count >= 2;
        if (g.enough) {
          const f = g.sessions[0], last = g.sessions[g.count - 1];
          g.volDeltaPct = f.vol ? Math.round((last.vol - f.vol) / f.vol * 100) : 0;
          g.e1DeltaPct = f.peakE1 ? Math.round((last.peakE1 - f.peakE1) / f.peakE1 * 100) : 0;
          const ratio = f.vol ? last.vol / f.vol : 1;
          if (ratio >= 1.1) g.rec = '容量稳步提升 · 可尝试渐进加重 2.5–5%';
          else if (ratio <= 0.9) g.rec = '容量下滑 · 检查恢复与训练一致性';
          else g.rec = '容量持平 · 建议增 1 组或提高 5% 重量突破平台';
          const maxV = Math.max(1, ...g.sessions.map(s => s.vol));
          g.bars = g.sessions.map(s => ({
            date: s.date.slice(5).replace('-', '/'),
            label: s.vol >= 1000 ? (s.vol / 1000).toFixed(1) + 'k' : ('' + s.vol),
            style: 'height: ' + Math.max(3, Math.round(s.vol / maxV * 100)) + '%;',
            e1: s.peakE1 || '—'
          }));
        } else {
          g.volDeltaPct = 0; g.e1DeltaPct = 0;
          g.rec = '样本不足 · 再完成 1 次同动作同器械训练即可建立对比';
          g.bars = [];
        }
      });
      groups.sort((a, b) => b.count - a.count); // 场次多的排前，默认选最有看点

      const prevKey = this.data.rolling && this.data.rolling.selKey;
      const selKey = (prevKey && map[prevKey]) ? prevKey : (groups[0] ? groups[0].key : '');
      const view = groups.find(g => g.key === selKey) || null;
      this.setData({ rolling: { groups, selKey, view } });
    },

    switchRollingGroup(e) {
      const key = e.currentTarget.dataset.key;
      const g = this.data.rolling.groups.find(x => x.key === key);
      this.setData({ 'rolling.selKey': key, 'rolling.view': g || null });
    },

    /* ===== 基准对比（P2）=====
       可靠样本 = 至少 1 个 set 记录 RPE 的训练。样本 <2 诚实降级，引导校准 RPE。 */
    buildBaseline(logs) {
      const rel = logs.filter(l => l.actions.some(a => setsOf(a).some(s => {
        const v = num(s.rpe); return v > 0 && v <= 10;
      })));
      const reliableCount = rel.length;
      const pct = Math.min(100, Math.round(reliableCount / 2 * 100));
      const blRingStyle = 'background: conic-gradient(from -90deg, #C8FF00 0% ' + pct + '%, #E6E6E1 ' + pct + '% 100%);';
      if (reliableCount < 2) {
        this.setData({ baseline: { reliableCount, enough: false, blRingStyle, rec: '记录 RPE 至少 2 次可靠训练后，自动生成基准线' } });
        return;
      }
      const sorted = rel.slice().sort((a, b) => a.date.localeCompare(b.date));
      const base = sorted[0], cur = sorted[sorted.length - 1];
      const avgRpeOf = (l) => {
        let s = 0, n = 0;
        l.actions.forEach(a => setsOf(a).forEach(x => { const v = num(x.rpe); if (v > 0) { s += v; n++; } }));
        return n ? Math.round(s / n * 10) / 10 : 0;
      };
      const bRpe = avgRpeOf(base), cRpe = avgRpeOf(cur);
      const bVol = loadOfLog(base), cVol = loadOfLog(cur);
      const rpeDelta = Math.round((cRpe - bRpe) * 10) / 10;
      const volDeltaPct = bVol ? Math.round((cVol - bVol) / bVol * 100) : 0;
      let rec;
      if (cRpe > bRpe + 1 && cVol >= bVol) rec = '强度感知上升且容量不降 · 训练有效，保持节奏';
      else if (cVol > bVol * 1.1) rec = '容量明显增长 · 注意控制 RPE 避免过度疲劳';
      else if (cVol < bVol * 0.9) rec = '容量回落 · 检查训练频率与恢复';
      else rec = '表现稳定 · 可尝试小幅渐进';
      const fmt = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : ('' + v);
      this.setData({
        baseline: {
          reliableCount, enough: true, blRingStyle,
          baseDate: base.date.replace(/-/g, '/'), curDate: cur.date.replace(/-/g, '/'),
          bRpe, cRpe, rpeDelta, bVol: fmt(bVol), cVol: fmt(cVol), volDeltaPct, rec
        }
      });
    },

    openRpeGuide() {
      wx.showModal({
        title: 'RPE 主观疲劳度',
        showCancel: false,
        content: 'RPE 1–10 自评训练当时（每组末）的吃力程度：\n\n10 力竭，完全做不动\n9 还剩 1 次\n8 还剩 2 次\n7 还能做 3 次（较轻松）\n5–6 中等\n1–4 很轻\n\n记录越准，复盘越可信。建议每组结束随手点一下 RPE。'
      });
    },

    // 周度复盘顶部「目标 N 次」点击修改（落 store.profile.weeklyTarget）
    editWeeklyTarget() {
      const g = store.get();
      const cur = (g.profile && g.profile.weeklyTarget) || WEEK_TARGET;
      wx.showModal({
        title: '每周训练目标',
        editable: true,
        placeholderText: '输入每周训练次数',
        content: String(cur),
        success: (r) => {
          if (!r.confirm) return;
          const n = parseInt(r.content, 10);
          if (n > 0 && n < 15) {
            store.setWeeklyTarget(n);
            this.buildWeekly(store.get().trainingLogs || []);
          }
        }
      });
    },

    /* ===== 交互 ===== */
    switchTab(e) {
      this.setData({ tab: e.currentTarget.dataset.tab });
    }
  }
});

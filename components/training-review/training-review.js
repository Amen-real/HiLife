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

Component({
  data: {
    tab: 'single',

    // 单次复盘所需
    hero: { name: '', date: '', setIdx: 0, setTotal: 0 },
    stats: { duration: '--:--', kcal: 0, completion: 0 },
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

    /* ===== 交互 ===== */
    switchTab(e) {
      this.setData({ tab: e.currentTarget.dataset.tab });
    }
  }
});

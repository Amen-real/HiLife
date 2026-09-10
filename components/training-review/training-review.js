// components/training-review/training-review.js
// 训练复盘 v2 —— 两页结构：本次训练（默认）/ 进步趋势。
// 设计原则：只回答三个问题——这次练得怎么样 / 最近趋势如何 / 下次怎么练。
// 术语策略：UI 层不出现 "RPE"，统一称「吃力程度」；数据层 setsDetail[].rpe 仍存 1–10 原值，历史数据无缝兼容。
// 数据源：store.trainingLogs（saveWorkout 产出）。
const store = require('../../utils/store.js');

const WEEK_TARGET = 3;       // 完成度参考基准（profile 未设置时）
const CAL_PER_MIN = 8;       // kcal/分钟（与数据页一致）

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
function actionKey(a) {
  // 同动作 + 同器械 = 可比场次
  return (a.id || a.name || '动作') + ' ' + (a.equip || '');
}
function fmtW(w) { return (w % 1 === 0) ? String(w) : w.toFixed(1); }
function fmtVol(v) {
  if (v >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}
function durationSecOfLog(log) {
  if (log.durationMin) return log.durationMin * 60;   // 预留：若未来落库总时长字段则优先
  // 整个训练时长 = Σ(trainSec + restSec)，与数据页 totalFullSec 口径一致；旧日志无 restSec 由 ||0 兜底
  let sec = 0;
  log.actions.forEach(a => setsOf(a).forEach(s => { sec += (num(s.trainSec) || 0) + (num(s.restSec) || 0); }));
  return Math.max(0, Math.round(sec));
}
function loadOfLog(log) {
  // 训练量 = Σ 重量 × 次数
  return log.actions.reduce((s, a) => s + setsOf(a).reduce((ss, x) => ss + (num(x.weight) || 0) * (num(x.reps) || 0), 0), 0);
}
// 一组动作的最好一组（重量最大，平手取次数多）：{ topW, reps }
function bestSetOf(a) {
  let topW = -1, reps = 0;
  setsOf(a).forEach(x => {
    const w = num(x.weight) || 0, r = num(x.reps) || 0;
    if (w > topW || (w === topW && r > reps)) { topW = w; reps = r; }
  });
  return { topW: topW < 0 ? 0 : topW, reps };
}
// 逐动作下次建议（基于平均吃力程度；原始 RPE 口径不变）
function planFor(avgRpe, hasRpe) {
  if (!hasRpe) return '记录吃力程度后，这里给下次建议';
  if (avgRpe >= 9) return '接近力竭 · 下次维持容量，谨慎加重';
  if (avgRpe <= 6) return '状态轻松 · 下次可加重 2.5–5%';
  return '强度适中 · 保持容量稳步推进';
}

const EMPTY_RING = 'background: conic-gradient(from -90deg, #C8FF00 0% 0%, rgba(128,128,128,0.25) 0% 100%);';

Component({
  data: {
    tab: 'single',
    empty: false,

    // ===== 本次训练 =====
    logsCount: 0,
    selIdx: 0,                                  // 场次下标（0 = 最新）
    sessionDate: '',
    sessionSub: '',                             // '6 动作 · 18 组'
    verdict: '',                                // 一句话结论
    stats: { duration: '--:--', volume: '0', effort: '—' },
    perAction: [],                              // {key,name,chip{cls,text},best,sets,rpeTxt,plan}
    feelings: [],

    // ===== 进步趋势 =====
    weekly: { weeklyTarget: 3, trainDays: 0, completion: 0, avgRpe: 0, compStyle: EMPTY_RING },
    keyActions: [],                             // top3 {key,name,count,chip{cls,text},firstTxt,lastTxt,bars[{key,style,hot}]}
    weeks: []                                   // 近 6 周 {key,label,rpe,has,barStyle}
  },

  lifetimes: { attached() { this.rebuild(); } },
  pageLifetimes: { show() { this.rebuild(); } },

  methods: {
    /* ===== 主流程 ===== */
    rebuild() {
      const g = store.get();
      const logsDesc = (g.trainingLogs || []).slice().sort((a, b) => b.date.localeCompare(a.date));
      this._logs = logsDesc;

      if (!logsDesc.length) {
        this.setData({
          empty: true, logsCount: 0, selIdx: 0,
          sessionDate: '', sessionSub: '', verdict: '',
          stats: { duration: '--:--', volume: '0', effort: '—' },
          perAction: [], feelings: [], keyActions: [], weeks: [],
          weekly: { weeklyTarget: (g.profile && g.profile.weeklyTarget) || WEEK_TARGET, trainDays: 0, completion: 0, avgRpe: 0, compStyle: EMPTY_RING }
        });
        return;
      }

      const idx = Math.min(this.data.selIdx || 0, logsDesc.length - 1);
      this.setData({ empty: false, logsCount: logsDesc.length });
      this.buildSession(idx);
      this.buildWeekly(logsDesc);
      this.buildKeyActions(logsDesc);
    },

    /* ===== 本次训练 ===== */
    buildSession(idx) {
      const logs = this._logs;
      const log = logs[idx];
      const prev = logs[idx + 1] || null;       // 上一场（更早）
      this._selIdx = idx;

      const actions = log.actions || [];
      const totalSets = actions.reduce((s, a) => s + setsOf(a).length, 0);
      const vol = loadOfLog(log);
      const sec = durationSecOfLog(log);

      // 平均吃力程度（全场）
      let rs = 0, rn = 0;
      actions.forEach(a => setsOf(a).forEach(s => {
        const v = num(s.rpe); if (v > 0 && v <= 10) { rs += v; rn++; }
      }));
      const avgRpe = rn ? Math.round(rs / rn * 10) / 10 : 0;

      // 一句话结论：本场 vs 上一场（全场口径）+ 吃力解读
      let verdict = '';
      if (prev) {
        const pVol = loadOfLog(prev);
        const pct = pVol ? Math.round((vol - pVol) / pVol * 100) : 0;
        const volTxt = pct >= 5 ? '容量比上场 +' + pct + '%'
          : (pct <= -5 ? '容量比上场 −' + Math.abs(pct) + '%' : '容量与上场持平');
        let effTxt = '';
        if (rn) {
          if (avgRpe <= 6.4) effTxt = '吃力程度不高还有余量，下次可加重 2.5–5%';
          else if (avgRpe >= 8.5) effTxt = '已接近力竭，下次维持容量优先恢复';
          else effTxt = '强度适中，稳步推进即可';
        } else {
          effTxt = '记录吃力程度可获得下次建议';
        }
        verdict = volTxt + ' · ' + effTxt;
      } else {
        verdict = '首次记录 · 再完成一次训练即可开始对比';
      }

      // 逐动作表现
      const rows = actions.map((a, ai) => {
        const ss = setsOf(a);
        const aVol = ss.reduce((s, x) => s + (num(x.weight) || 0) * (num(x.reps) || 0), 0);
        const best = bestSetOf(a);
        const bestTxt = best.topW > 0 ? fmtW(best.topW) + 'kg × ' + best.reps : (best.reps ? '自重 × ' + best.reps : '—');

        const rpes = ss.map(x => num(x.rpe)).filter(v => v > 0 && v <= 10);
        const rmin = rpes.length ? Math.round(Math.min.apply(null, rpes)) : 0;
        const rmax = rpes.length ? Math.round(Math.max.apply(null, rpes)) : 0;
        const rpeTxt = !rpes.length ? '—' : (rmin === rmax ? String(rmin) : rmin + '–' + rmax);
        const avgR = rpes.length ? Math.round(rpes.reduce((s, v) => s + v, 0) / rpes.length * 10) / 10 : 0;

        // vs 上次（同动作同器械的最近更早场次）
        let chip;
        const prevRec = this.findPrev(actionKey(a), idx);
        if (!prevRec) {
          chip = { cls: 'flat', text: '首次记录' };
        } else {
          const pct = prevRec.vol ? Math.round((aVol - prevRec.vol) / prevRec.vol * 100) : 0;
          if (pct >= 5) chip = { cls: 'up', text: '比上次 ↑' + pct + '%' };
          else if (pct <= -5) chip = { cls: 'down', text: '比上次 ↓' + Math.abs(pct) + '%' };
          else chip = { cls: 'flat', text: '与上次持平' };
        }

        return {
          key: ai,
          name: (a.nameZh || a.name) || '动作',
          chip, best: bestTxt, sets: ss.length, rpeTxt,
          plan: planFor(avgR, rpes.length > 0),
          note: (a.note || '').trim()
        };
      });
      const feelings = rows.filter(r => r.note).map(r => ({ key: r.key, name: r.name, note: r.note }));

      this.setData({
        selIdx: idx,
        sessionDate: log.date.replace(/-/g, '/'),
        sessionSub: actions.length + ' 动作 · ' + totalSets + ' 组',
        verdict,
        stats: {
          duration: Math.floor(sec / 60) + ':' + pad(sec % 60),
          volume: fmtVol(vol),
          effort: rn ? avgRpe + '/10' : '—'
        },
        perAction: rows,
        feelings
      });
    },

    // 在 idx（不含）之前的更早场次中，找同动作最近一次的容量
    findPrev(key, idx) {
      const logs = this._logs;
      for (let i = idx + 1; i < logs.length; i++) {
        const hit = (logs[i].actions || []).find(a => actionKey(a) === key);
        if (hit) {
          const vol = setsOf(hit).reduce((s, x) => s + (num(x.weight) || 0) * (num(x.reps) || 0), 0);
          return { vol };
        }
      }
      return null;
    },

    // ‹ › 切换历史场次
    selSession(e) {
      const dir = e.currentTarget.dataset.dir === 'older' ? 1 : -1;
      const idx = this._selIdx + dir;
      if (idx < 0 || idx >= this._logs.length) return;
      this.buildSession(idx);
    },

    /* ===== 进步趋势 ===== */
    // 周完成度 + 本周平均吃力 + 近 6 周努力度
    buildWeekly(logsDesc) {
      const g = store.get();
      const weeklyTarget = (g.profile && g.profile.weeklyTarget) || WEEK_TARGET;
      const today = new Date();
      const daysOf = (from, to) => {
        const arr = [];
        for (let i = to; i >= from; i--) { const d = new Date(today); d.setDate(d.getDate() - i); arr.push(dateKey(d)); }
        return arr;
      };
      const thisWeek = daysOf(0, 6);

      const trainDays = new Set(logsDesc.filter(l => thisWeek.indexOf(l.date) >= 0).map(l => l.date)).size;
      const completion = weeklyTarget ? Math.min(100, Math.round(trainDays / weeklyTarget * 100)) : 0;
      const compStyle = 'background: conic-gradient(from -90deg, #C8FF00 0% ' + completion + '%, rgba(128,128,128,0.25) ' + completion + '% 100%);';

      let rs = 0, rn = 0;
      logsDesc.filter(l => thisWeek.indexOf(l.date) >= 0).forEach(l => l.actions.forEach(a => setsOf(a).forEach(s => {
        const v = num(s.rpe); if (v > 0) { rs += v; rn++; }
      })));
      const avgRpe = rn ? Math.round(rs / rn * 10) / 10 : 0;

      // 近 6 周努力度（平均吃力）
      const weeks = [];
      for (let w = 5; w >= 0; w--) {
        const ds = daysOf(7 * w, 7 * w + 6);
        let s = 0, n = 0;
        logsDesc.filter(l => ds.indexOf(l.date) >= 0).forEach(l => l.actions.forEach(a => setsOf(a).forEach(x => {
          const v = num(x.rpe); if (v > 0) { s += v; n++; }
        })));
        const wrpe = n ? Math.round(s / n * 10) / 10 : 0;
        weeks.push({
          key: 'w' + w,
          label: w === 0 ? '本周' : 'W-' + w,
          rpe: wrpe,
          has: n > 0,
          barStyle: n ? ('height: ' + Math.round(wrpe * 10) + '%;') : ''
        });
      }

      this.setData({ weekly: { weeklyTarget, trainDays, completion, avgRpe, compStyle }, weeks });
    },

    // 关键动作：自动取场次最多的前 3 个动作，展示"最好一组"跨场趋势（免用户挑选）
    buildKeyActions(logsDesc) {
      const map = {};
      logsDesc.forEach(l => l.actions.forEach(a => {
        const k = actionKey(a);
        if (!map[k]) map[k] = { key: k, name: (a.nameZh || a.name) || '动作', sessions: [] };
        const best = bestSetOf(a);
        map[k].sessions.push({ date: l.date, topW: best.topW, reps: best.reps });
      }));
      const groups = Object.keys(map).map(k => map[k]);
      groups.forEach(g => g.sessions.sort((a, b) => a.date.localeCompare(b.date)));
      // 场次多者优先；同场次取更近有记录的
      groups.sort((a, b) => b.sessions.length - a.sessions.length ||
        b.sessions[b.sessions.length - 1].date.localeCompare(a.sessions[a.sessions.length - 1].date));

      const keyActions = groups.slice(0, 3).map(g => {
        const s = g.sessions;
        const last = s[s.length - 1];
        const maxW = Math.max(1, ...s.map(x => x.topW));
        const bars = s.slice(-8).map((x, i, arr) => ({
          key: x.date,
          style: 'height: ' + Math.max(4, Math.round((x.topW || maxW) / maxW * 100)) + '%;',
          hot: i === arr.length - 1
        }));
        const fmtOne = (x) => x.topW > 0 ? fmtW(x.topW) + 'kg×' + x.reps : '自重×' + x.reps;

        let chip;
        if (s.length >= 2 && s[0].topW > 0) {
          const pct = Math.round((last.topW - s[0].topW) / s[0].topW * 100);
          chip = pct >= 3 ? { cls: 'up', text: '+' + pct + '%' }
            : (pct <= -3 ? { cls: 'down', text: '−' + Math.abs(pct) + '%' } : { cls: 'flat', text: '持平' });
        } else {
          chip = { cls: 'flat', text: s.length + ' 场' };
        }

        return {
          key: g.key,
          name: g.name,
          chip,
          firstTxt: fmtOne(s[0]),
          lastTxt: fmtOne(last),
          firstDate: s[0].date.slice(5).replace('-', '/'),
          lastDate: last.date.slice(5).replace('-', '/'),
          bars
        };
      });

      this.setData({ keyActions });
    },

    /* ===== 交互 ===== */
    switchTab(e) {
      this.setData({ tab: e.currentTarget.dataset.tab });
    },

    openEffortGuide() {
      wx.showModal({
        title: '吃力程度',
        showCancel: false,
        content: '按做完这组的感觉选：\n\n快力竭 —— 完全做不动\n很累 —— 还剩 1 次\n有点累 —— 还剩 2–3 次\n很轻松 —— 游刃有余\n\n随手标一下，下次帮你决定加多少重量。'
      });
    },

    // 进步趋势顶部「目标 N 次」点击修改（落 store.profile.weeklyTarget）
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
            this.buildWeekly(this._logs || []);
          }
        }
      });
    }
  }
});

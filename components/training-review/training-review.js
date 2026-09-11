// components/training-review/training-review.js
// 训练复盘 v2 —— 两页结构：本次训练（默认）/ 进步趋势。
// 设计原则：只回答三个问题——这次练得怎么样 / 最近趋势如何 / 下次怎么练。
// 术语策略：UI 层不出现 "RPE"，统一称「吃力程度」；数据层 setsDetail[].rpe 仍存 1–10 原值，历史数据无缝兼容。
// 数据源：store.trainingLogs（saveWorkout 产出）。
//
// 口径（2026-09-11 定案，实现集中在 utils/dateRange.js + utils/trainingStats.js）：
//   · 「本周」= 自然周（周一 00:00 起，半开区间），与计划页组头周进度同一口径；
//   · 周目标优先级 = 计划 daysPerWeek > 个人设置 weeklyTarget > 默认 3；
//   · 「结论」只比共同动作（轮转换动作不算退步），无共同动作降级比各动作自身历史。
const store = require('../../utils/store.js');
const dateRange = require('../../utils/dateRange.js');
const stats = require('../../utils/trainingStats.js');

const EMPTY_RING = 'background: conic-gradient(from -90deg, #C8FF00 0% 0%, rgba(128,128,128,0.25) 0% 100%);';

function fmtW(w) { return (w % 1 === 0) ? String(w) : w.toFixed(1); }
// 训练量格式化（≥10000 走 k 缩写），仅本组件展示用
function fmtVol(v) {
  if (v >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

Component({
  properties: {
    // 记录页选中日期 → 复盘打开时直接定位到该天的场次（''=保持默认最新一场）
    focusDate: {
      type: String,
      value: '',
      observer(v) { if (this._logs && this._logs.length) this._applyFocus(v); }
    }
  },

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
    perAction: [],                              // {key,name,chip{cls,text},best,setsMeta,rpeTxt,plan,note}
    feelings: [],

    // ===== 进步趋势 =====
    weekly: { weeklyTarget: 3, fromPlan: false, trainDays: 0, completion: 0, avgRpe: 0, compStyle: EMPTY_RING },
    keyActions: [],                             // top3 {key,name,count,chip{cls,text},firstTxt,lastTxt,bars[{key,style,hot}]}
    weeks: []                                   // 近 6 周 {key,label,rpe,has,barStyle}
  },

  lifetimes: { attached() { this.rebuild(); } },
  pageLifetimes: { show() { this.rebuild(); } },

  methods: {
    /* ===== 主流程 ===== */
    rebuild() {
      const g = store.get();
      const logsDesc = (g.trainingLogs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      this._logs = logsDesc;

      const target = stats.weekTargetOf(g.profile, store.getActivePlan());

      if (!logsDesc.length) {
        this.setData({
          empty: true, logsCount: 0, selIdx: 0,
          sessionDate: '', sessionSub: '', verdict: '',
          stats: { duration: '--:--', volume: '0', effort: '—' },
          perAction: [], feelings: [], keyActions: [], weeks: [],
          weekly: { weeklyTarget: target.target, fromPlan: target.fromPlan, trainDays: 0, completion: 0, avgRpe: 0, compStyle: EMPTY_RING }
        });
        return;
      }

      // 记录页选中的日期优先（用户手动翻过场次后 _focusOverride 置位，不再跟随）；
      // 无匹配则回到「最新一场」
      const fd = this._focusOverride ? '' : this.data.focusDate;
      const focusIdx = fd ? logsDesc.findIndex(l => l.date === fd) : -1;
      const idx = focusIdx >= 0 ? focusIdx : Math.min(this.data.selIdx || 0, logsDesc.length - 1);

      this.setData({ empty: false, logsCount: logsDesc.length });
      this.buildSession(idx);
      this.buildWeekly(logsDesc);
      this.buildKeyActions(logsDesc);
    },

    // 记录页选中日期联动：定位到该天最近一场；无匹配则保持当前选择
    _applyFocus(iso) {
      if (!iso || this._focusOverride || !this._logs || !this._logs.length) return;
      const i = this._logs.findIndex(l => l.date === iso);
      if (i >= 0 && i !== this._selIdx) this.buildSession(i);
    },

    /* ===== 本次训练 ===== */
    buildSession(idx) {
      const logs = this._logs;
      const log = logs[idx];
      this._selIdx = idx;

      const actions = log.actions || [];
      const totalSets = actions.reduce((s, a) => s + stats.setsOf(a).length, 0);
      const vol = stats.loadOfLog(log);
      const sec = stats.durationSecOfLog(log);
      const rpe = stats.avgRpeOfActions(actions);

      // 一句话结论：只比共同动作（换动作不算退步），口径见 utils/trainingStats.buildVerdict
      const verdict = stats.buildVerdict({ log, logsDesc: logs, idx, rpe }).text;

      // 逐动作表现
      const rows = actions.map((a, ai) => {
        const ss = stats.setsOf(a);
        const aVol = stats.loadOfAction(a);
        const best = stats.bestSetOf(a);
        const bestTxt = best.topW > 0 ? fmtW(best.topW) + 'kg × ' + best.reps : (best.reps ? '自重 × ' + best.reps : '—');

        const rpes = ss.map(x => stats.num(x.rpe)).filter(v => v > 0 && v <= 10);
        const rmin = rpes.length ? Math.round(Math.min.apply(null, rpes)) : 0;
        const rmax = rpes.length ? Math.round(Math.max.apply(null, rpes)) : 0;
        const rpeTxt = !rpes.length ? '—' : (rmin === rmax ? String(rmin) : rmin + '–' + rmax);
        const avgR = rpes.length ? Math.round(rpes.reduce((s, v) => s + v, 0) / rpes.length * 10) / 10 : 0;

        // vs 上次（同动作同器械的最近更早场次）；用可比容量，自重动作退化为总次数
        let chip;
        const prevVol = stats.findPrevVol(stats.actionKey(a), logs, idx);
        if (prevVol == null) {
          chip = { cls: 'flat', text: '首次记录' };
        } else {
          const cap = stats.capacityOfAction(a);
          const pct = prevVol ? Math.round((cap - prevVol) / prevVol * 100) : 0;
          if (pct >= stats.DELTA_SESSION) chip = { cls: 'up', text: '比上次 ↑' + pct + '%' };
          else if (pct <= -stats.DELTA_SESSION) chip = { cls: 'down', text: '比上次 ↓' + Math.abs(pct) + '%' };
          else chip = { cls: 'flat', text: '与上次持平' };
        }

        return {
          key: ai,
          name: (a.nameZh || a.name) || '动作',
          chip,
          best: bestTxt,                        // 注意：必须给字符串，给 bestSetOf 的对象会渲染成 [object Object]
          setsMeta: stats.setsMetaOf(a),        // '3 组 × 12/10/8 次'（逐组聚合，不再只取末组）
          rpeTxt,
          plan: stats.actionAdvice(avgR, rpes.length > 0),
          note: (a.note || '').trim()
        };
      });
      const feelings = rows.filter(r => r.note).map(r => ({ key: r.key, name: r.name, note: r.note }));

      this.setData({
        selIdx: idx,
        sessionDate: dateRange.fmtDateSlash(log.date),
        sessionSub: actions.length + ' 动作 · ' + totalSets + ' 组',
        verdict,
        stats: {
          duration: Math.floor(sec / 60) + ':' + dateRange.pad2(sec % 60),
          volume: fmtVol(vol),
          effort: rpe.count ? rpe.avg + '/10' : '—'
        },
        perAction: rows,
        feelings
      });
    },

    // ‹ › 切换历史场次
    selSession(e) {
      const dir = e.currentTarget.dataset.dir === 'older' ? 1 : -1;
      const idx = this._selIdx + dir;
      if (idx < 0 || idx >= this._logs.length) return;
      // 手动翻过场次就解除「记录页日期联动」，否则下次 rebuild 又被拉回 focusDate。
      // 组件随 tab 切换销毁重建，故这里的置位是本次驻留内有效。
      this._focusOverride = true;
      this.buildSession(idx);
    },

    /* ===== 进步趋势 ===== */
    // 周完成度 + 本周平均吃力 + 近 6 周努力度（全部按自然周，与计划页一致）
    buildWeekly(logsDesc) {
      const g = store.get();
      const target = stats.weekTargetOf(g.profile, store.getActivePlan());
      const weeklyTarget = target.target;
      const now = new Date();

      const wk = dateRange.weekRange(now);
      const inThisWeek = l => dateRange.inRange(l.date, wk.monStr, wk.sunStr);

      const trainDays = new Set(logsDesc.filter(inThisWeek).map(l => l.date)).size;
      const completion = weeklyTarget ? Math.min(100, Math.round(trainDays / weeklyTarget * 100)) : 0;
      const compStyle = 'background: conic-gradient(from -90deg, #C8FF00 0% ' + completion + '%, rgba(128,128,128,0.25) ' + completion + '% 100%);';

      let rs = 0, rn = 0;
      logsDesc.filter(inThisWeek).forEach(l => { const r = stats.rpeSumOfActions(l.actions); rs += r.sum; rn += r.count; });
      const avgRpe = rn ? Math.round(rs / rn * 10) / 10 : 0;

      // 近 6 周努力度（自然周桶，W-5 … 本周）
      const weeks = [];
      for (let w = 5; w >= 0; w--) {
        const wr = dateRange.weekRangeOffset(now, -w);
        let s = 0, n = 0;
        logsDesc.filter(l => dateRange.inRange(l.date, wr.monStr, wr.sunStr)).forEach(l => {
          const r = stats.rpeSumOfActions(l.actions); s += r.sum; n += r.count;
        });
        const wrpe = n ? Math.round(s / n * 10) / 10 : 0;
        weeks.push({
          key: 'w' + w,
          label: w === 0 ? '本周' : 'W-' + w,
          rpe: wrpe,
          has: n > 0,
          // min-height 保证「有数据但很轻」的周也画得出柱子
          barStyle: n ? ('height: ' + Math.max(6, Math.round(wrpe * 10)) + '%; min-height: 8%;') : ''
        });
      }

      this.setData({ weekly: { weeklyTarget, fromPlan: target.fromPlan, trainDays, completion, avgRpe, compStyle }, weeks });
    },

    // 关键动作：自动取场次最多的前 3 个动作，展示「最好一组」跨场趋势（免用户挑选）
    buildKeyActions(logsDesc) {
      const map = {};
      logsDesc.forEach(l => (l.actions || []).forEach(a => {
        const k = stats.actionKey(a);
        if (!map[k]) map[k] = { key: k, name: (a.nameZh || a.name) || '动作', sessions: [] };
        const best = stats.bestSetOf(a);
        map[k].sessions.push({ date: l.date, topW: best.topW, reps: best.reps });
      }));
      const groups = Object.keys(map).map(k => map[k]);
      groups.forEach(g => g.sessions.sort((a, b) => String(a.date).localeCompare(String(b.date))));
      // 场次多者优先；同场次取更近有记录的
      groups.sort((a, b) => b.sessions.length - a.sessions.length ||
        String(b.sessions[b.sessions.length - 1].date).localeCompare(String(a.sessions[a.sessions.length - 1].date)));

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
          chip = pct >= stats.DELTA_TREND ? { cls: 'up', text: '+' + pct + '%' }
            : (pct <= -stats.DELTA_TREND ? { cls: 'down', text: '−' + Math.abs(pct) + '%' } : { cls: 'flat', text: '持平' });
        } else {
          chip = { cls: 'flat', text: s.length + ' 场' };
        }

        return {
          key: g.key,
          name: g.name,
          chip,
          firstTxt: fmtOne(s[0]),
          lastTxt: fmtOne(last),
          firstDate: String(s[0].date).slice(5).replace('-', '/'),
          lastDate: String(last.date).slice(5).replace('-', '/'),
          bars
        };
      });

      this.setData({ keyActions });
    },

    /* ===== 交互 ===== */
    switchTab(e) {
      this.setData({ tab: e.currentTarget.dataset.tab });
    },

    // 空态 CTA：跳训练页开始第一次
    goTrain() {
      wx.switchTab({ url: '/pages/training/training' });
    },

    openEffortGuide() {
      wx.showModal({
        title: '吃力程度怎么选',
        showCancel: false,
        content: '按「做完这组还剩几次」对照 1–10 分：\n\n'
          + '9–10 快力竭 —— 完全做不动\n'
          + '7–8  很累 —— 还剩 1 次\n'
          + '5–6  有点累 —— 还剩 2–3 次\n'
          + '1–4  很轻松 —— 游刃有余\n\n'
          + '随手标一下，下次帮你决定加多少重量。'
      });
    },

    // 周目标：默认来自个人设置，可点改；若由计划（daysPerWeek）决定则不允许就地改
    editWeeklyTarget() {
      if (this.data.weekly.fromPlan) {
        wx.showToast({ title: '目标由当前计划的训练日数决定', icon: 'none' });
        return;
      }
      const g = store.get();
      const cur = stats.weekTargetOf(g.profile, null).target;
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
            this.rebuild();
          }
        }
      });
    }
  }
});

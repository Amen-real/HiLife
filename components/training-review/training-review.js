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
// 分享卡：内容模型 + 版式 + 绘制都在 utils/shareCard.js（纯函数，守卫可在 node 里断言）
const shareCard = require('../../utils/shareCard.js');
// 「这场练完之后」的肌群状态回放：now 钉在该场次结束时刻（口径见该文件顶部三条）
const sessionAfter = require('../../utils/sessionAfter.js');

// 低于这个场次不画趋势图：1 根柱不是趋势，只会让人觉得「这页没用」
const TREND_MIN_LOGS = 2;

// 关键动作卡位上限：自动列表与自定义选择共用同一容量（改这里会同时影响两边）
const KA_MAX = 3;

// 重量/训练量/个人纪录/chip 一律取 trainingStats 的单源实现。
// 【历史】本组件曾自己维护 fmtW / fmtVol / buildRecords / 「比上次 ↑x%」四份口径，
// 「我的」页也各写了一份 fmtVol（注释还写着「与复盘页 fmtVol 同款」）——
// 同一场训练在不同页面数字/说法不一致，就是这么来的。现已全部收回 stats。

Component({
  properties: {
    // 记录页选中日期 → 复盘打开时直接定位到该天的场次（''=保持默认最新一场）
    focusDate: {
      type: String,
      value: '',
      observer(v) { if (this._logs && this._logs.length) this._applyFocus(v); }
    },
    // 训练页「完成并生成分享图」带 share=1 跳进来 → 落地后自动打开分享卡。
    // 是**一次性信号**：本组件同时挂在 tab 页（数据），而 pageLifetimes.show 每次回到
    // 本页都会 rebuild，若在这里无条件重开，用户手动关掉分享卡后一切回前台它又弹回来。
    // 故只消费一次（_wantShare 置位 → 开出即清）。
    autoShare: {
      type: Boolean,
      value: false,
      observer(v) { if (v) { this._wantShare = true; this._tryAutoShare(); } }
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
    // 下次训练建议（可回填计划）：全部文本字段必须是字符串/数字，不得塞对象
    suggest: [],
    hasSuggest: false,
    // 「练完之后」肌群状态回放（B②口径）：now = 该场次结束时刻，**不是此刻**
    afterChips: [], afterSummary: '', afterHint: '', hasAfter: false,
    canApply: false,

    // ===== 进步趋势 =====
    keyActions: [],                             // {key,name,chip{cls,text},firstTxt,lastTxt,firstCap,lastCap,firstDate,lastDate,bars[{key,style,hot}]}
    weeks: [],                                  // 近 6 周 {key,label,vol,volTxt,days,has,pct,barStyle}
    records: [],                                // 个人纪录 top3 {key,name,valTxt,dateTxt,isNew}
    recordsSummary: '',
    trendReady: false,                          // 场次不足时不画趋势图（1 根柱不是趋势）
    trendNeed: 0,
    // 关键动作「可切换」：默认自动前 3，用户可在弹层里改（存 store.keyActionPicks）
    pickOptions: [],                            // {key,name,count,metaTxt,checked}
    kaSheet: false,
    kaTabSafe: false,                           // true = 宿主页有自定义 tabBar → 抽屉底部预留 88rpx
    kaCustom: false,                            // true = 用户自定义过（空数组视为未自定义）
    kaPickedCount: 0,
    kaMax: KA_MAX,

    // ===== 分享卡 =====
    shareShow: false,                           // 预览弹层
    shareBusy: false,                           // 生成中（此时画布在视口外绘制）
    shareImg: '',                               // 生成好的临时图片路径
    scTabSafe: false,                           // true = 宿主页有自定义 tabBar → 抽屉底部让出底栏
    // 三个开关都作用在**内容模型**上（真实能力），不是只存本地布尔值：
    shareHide: false,                           // 隐藏训练内容 → 不出动作明细卡
    shareMerge: false,                          // 合并当天 → 同日多场合成一张
    shareStyle: 'light',                        // 卡片样式 → 换调色板
    shareStyleName: '浅色'
  },

  lifetimes: {
    attached() {
      // 属性观察器与 attached 的**先后顺序**由基础库实现决定（初始值可能先于 attached 送达），
      // 两条路径都必须能把「自动开分享卡」这个信号捡起来，故这里再读一次 data.autoShare。
      if (this.data.autoShare) this._wantShare = true;
      this.rebuild();
    }
  },
  pageLifetimes: { show() { this.rebuild(); } },

  methods: {
    /* ===== 主流程 ===== */
    rebuild() {
      const g = store.get();
      const logsDesc = (g.trainingLogs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      this._logs = logsDesc;

      if (!logsDesc.length) {
        this.setData({
          empty: true, logsCount: 0, selIdx: 0,
          sessionDate: '', sessionSub: '', verdict: '',
          stats: { duration: '--:--', volume: '0', effort: '—' },
          perAction: [], feelings: [], keyActions: [], weeks: [],
          records: [], recordsSummary: '', trendReady: false, trendNeed: 0,
          pickOptions: [], kaSheet: false, kaTabSafe: false, kaCustom: false, kaPickedCount: 0,
          suggest: [], hasSuggest: false, canApply: false,
          afterChips: [], afterSummary: '', afterHint: '', hasAfter: false   // 防切场次时残留上一场的状态
        });
        this._tryAutoShare();
        return;
      }

      // 记录页选中的日期优先（用户手动翻过场次后 _focusOverride 置位，不再跟随）；
      // 无匹配则回到「最新一场」
      const fd = this._focusOverride ? '' : this.data.focusDate;
      const focusIdx = fd ? logsDesc.findIndex(l => l.date === fd) : -1;
      const idx = focusIdx >= 0 ? focusIdx : Math.min(this.data.selIdx || 0, logsDesc.length - 1);

      this.setData({ empty: false, logsCount: logsDesc.length });
      this.buildSession(idx);
      this.buildWeeks(logsDesc);
      this.buildKeyActions(logsDesc);
      this.buildRecords(logsDesc);
      this._tryAutoShare();
    },

    // 「完成并生成分享图」的一次性落地：等本场数据就绪后再开，避免 openShareCard 拿到空 _logs。
    // 必须放在 rebuild 之后调用 —— openShareCard 依赖 this._logs[this._selIdx]。
    _tryAutoShare() {
      if (!this._wantShare) return;
      if (!this._logs || !this._logs.length) return;   // 还没 rebuild 完，等下一次调用
      this._wantShare = false;                          // 消费掉，之后切前台不再自动弹
      // 组件很可能刚 attached、首帧尚未渲染完成：推迟一拍，
      // 保证分享弹层与画布节点都已挂载（否则 selectorQuery 查不到 #shareCanvas）。
      const open = () => this.openShareCard();
      if (typeof wx.nextTick === 'function') wx.nextTick(open);
      else setTimeout(open, 0);
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
        const bestTxt = best.topW > 0 ? stats.fmtW(best.topW) + 'kg × ' + best.reps : (best.reps ? '自重 × ' + best.reps : '—');

        const rpes = ss.map(x => stats.num(x.rpe)).filter(v => v > 0 && v <= 10);
        const rmin = rpes.length ? Math.round(Math.min.apply(null, rpes)) : 0;
        const rmax = rpes.length ? Math.round(Math.max.apply(null, rpes)) : 0;
        const rpeTxt = !rpes.length ? '—' : (rmin === rmax ? String(rmin) : rmin + '–' + rmax);
        const avgR = rpes.length ? Math.round(rpes.reduce((s, v) => s + v, 0) / rpes.length * 10) / 10 : 0;

        // vs 上次（同动作同器械的最近更早场次）；用可比容量，自重动作退化为总次数。
        // 判据在 trainingStats.sessionChip —— 与分享卡共用同一份，避免「复盘说 ↑8%、卡片说 ↑9%」
        const chip = stats.sessionChip(a, logs, idx);

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

      // 下次训练建议：基线 = 计划目标 > 历史；纯逻辑在 trainingStats（组件只组装）
      const suggest = stats.nextSessionSuggestion(actions, logs, idx, store.getActivePlan());

      // 「练完之后」的肌群状态回放（B②口径）：now 钉在该场次结束时刻，而不是此刻。
      // ⚠️ 这里**必须**用 afterStateOf 而不是 muscleStatusOf(logs, Date.now())——
      //   本页可以切到任意历史场次，若用「此刻」当基准，用户看 3 天前那场时会
      //   看到之后几天练的肌群混进来（「我昨天练的腿出现在三天前的复盘里」）。
      //   口径全文见 utils/sessionAfter.js 顶部三条。
      const after = sessionAfter.afterStateOf(logs, log);

      this.setData({
        selIdx: idx,
        sessionDate: dateRange.fmtDateSlash(log.date),
        sessionSub: actions.length + ' 动作 · ' + totalSets + ' 组',
        verdict,
        stats: {
          duration: Math.floor(sec / 60) + ':' + dateRange.pad2(sec % 60),
          volume: stats.fmtVol(vol),
          effort: rpe.count ? rpe.avg + '/10' : '—'
        },
        perAction: rows,
        feelings,
        suggest,
        hasSuggest: suggest.length > 0,
        canApply: suggest.some(s => s.actionable),
        // 肌群状态回放（空/ 过旧 / 无基准时不渲染，禁显示占位文案）
        afterChips: after.chips,
        afterSummary: after.summary,
        afterHint: after.hint,
        hasAfter: !after.empty
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
    // 近 6 周训练量（自然周桶，与计划页同一套周口径）。
    // 【已删除】原「本周执行」卡（周完成度环 + 本周训练天数 + 本周平均吃力 + 周目标就地改）：
    //   ① 它回答的是「我按计划练了吗」，而这一页回答的是「我变强了吗」——答非所问；
    //   ② 周目标优先级仍由 trainingStats.weekTargetOf 单源维护（口径不变），等首页进度卡再消费。
    buildWeeks(logsDesc) {
      const now = new Date();

      // 近 6 周「训练量」趋势（自然周桶，W-5 … 本周）。
      // 纵轴用周总容量 = Σ(重量×次数)，自重动作退化为 Σ 次数 —— 单调、有量级差，能读出进步。
      // 【踩过】原纵轴是「周均 RPE」：RPE 无方向性（高不代表进步、低不代表退步），
      // 数值又被压在 6–9，柱高只有 60%–90%，容器 160rpx 下 7.5 与 7.8 只差 4.8rpx
      // —— 六根柱永远等高，等于零信息。故改为训练量。
      const weeks = [];
      for (let w = 5; w >= 0; w--) {
        const wr = dateRange.weekRangeOffset(now, -w);
        let vol = 0; const days = new Set();
        logsDesc.filter(l => dateRange.inRange(l.date, wr.monStr, wr.sunStr)).forEach(l => {
          vol += stats.loadOfLog(l);
          days.add(l.date);
        });
        weeks.push({
          key: 'w' + w,
          label: w === 0 ? '本周' : 'W-' + w,
          vol,
          volTxt: vol > 0 ? stats.fmtVol(vol) : '',
          days: days.size,
          has: vol > 0
        });
      }
      // 以 6 周最大值为 100% 归一化；min-height 保证「有数据但很轻」的周也画得出柱子
      const maxVol = Math.max(1, ...weeks.map(x => x.vol));
      weeks.forEach(x => {
        x.pct = x.has ? Math.max(4, Math.round(x.vol / maxVol * 100)) : 0;
        x.barStyle = x.has ? ('height: ' + x.pct + '%; min-height: 8%;') : '';
      });

      this.setData({ weeks });
    },

    // 关键动作：自动取场次最多的前 3 个动作，展示跨场趋势（免用户挑选）
    // 柱高与 chip 用「可比容量」（重量×次数），foot 仍给可读的「最好一组」。
    // 【踩过】旧实现只画峰值重量 topW：① 重量不变、次数涨了完全看不出来；② 自重动作
    // topW 恒 0 → maxW 兜成 1 → 每根柱都 100%，整块图零信息，且 chip 连涨没涨都不说。故改容量。
    buildKeyActions(logsDesc) {
      const map = {};
      logsDesc.forEach(l => (l.actions || []).forEach(a => {
        const k = stats.actionKey(a);
        if (!map[k]) map[k] = { key: k, name: (a.nameZh || a.name) || '动作', sessions: [] };
        const best = stats.bestSetOf(a);
        map[k].sessions.push({ date: l.date, cap: stats.capacityOfAction(a), topW: best.topW, reps: best.reps });
      }));
      const groups = Object.keys(map).map(k => map[k]);
      groups.forEach(g => g.sessions.sort((a, b) => String(a.date).localeCompare(String(b.date))));
      // 场次多者优先；同场次取更近有记录的 —— 这是「自动前 3」的默认排序
      groups.sort((a, b) => b.sessions.length - a.sessions.length ||
        String(b.sessions[b.sessions.length - 1].date).localeCompare(String(a.sessions[a.sessions.length - 1].date)));

      // 用户自选优先（数组顺序即卡片顺序）；选了但一场都没练过的 key 直接跳过，不产生空卡
      const byKey = {};
      groups.forEach(g => { byKey[g.key] = g; });
      const picks = store.getKeyActionPicks();
      const picked = [];
      picks.forEach(k => { if (byKey[k] && picked.indexOf(byKey[k]) < 0) picked.push(byKey[k]); });
      const shown = picked.length ? picked : groups.slice(0, KA_MAX);

      const keyActions = shown.map(g => {
        const s = g.sessions;
        const last = s[s.length - 1];
        const maxC = Math.max(1, ...s.map(x => x.cap));
        const bars = s.slice(-8).map((x, i, arr) => ({
          key: x.date,
          style: 'height: ' + Math.max(4, Math.round(x.cap / maxC * 100)) + '%;',
          hot: i === arr.length - 1
        }));
        const fmtOne = (x) => x.topW > 0 ? stats.fmtW(x.topW) + 'kg×' + x.reps : '自重×' + x.reps;

        // chip 用容量：与「本次训练」tab 的「比上次 ↑x%」同口径 —— 全 App 对「进步」只有一个定义
        let chip;
        if (s.length >= 2 && s[0].cap > 0) {
          const pct = Math.round((last.cap - s[0].cap) / s[0].cap * 100);
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
          firstCap: s[0].cap > 0 ? stats.fmtVol(s[0].cap) : '0',
          lastCap: last.cap > 0 ? stats.fmtVol(last.cap) : '0',
          firstDate: String(s[0].date).slice(5).replace('-', '/'),
          lastDate: String(last.date).slice(5).replace('-', '/'),
          bars
        };
      });

      // 弹层候选：只列真练过的动作（按场次降序），checked 反映当前生效的那几张卡
      const shownKeys = {};
      shown.forEach(g => { shownKeys[g.key] = 1; });
      const pickOptions = groups.map(g => {
        const last = g.sessions[g.sessions.length - 1];
        return {
          key: g.key,
          name: g.name,
          count: g.sessions.length,
          metaTxt: g.sessions.length + ' 场 · 最近 ' + String(last.date).slice(5).replace('-', '/'),
          checked: !!shownKeys[g.key]
        };
      });

      this.setData({
        keyActions,
        pickOptions,
        kaCustom: picked.length > 0,            // 自选生效（选了但全无历史 → 回落自动，不标自定义）
        kaPickedCount: shown.length,
        kaMax: KA_MAX,
        trendReady: logsDesc.length >= TREND_MIN_LOGS,
        trendNeed: Math.max(0, TREND_MIN_LOGS - logsDesc.length)
      });
    },

    // 个人纪录：每个动作历史最高「单组容量」（重量×次数；自重退化为次数）。
    // 只回答一句话——我最近破纪录了吗？这是「进步趋势」最该先说的结论（原来完全缺失）。
    // 只保留练过 ≥2 场的动作：只练过一次谈不上「破纪录」。
    buildRecords(logsDesc) {
      // 口径在 trainingStats.buildRecords（单源）—— 本方法只负责把结果塞进 data。
      // 分享卡要靠同一份排行判断「本场是否破纪录」，两处各算一遍必然对不上。
      const r = stats.buildRecords(logsDesc);
      this.setData({ records: r.records, recordsSummary: r.recordsSummary });
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

    /* ===== 关键动作：自动前 3 + 可切换 ===== */
    // 自定义 tabBar 是框架级固定层（app.json tabBar.custom=true，组件内 z-index:1000），
    // 页面里的弹层压不住它 —— 抽屉底部必须自己空出 88rpx 才不会挡住按钮。
    // 本组件同时挂在 tab 页（数据）与普通页（复盘），所以打开弹层时运行时探测一次。
    _hasTabBar() {
      try {
        if (typeof getCurrentPages !== 'function') return false;
        const ps = getCurrentPages();
        const cur = (ps && ps.length) ? ps[ps.length - 1] : null;
        return !!(cur && typeof cur.getTabBar === 'function' && cur.getTabBar());
      } catch (e) {
        return false;                       // 探测失败按普通页处理（不预留，最坏只是少留白）
      }
    },
    // 打开弹层时从「已落库的选择」重建勾选态 —— 上次取消掉的勾选不会残留
    openKaSheet() {
      this._rebuildKeyActions();
      this.setData({ kaSheet: true, kaTabSafe: this._hasTabBar() });
    },
    closeKaSheet() {
      this.setData({ kaSheet: false });
    },
    // 弹层内空白区吞掉 tap，避免穿透到遮罩把自己关掉
    noop() {},
    // 勾选即改内存态，点「完成」才落库（避免误触就改掉配置）
    toggleKaPick(e) {
      const k = e.currentTarget.dataset.key;
      const opts = (this.data.pickOptions || []).map(o => ({
        key: o.key, name: o.name, count: o.count, metaTxt: o.metaTxt, checked: o.checked
      }));
      const hit = opts.filter(o => o.key === k)[0];
      if (!hit) return;
      if (!hit.checked && opts.filter(o => o.checked).length >= KA_MAX) {
        wx.showToast({ title: '最多选 ' + KA_MAX + ' 个', icon: 'none' });
        return;
      }
      hit.checked = !hit.checked;
      this.setData({ pickOptions: opts, kaPickedCount: opts.filter(o => o.checked).length });
    },
    // 一个都没勾 = 存空数组 = 回到「自动前 3」，不需要单独的「重置」按钮
    saveKaPicks() {
      const keys = (this.data.pickOptions || []).filter(o => o.checked).map(o => o.key);
      store.setKeyActionPicks(keys);
      this._rebuildKeyActions();
      this.setData({ kaSheet: false });
      wx.showToast({ title: keys.length ? '已更新关键动作' : '已恢复自动推荐', icon: 'none' });
    },
    resetKaPicks() {
      store.setKeyActionPicks([]);
      this._rebuildKeyActions();
      this.setData({ kaSheet: false });
      wx.showToast({ title: '已恢复自动推荐', icon: 'none' });
    },
    _rebuildKeyActions() {
      if (this._logs && this._logs.length) this.buildKeyActions(this._logs);
    },

    /* ===== 下次训练建议：编辑 + 一键回填计划 ===== */
    // 只改 data.suggest[i].draft*，避免整表 setData
    _setSug(key, field, val) {
      const i = (this.data.suggest || []).findIndex(s => s.key === key);
      if (i < 0) return;
      const patch = {};
      patch['suggest[' + i + '].' + field] = val;
      this.setData(patch);
    },
    onSugW(e) { this._setSug(e.currentTarget.dataset.key, 'draftW', e.detail.value); },
    onSugReps(e) { this._setSug(e.currentTarget.dataset.key, 'draftReps', e.detail.value); },
    // onSugSets 已删除：建议行只渲染「重量 × 次数」两个输入框，没有「组数」输入框，
    // 所以 draftSets 从未被初始化 → 下面的 setsCount 分支永远不可达（NaN > 0 恒假）。
    // 与「自重只 +1 次数、不动组数」的口径一致，故连分支一起删掉，不留悬空写入口。

    // 一键把建议回填到当前计划：仅更新「匹配到的」动作，且绝不改动激活指针（不调用 setActivePlan）
    applySuggestions() {
      const rows = (this.data.suggest || []).filter(r => r.actionable);
      if (!rows.length) { wx.showToast({ title: '暂无可应用的调整', icon: 'none' }); return; }
      const plan = store.getActivePlan();
      if (!plan) {
        wx.showModal({
          title: '暂无今日计划',
          content: '请先在计划页创建或导入一个包含这些动作的计划，再回来应用建议。',
          showCancel: false, confirmText: '知道了'
        });
        return;
      }
      const nextActions = (plan.actions || []).map(pa => {
        const r = rows.find(x =>
          (x.planActionId && pa.actionId && x.planActionId === pa.actionId) ||
          ((pa.nameZh || pa.name) === x.name));
        if (!r) return pa;
        const patch = {};
        if (r.hasW) {
          const w = parseFloat(r.draftW);
          if (isFinite(w) && w > 0) patch.weight = String(w);
          // 计划 reps 是区间文案（如 '8-12'）时不回写次数，避免破坏区间语义
          const reps = parseInt(r.draftReps, 10);
          if (reps > 0 && stats.singleIntOf(pa.reps) > 0) patch.reps = String(reps);
        } else {
          const reps = parseInt(r.draftReps, 10);
          if (reps > 0) patch.reps = String(reps);
        }
        return Object.assign({}, pa, patch);
      });
      store.updatePlan(plan.id, { actions: nextActions });
      wx.showToast({ title: rows.every(r => r.deload) ? '已按减载更新计划' : '已更新计划', icon: 'success' });
      this.rebuild();
    },

    /* ===== 分享卡（B2）=====
       流程：点入口 → 开弹层 → 视口外画布绘制 → 导出临时图 → 摘掉画布、只留图片。
       三个开关都会**重建内容模型并重新出图**（不是只改个本地布尔值）：
         · 隐藏训练内容 → buildModel(opt.hideContent) 不出动作明细卡；
         · 合并当天     → buildModel(opt.merge) 把同日多场合成一张；
         · 样式         → buildModel(opt.style) 换调色板（浅色 / 深色）。
       平台能力：wx.showShareImageMenu 需基础库 ≥ 2.14.3。低版本**不假装能分享**。
       分享通道只有两条，且是**两种不同能力**：① 分享给朋友（转发面板里可再选朋友圈）
       ② 保存到相册。**没有**独立的「朋友圈」通道 —— 微信没有「一键发朋友圈」的开放接口，
       而转发面板本身就能发朋友圈，再单开一个入口只会让用户以为是两件事。
       文案与行为一致是红线：只写实现得了的事。 */
    openShareCard() {
      const log = (this._logs || [])[this._selIdx];
      if (!log) { wx.showToast({ title: '暂无可分享的场次', icon: 'none' }); return; }
      // scTabSafe 在**每次打开时**探测：同一组件既挂在「数据」tab（有自定义 tabBar，
      // 是框架级固定层、页面弹层压不住）也挂在复盘页（没有），不能写死在 data 里。
      this.setData({ shareShow: true, scTabSafe: this._hasTabBar() }, () => this._applyCard());
    },

    // 按当前开关重建模型并重新出图。每次都先把 shareImg 清空：
    // 画布由 wx:if="{{!shareImg}}" 控制挂载，不清掉旧图就取不到 canvas 节点（查询会返回 null）。
    _applyCard() {
      const log = (this._logs || [])[this._selIdx];
      const model = log
        ? shareCard.buildModel({ log: log, logsDesc: this._logs, idx: this._selIdx, opts: this._cardOpts() })
        : null;
      if (!model) { this._cardFail('暂无可分享的场次'); return; }
      this._cardModel = model;
      this.setData({ shareBusy: true, shareImg: '' }, () => this._renderCard(model));
    },

    _cardOpts() {
      const g = store.get();
      const u = (g && g.userInfo) || {};
      return {
        style: this.data.shareStyle,
        merge: !!this.data.shareMerge,
        hideContent: !!this.data.shareHide,
        nickname: u.nickname || ''
      };
    },

    toggleShareOpt(e) {
      const k = e.currentTarget.dataset.k;
      if (k === 'hide') this.setData({ shareHide: !this.data.shareHide }, () => this._applyCard());
      else if (k === 'merge') this.setData({ shareMerge: !this.data.shareMerge }, () => this._applyCard());
    },

    // 循环切换样式：样式键的唯一真源是 shareCard.STYLE_KEYS，这里不写死「浅色↔深色」
    cycleShareStyle() {
      const keys = shareCard.STYLE_KEYS;
      const i = keys.indexOf(this.data.shareStyle);
      const next = keys[(i + 1) % keys.length];
      this.setData({ shareStyle: next, shareStyleName: shareCard.PALETTES[next].name }, () => this._applyCard());
    },

    // 画布 backing store 固定为 750×measure()，**不乘 dpr**：
    // 出图尺寸跨设备完全一致，也不会因高清屏导出 2000px+ 的巨图被聊天二次压缩。
    _renderCard(model) {
      const q = wx.createSelectorQuery().in(this);
      q.select('#shareCanvas').fields({ node: true, size: true }).exec(res => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) { this._cardFail('画布初始化失败，请重试'); return; }
        try {
          const ctx = canvas.getContext('2d');
          canvas.width = shareCard.CARD_W;
          canvas.height = shareCard.measure(model);
          shareCard.draw(ctx, model);
        } catch (e) {
          this._cardFail('生成分享卡失败，请重试');
          return;
        }
        wx.canvasToTempFilePath({
          canvas,
          success: r => this.setData({ shareBusy: false, shareImg: r.tempFilePath }),
          fail: () => this._cardFail('导出图片失败，请重试')
        }, this);
      });
    },

    _cardFail(msg) {
      this.setData({ shareShow: false, shareBusy: false, shareImg: '' });
      wx.showToast({ title: msg, icon: 'none' });
    },

    closeShare() { this.setData({ shareShow: false, shareBusy: false, shareImg: '' }); },

    shareShareCard() {
      const path = this.data.shareImg;
      if (!path) { wx.showToast({ title: '分享卡还没生成好', icon: 'none' }); return; }
      if (typeof wx.showShareImageMenu !== 'function') {
        // 低版本微信没有这个接口 —— 给出真实可行的替代路径，而不是一句「分享失败」
        wx.showModal({
          title: '当前微信版本不支持直接分享图片',
          content: '可以先把卡片保存到相册，再在聊天里手动发给好友。',
          confirmText: '保存到相册', cancelText: '取消',
          success: r => { if (r.confirm) this.saveShareCard(); }
        });
        return;
      }
      wx.showShareImageMenu({
        path,
        needShowEntrance: true,   // 图片消息带小程序入口（<3.2.0 的基础库会忽略该参数）
        fail: e => {
          // 用户自己关掉分享面板不算失败，别弹提示打扰
          if (/cancel/i.test(String((e && e.errMsg) || ''))) return;
          wx.showToast({ title: '分享未完成，可试试保存到相册', icon: 'none' });
        }
      });
    },

    // 曾经这里还有一条「存相册发朋友圈」：微信**没有**「一键发朋友圈」的开放接口
    //（唯一相关的 onShareTimeline 是单页模式分享，交互密集页加它就是残废入口，本项目刻意不加），
    // 所以早期做法是「存到相册 + 弹一句引导」。但它的实现与上面的 saveShareCard **逐行相同**，
    // 区别只有一句 modal 文案；而 wx.showShareImageMenu 的转发面板里本来就能直接选「朋友圈」。
    // 同一个能力开两个入口 = 用户以为它们是两件事，真机确认后整条通道删除。
    saveShareCard() {
      const path = this.data.shareImg;
      if (!path) { wx.showToast({ title: '分享卡还没生成好', icon: 'none' }); return; }
      this._saveToAlbum(path, () => wx.showToast({ title: '已保存到相册', icon: 'success' }));
    },

    // 保存到相册（「保存到相册」按钮 + 分享接口缺失时的降级路径共用）：
    // 失败路径必须分清「用户取消」与「权限被拒」—— 后者重试无用，只能引导去设置页。
    _saveToAlbum(path, onOk) {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => onOk(),
        fail: e => {
          const msg = String((e && e.errMsg) || '');
          if (/cancel/i.test(msg)) return;
          if (/auth|deny|permission/i.test(msg)) {
            wx.showModal({
              title: '需要相册权限',
              content: '保存图片需要「保存到相册」权限，去设置里打开即可。',
              confirmText: '去设置',
              success: r => { if (r.confirm) wx.openSetting({}); }
            });
            return;
          }
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      });
    }
  }
});

// pages/home/home.js —— 对齐 01-home.html（HiLiLife 设计系统）
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');
const media = require('../../utils/media.js');
const nutrition = require('../../utils/nutrition.js');
const todayPlan = require('../../utils/todayPlan.js');
const dateRange = require('../../utils/dateRange.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
// 首页背景图：本地 static/ 随包发布（即时显示，无网络往返）；加载异常时 onBgError 回退云端 cloud://
const BG_LOCAL = '/static/home-bg.jpg';
const BG_LOCAL_DARK = '/static/home-bg-dark.jpg';
const BG_CLOUD_REL = 'images/home-bg.jpg';
const BG_CLOUD_REL_DARK = 'images/home-bg-dark.jpg';
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function todayStr() {
  const d = new Date();
  return fmtDate(d);
}
// 时间戳是否落在今天（用于饮食打卡判断）
function isToday(ts) {
  const d = new Date(ts);
  return fmtDate(d) === todayStr();
}

// 连续打卡天数：从今天往前数连续活跃（训练/体重/饮食任一）的天数。
// 回溯逻辑已收敛到 utils/dateRange.streakFromDates（「我的」页连续训练天数同源），
// 这里只负责喂进「活跃日期集合」——口径差异留在调用方，算法不再各写一份。

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 主题」开关控制，onShow 时同步
    theme: 'theme-light',
    greeting: '你好',
    nickname: '健身用户',
    sub: '',
    // 背景图：人物铺满顶部（本地 static/ 随包发布，秒开；异常时 onBgError 回退云端）
    // 随主题切换：浅色用原人物图，深色用哑铃人物深底图（onShow 里按主题重算）
    bgUrl: BG_LOCAL,
    // 状态栏占位高度（自定义导航栏后手动注入）
    statusBarStyle: 'height: 0px',
    checkin: { done: 0, total: 3, pct: 0 },
    fitnessDays: 0,
    streak: 0,
    suggest: { title: '全身训练 · 中级', sub: '预计 45 分钟 · 320 kcal' },
    diet: {
      intake: 0, target: 2100, pct: 0,
      protein: { now: 0, goal: 140 },
      carb: { now: 0, goal: 220 },
      fat: { now: 0, goal: 70 }
    },
    weight: { current: '--', delta: '0.0', down: true },
    // 饮食进度条宽度（注意：wxml 行内 style 禁 Mustache，width 通过完整 style 字符串注入）
    fillStyle: 'width: 0%',
    // 三营养素进度条宽度（蛋白质/碳水/脂肪，同样用完整 style 字符串注入）
    proteinBarStyle: 'width: 0%',
    carbBarStyle: 'width: 0%',
    fatBarStyle: 'width: 0%'
  },

  onShow() {
    // 主题：先同步自身（可能刚在「我的」页切换），再同步隔离组件 custom-tab-bar
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });

    // 首页背景随主题切换：本地优先（static/），并记下云端地址供 onBgError 兜底
    this._bgCloud = media.media(themeCls === 'theme-dark' ? BG_CLOUD_REL_DARK : BG_CLOUD_REL);
    this._bgFallbackUsed = false;
    this.setData({ bgUrl: themeCls === 'theme-dark' ? BG_LOCAL_DARK : BG_LOCAL });

    // 自定义导航栏：手动补状态栏高度占位 + 切换状态栏文字/背景色
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const sbh = info.statusBarHeight || 20;
    this.setData({ statusBarStyle: 'height: ' + sbh + 'px' });
    wx.setNavigationBarColor({
      frontColor: themeCls === 'theme-dark' ? '#ffffff' : '#000000',
      backgroundColor: themeCls === 'theme-dark' ? '#0A0A0A' : '#F7F7F5'
    });

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, theme: themeCls });
    }
    this.refresh();
  },

  // 背景图加载失败兜底：本地 static/ 异常时回退云端 cloud://（每次进入只兜底一次，防循环）
  onBgError() {
    if (this._bgFallbackUsed || !this._bgCloud) return;
    this._bgFallbackUsed = true;
    this.setData({ bgUrl: this._bgCloud });
  },

  refresh() {
    const g = store.get();
    const today = todayStr();

    // —— 今日三项打卡（体重 / 训练 / 饮食） ——
    const weightDone = g.weightRecords.some(r => r.date === today);
    const trainingDone = g.trainingLogs.some(l => l.date === today);
    const dietDone = g.meals.some(m => isToday(m.time));
    let done = 0;
    if (weightDone) done++;
    if (trainingDone) done++;
    if (dietDone) done++;
    const total = 3;
    const pct = Math.round((done / total) * 100);

    // —— 问候 / 昵称 / 副标题 ——
    const now = new Date();
    const h = now.getHours();
    const greeting = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const nickname = (g.userInfo && g.userInfo.nickname) || '健身用户';
    const sub = done < total ? '今天也要加油完成训练！' : '今日目标已全部完成！';

    // —— 活跃日期集合（连续打卡 / 健身天数） ——
    const activeSet = new Set();
    g.trainingLogs.forEach(l => activeSet.add(l.date));
    g.weightRecords.forEach(r => activeSet.add(r.date));
    g.meals.forEach(m => activeSet.add(fmtDate(new Date(m.time))));
    const streak = dateRange.streakFromDates(activeSet);
    const fitnessDays = g.profile.fitnessDays || 0;

    // —— 今日饮食（真实数据） ——
    const todays = g.meals.filter(m => isToday(m.time));
    let intake = 0, pNow = 0, cNow = 0, fNow = 0;
    todays.forEach(m => {
      intake += (m.calories || 0);
      pNow += (m.protein || 0);
      cNow += (m.carb || 0);
      fNow += (m.fat || 0);
    });
    // 目标热量与宏量随身体数据/目标实时计算；手动覆盖优先（与 advice 页同一真源）
    const prof = g.profile || {};
    const rec = nutrition.recommendIntake(prof);
    const overrideNum = (prof.intakeOverride != null) ? Number(prof.intakeOverride) : null;
    const dietTarget = (overrideNum != null && isFinite(overrideNum) && overrideNum > 0) ? overrideNum : rec.kcal;
    const macroGoal = nutrition.recommendMacros({ kcal: dietTarget, goal: nutrition.normalizeGoal(prof.goal) || '减脂', weight: prof.currentWeight });
    const dietPct = intake > 0 ? Math.min(100, Math.round((intake / dietTarget) * 100)) : 0;
    // 三营养素目标（g）与进度条宽度百分比（对齐 .card diet 右侧三色小进度条）
    const pGoal = macroGoal.p, cGoal = macroGoal.c, fGoal = macroGoal.f;
    const pPct = pNow > 0 ? Math.min(100, Math.round((pNow / pGoal) * 100)) : 0;
    const cPct = cNow > 0 ? Math.min(100, Math.round((cNow / cGoal) * 100)) : 0;
    const fPct = fNow > 0 ? Math.min(100, Math.round((fNow / fGoal) * 100)) : 0;

    // —— 体重趋势（最新 + 涨跌 + sparkline 数据） ——
    const wlist = g.weightRecords || [];
    let wCurrent = '--', wDelta = '0.0', wDown = true;
    if (wlist.length) {
      const last = wlist[wlist.length - 1];
      wCurrent = (Math.round(last.weight * 10) / 10).toFixed(1);
      if (wlist.length >= 2) {
        const prev = wlist[wlist.length - 2].weight;
        const d = Math.round((last.weight - prev) * 10) / 10;
        wDelta = (d > 0 ? '+' : '') + d.toFixed(1);
        wDown = d < 0;
      }
    }
    this._sparkData = wlist.slice(-8).map(r => r.weight);

    // —— 今日推荐 = 今日训练计划：口径的唯一真源在 utils/todayPlan.js（与「我的」页首行共用）。
    //    以 active 计划为准（「导入今日训练」写入 activePlanId，换计划必变）；
    //    selectedActions 会被跨天重置清空，仅作无计划时的兜底数据源 —— 这些规则都收在 util 里。
    const suggest = todayPlan.resolveTodayPlan();

    this.setData({
      greeting, nickname, sub,
      checkin: { done, total, pct },
      fitnessDays, streak,
      diet: {
        intake: Math.round(intake),
        target: dietTarget,
        pct: dietPct,
        protein: { now: Math.round(pNow), goal: pGoal },
        carb: { now: Math.round(cNow), goal: cGoal },
        fat: { now: Math.round(fNow), goal: fGoal }
      },
      weight: { current: wCurrent, delta: wDelta, down: wDown },
      suggest,
      fillStyle: 'width: ' + dietPct + '%',
      proteinBarStyle: 'width: ' + pPct + '%',
      carbBarStyle: 'width: ' + cPct + '%',
      fatBarStyle: 'width: ' + fPct + '%'
    }, () => {
      // setData 完成后绘制折线图（canvas 节点已就绪）
      wx.nextTick(() => this.drawSpark());
    });
  },

  // 用 canvas 2d 绘制体重趋势折线图（对齐 01-home.html：荧光绿线 + 渐变填充 + 末点）
  drawSpark() {
    const weights = this._sparkData || [];
    if (!weights || weights.length < 2) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('#weightSpark').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const width = res[0].width;
      const height = res[0].height;
      if (!width || !height) return;
      const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 2;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const W = width, H = height;
      ctx.clearRect(0, 0, W, H);

      const min = Math.min.apply(null, weights);
      const max = Math.max.apply(null, weights);
      const range = (max - min) || 1;
      const n = weights.length;
      const pt = i => ({
        x: 5 + i * ((W - 10) / (n - 1)),
        y: H - 6 - ((weights[i] - min) / range) * (H - 18)
      });
      const pts = weights.map((_, i) => pt(i));

      // area fill
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(200,255,0,0.35)');
      grad.addColorStop(1, 'rgba(200,255,0,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[n - 1].x, H);
      ctx.lineTo(pts[0].x, H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // line
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = '#C8FF00';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // active point
      const lp = pts[n - 1];
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#C8FF00';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0A0A0A';
      ctx.stroke();
    });
  },

  // 开始训练：有活跃计划 → 直接进入训练中页（动作由 workout 页从 activePlan 解析，
  // 不再注入 selectedActions，避免污染训练页「已选动作」）；
  // 无计划但有手动已选动作 → 同样直进训练中页；都没有 → 去计划页导入。
  // 「有没有安排」直接问 todayPlan，避免这里再写一遍计划/手动两分支（口径会漂）。
  startPlan() {
    if (!auth.requireLogin()) return;
    if (todayPlan.resolveTodayPlan().hasPlan) { wx.navigateTo({ url: '/pages/workout/workout' }); return; }
    this.goPlan();
  },

  goWeight() { if (!auth.requireLogin()) return; wx.navigateTo({ url: '/pages/weight-record/weight-record?from=home' }); },
  goDiet() { wx.navigateTo({ url: '/pages/advice/advice' }); },
  // 计划页是 tabBar 页：navigateTo 打不开它（会静默失败，用户观感是「点了没反应」）→ 必须 switchTab
  goPlan() { if (!auth.requireLogin()) return; wx.switchTab({ url: '/pages/plan/plan' }); },
  // 添加饮食：进入拍照识别/搜索页（food-scan 三入口：条码/名称/拍照）
  addMeal() { if (!auth.requireLogin()) return; wx.navigateTo({ url: '/pages/food-scan/food-scan' }); }
});

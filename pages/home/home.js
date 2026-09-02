// pages/home/home.js —— 对齐 01-home.html（HiLiLife 设计系统）
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
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

// 连续打卡天数：从今天往前数连续活跃（训练/体重/饮食任一）的天数
function computeStreak(activeSet) {
  let streak = 0;
  const d = new Date(todayStr() + 'T00:00:00');
  while (activeSet.has(fmtDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 主题」开关控制，onShow 时同步
    theme: 'theme-light',
    greeting: '你好',
    nickname: '健身用户',
    sub: '',
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
    fillStyle: 'width: 0%'
  },

  onShow() {
    // 主题：先同步自身（可能刚在「我的」页切换），再同步隔离组件 custom-tab-bar
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, theme: themeCls });
    }
    this.refresh();
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
    const streak = computeStreak(activeSet);
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
    const dietTarget = 2100;
    const dietPct = intake > 0 ? Math.min(100, Math.round((intake / dietTarget) * 100)) : 0;

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

    this.setData({
      greeting, nickname, sub,
      checkin: { done, total, pct },
      fitnessDays, streak,
      diet: {
        intake: Math.round(intake),
        target: dietTarget,
        pct: dietPct,
        protein: { now: Math.round(pNow), goal: 140 },
        carb: { now: Math.round(cNow), goal: 220 },
        fat: { now: Math.round(fNow), goal: 70 }
      },
      weight: { current: wCurrent, delta: wDelta, down: wDown },
      fillStyle: 'width: ' + dietPct + '%'
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

  // 开始训练计划：注入「本次训练」并进入训练页（无计划则跳计划管理）
  startPlan() {
    if (!auth.requireLogin()) return;
    const plan = store.getActivePlan();
    if (!plan) {
      wx.navigateTo({ url: '/pages/plan/plan' });
      return;
    }
    store.applyPlanToSelected(plan);
    wx.switchTab({ url: '/pages/training/training' });
  },

  goWeight() { if (!auth.requireLogin()) return; wx.navigateTo({ url: '/pages/weight-record/weight-record?from=home' }); },
  goDiet() { wx.navigateTo({ url: '/pages/advice/advice' }); }
});

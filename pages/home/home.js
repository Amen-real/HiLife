// pages/home/home.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const mock = require('../../utils/mock.js');
const { media, thumb } = require('../../utils/media.js');
const categoryEmoji = mock.categoryEmoji;

function todayStr() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function monthPrefix() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1);
}
// 时间戳是否落在今天（用于饮食打卡判断）
function isToday(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' + n : n);
  const s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return s === todayStr();
}

// 秒 -> 友好文案（例：90 -> "1分30秒"，45 -> "45s"）
function fmtSec(sec) {
  sec = Number(sec) || 0;
  if (!sec) return '0s';
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return s2 ? (m + '分' + s2 + '秒') : (m + '分');
}

Page({
  data: {
    slogan: '每一次训练，都算数',
    checkins: { weight: false, train: false, diet: false, done: 0, total: 3, pct: 0 },
    greeting: '你好',
    nickname: '训练者',
    dateLine: '',
    statusTip: '',
    calendar: { month: 0, total: 0 },
    recentLogs: [],
    calExpanded: false,
    calYear: 0,
    calMonth: 0,
    calTitle: '',
    calCells: [],
    weekCells: [],
    calSelected: '',
    calDetail: null,
    // 今日训练计划：取当前计划 + 今日完成进度
    planInfo: { has: false, name: '', actions: [], total: 0, done: 0, finishedToday: false },
    // 首页底部「今日训练计划」动作卡片数据（对齐参考 .plan-item 样式）
    todayPlan: { has: false, name: '', emoji: '🏋️', total: 0, done: 0, minutes: 0, actions: [] }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.refresh();
  },

  onHide() {
    if (this.data.calExpanded) this.setData({ calExpanded: false, calDetail: null });
  },

  refresh() {
    const g = store.get();
    const today = todayStr();

    const weightDone = g.weightRecords.some(r => r.date === today);
    const trainingDone = g.trainingLogs.some(l => l.date === today);
    const dietDone = g.meals.some(m => isToday(m.time));
    let done = 0;
    if (weightDone) done++;
    if (trainingDone) done++;
    if (dietDone) done++;

    const mp = monthPrefix();
    const trainDates = g.trainingLogs.map(l => l.date);
    const weightDates = g.weightRecords.map(r => r.date);
    const allDates = Array.from(new Set(trainDates.concat(weightDates)));
    const monthDays = allDates.filter(d => d.indexOf(mp) === 0).length;

    // 本周一~周日迷你日历（对齐参考样式：今日绿底、记录日珊瑚点）
    const wdLabels = ['一', '二', '三', '四', '五', '六', '日'];
    const now0 = new Date();
    const curDow = now0.getDay(); // 0=周日
    const monOff = curDow === 0 ? -6 : -(curDow - 1);
    const mon = new Date(now0.getFullYear(), now0.getMonth(), now0.getDate() + monOff);
    const pad2 = n => (n < 10 ? '0' + n : '' + n);
    const tSet = new Set(g.trainingLogs.map(l => l.date));
    const weekCells = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      const ds = dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate());
      weekCells.push({ wd: wdLabels[i], day: dd.getDate(), dateStr: ds, isToday: ds === today, hasRecord: tSet.has(ds) });
    }

    const recent = g.trainingLogs.slice(0, 5).map(l => ({
      date: l.date,
      count: (l.actions || []).length
    }));

    const pct = Math.round((done / 3) * 100);

    // 今日训练计划：取当前计划，并比对今天全部训练场次算「今日进度」
    // 注意：同一天可能有多场训练（如"再练一次"），需聚合所有场次的动作名，不能只看第一场
    let planInfo = { has: false, name: '', actions: [], total: 0, done: 0, finishedToday: false };
    let todayPlan = { has: false, name: '', emoji: '🏋️', total: 0, done: 0, minutes: 0, actions: [] };
    const active = store.getActivePlan();
    if (active && active.actions && active.actions.length) {
      const todayLogs = g.trainingLogs.filter(l => l.date === today);
      const doneNames = new Set();
      todayLogs.forEach(l => (l.actions || []).forEach(a => doneNames.add(a.name)));
      // 构造首页「今日训练计划」动作卡片（对齐参考 .plan-item：缩略图 + 名称 + 元信息 + 进度条 + 状态标签）
      const actCards = active.actions.map(pa => {
        // 计划动作只存了 actionId/名称/部位/组数等，没有 image/emoji —— 必须回查原始动作库补全
        const src = store.planActionToTrain(pa); // 内置库 / 自建动作优先查找，返回含 image/emoji 的完整动作
        const name = pa.nameZh || pa.name;
        const emoji = src.emoji || categoryEmoji[pa.part || pa.category] || '🏋️';
        const metaParts = [];
        if (pa.setsCount) metaParts.push(pa.setsCount + ' 组');
        if (pa.reps != null && pa.reps !== '') metaParts.push(pa.reps + ' 次');
        if (pa.weight != null && pa.weight !== '') metaParts.push(pa.weight + 'kg');
        const isDone = doneNames.has(name);
        // 左侧缩略图接入 CDN（Cloudflare R2）：/images/<id>.jpg → upscaled/ 高清版（thumb 当前返回原图，缩略待后续开启 Image Resizing）
        const img = thumb(src.image, 200, 200);
        return {
          ...pa,
          id: pa.actionId,
          name, emoji, img,
          image: src.image, // 回查出的相对路径，供详情页 media() 拼 CDN 大图（否则详情页退化为 emoji）
          video: media(src.video || ''),
          // 缩略图优先用 GIF 动图（src.video 相对路径），无则回退静态图
          thumb: (src.video || src.image) ? media(src.video || src.image) : '',
          meta: metaParts.join(' · '),
          done: isDone,
          pct: isDone ? 100 : 0,
          pctWidth: (isDone ? 100 : 0) + '%',
          tag: isDone ? '已练' : '未练'
        };
      });
      const done = actCards.filter(a => a.done).length;
      planInfo = {
        has: true,
        name: active.name,
        actions: actCards,
        total: actCards.length,
        done: done,
        finishedToday: done >= actCards.length,
        minutes: Math.max(10, actCards.length * 4),
        emoji: '🏋️'
      };
      todayPlan = {
        has: true,
        name: active.name,
        emoji: categoryEmoji[active.category] || '🏋️',
        total: actCards.length,
        done: done,
        minutes: Math.max(10, actCards.length * 4),
        actions: actCards
      };
    }

    // 预览同款：问候语 / 昵称 / 日期行（今日计划 X 项）
    const now = new Date();
    const h = now.getHours();
    const greeting = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const nickname = (g.userInfo && g.userInfo.nickname) || '训练者';
    const wkName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    const dateLine = wkName + ' · ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 · 今日计划 ' + (planInfo.total || 3) + ' 项';

    // 今日三项待打卡提示
    const statusTip = done < 3 ? ('还差 ' + (3 - done) + ' 项待打卡') : '今日三项全部完成 🎉';

    this.setData({
      checkins: { weight: weightDone, train: trainingDone, diet: dietDone, done, total: 3, pct },
      checkPctWidth: pct + '%',
      greeting,
      nickname,
      dateLine,
      statusTip,
      calendar: { month: monthDays, total: allDates.length },
      recentLogs: recent,
      weekCells: weekCells,
      planInfo: planInfo,
      todayPlan: todayPlan
    });
  },

  // 开始训练计划：把当前计划注入「本次训练」并进入训练页（无计划则跳管理页）
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

  goPlan() { wx.navigateTo({ url: '/pages/plan/plan' }); },

  // 缩略图加载失败回退链：GIF 失败 → 静态图；静态图也失败 → 隐藏并显示 emoji
  onPlanThumbError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const actions = this.data.todayPlan.actions.map(a => {
      if (a.id !== id) return a;
      const next = Object.assign({}, a);
      if (next.video && next.thumb === next.video && next.img) {
        next.thumb = next.img; // 动图失败 → 回退静态图
      } else {
        next.thumbFail = true; // 静态图也失败 → 隐藏，显示 emoji
      }
      return next;
    });
    this.setData({ 'todayPlan.actions': actions });
  },

  openCamera() {
    if (!auth.requireLogin()) return;
    // 跳转食物识别页：拍照 / 选图 → 多模态大模型识别宏量营养素
    wx.navigateTo({ url: '/pages/food-vision/food-vision' });
  },

  goSettings() { wx.switchTab({ url: '/pages/profile/profile' }); },
  goList() { wx.switchTab({ url: '/pages/list/list' }); },

  toggleCalendar() {
    const open = !this.data.calExpanded;
    if (open) {
      const now = new Date();
      this.setData({
        calYear: now.getFullYear(),
        calMonth: now.getMonth(),
        calSelected: todayStr(),
        calDetail: null,
        calExpanded: true
      }, () => this.buildCalendar());
    } else {
      this.setData({ calExpanded: false, calDetail: null });
    }
  },

  // 构建月历网格：含训练记录的日期标亮，今日与选中态区分
  buildCalendar() {
    const y = this.data.calYear;
    const m = this.data.calMonth; // 0-based
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const g = store.get();
    const recordSet = new Set(g.trainingLogs.map(l => l.date));
    const today = todayStr();
    const first = new Date(y, m, 1).getDay();           // 0=周日
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push({ empty: true });
    for (let d = 1; d <= days; d++) {
      const ds = y + '-' + pad(m + 1) + '-' + pad(d);
      cells.push({
        empty: false,
        day: d,
        dateStr: ds,
        hasRecord: recordSet.has(ds),
        isToday: ds === today,
        isSelected: ds === this.data.calSelected
      });
    }
    while (cells.length % 7 !== 0) cells.push({ empty: true });
    this.setData({ calCells: cells, calTitle: y + '年' + (m + 1) + '月' });
  },

  prevMonth() {
    let y = this.data.calYear, m = this.data.calMonth;
    if (m === 0) { y--; m = 11; } else { m--; }
    this.setData({ calYear: y, calMonth: m }, () => this.buildCalendar());
  },
  nextMonth() {
    let y = this.data.calYear, m = this.data.calMonth;
    if (m === 11) { y++; m = 0; } else { m++; }
    this.setData({ calYear: y, calMonth: m }, () => this.buildCalendar());
  },

  // 选择日期：有记录→在弹窗内联展示当日训练详情（零跳转，避免页面切换延迟）；无记录→提示
  onSelectDate(e) {
    const ds = e.currentTarget.dataset.date;
    if (!ds) return; // 空白格
    const has = store.get().trainingLogs.some(l => l.date === ds);
    if (has) {
      this.showDetail(ds);
    } else {
      this.setData({ calDetail: null });
      wx.showToast({ title: '当天暂无训练记录', icon: 'none' });
    }
  },

  // 点击本周迷你日历的某天：打开月历弹窗并定位到该天，有记录则直接展示详情
  onSelectWeekDay(e) {
    const ds = e.currentTarget.dataset.date;
    if (!ds) return;
    const d = new Date(ds);
    this.setData({
      calYear: d.getFullYear(),
      calMonth: d.getMonth(),
      calSelected: ds,
      calDetail: null,
      calExpanded: true
    }, () => {
      this.buildCalendar();
      if (store.get().trainingLogs.some(l => l.date === ds)) this.showDetail(ds);
    });
  },

  // 内联展示某日训练明细：该日可能有多场训练，取最新一场（按 createdAt 倒序）
  showDetail(ds) {
    const dayLogs = store.get().trainingLogs.filter(l => l.date === ds);
    const log = dayLogs.length
      ? dayLogs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
      : null;
    if (!log) { this.setData({ calDetail: null }); return; }
    let totalSets = 0, totalTrain = 0, totalRest = 0;
    log.actions.forEach(a => {
      totalSets += (a.sets || 0);
      (a.setsDetail || []).forEach(s => {
        totalTrain += Number(s.trainSec) || 0;
        totalRest += Number(s.restSec) || 0;
      });
    });
    this.setData({
      calSelected: ds,
      calDetail: {
        date: ds,
        actions: log.actions,
        summary: {
          actions: log.actions.length,
          sets: totalSets,
          train: fmtSec(totalTrain),
          rest: fmtSec(totalRest)
        }
      }
    }, () => this.buildCalendar());
  },

  // 收起内联详情，回到纯日历
  closeDetail() { this.setData({ calDetail: null }); },

  closeCalendar() { this.setData({ calExpanded: false, calDetail: null }); },
  stopProp() {},

  goWeight() { if (!auth.requireLogin()) return; wx.navigateTo({ url: '/pages/weight-record/weight-record?from=home' }); }
});

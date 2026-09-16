// pages/list/list.js —— 严格对齐 06-records.html（训练记录）
const store = require('../../utils/store.js');
const { library } = require('../../utils/exercises.js');
const { media } = require('../../utils/media.js');
const theme = require('../../utils/theme.js');
// 日期口径统一走 dateRange（自然周，周一 00:00 起）；统计口径统一走 trainingStats
const dateRange = require('../../utils/dateRange.js');
const stats = require('../../utils/trainingStats.js');

const { todayStr, mondayOf, shiftDaysISO, fmtMonthLabel, fmtDateSlash } = dateRange;

// 动作库反查：优先按 id（唯一），名字兜底（早于 phase1 的旧日志只有 name，没存 id）。
// 训练日志现已同时写 id（见 workout.js saveWorkout），同名不同动作/自建动作用名字会串图。
const LIB_BY_ID = {};
const LIB_BY_NAME = {};
Object.keys(library).forEach(cat => (library[cat] || []).forEach(e => {
  if (e.id) LIB_BY_ID[e.id] = e;
  if (e.nameZh) LIB_BY_NAME[e.nameZh] = e;
  if (e.name) LIB_BY_NAME[e.name] = e;
}));
function findLib(id, name) {
  return (id && LIB_BY_ID[id]) || (name && LIB_BY_NAME[name]) || null;
}

// 秒数 → MM:SS（不足 1 小时）
function fmtDuration(sec) {
  return dateRange.pad2(Math.floor(sec / 60)) + ':' + dateRange.pad2(sec % 60);
}

// 动作名 → emoji 缩略图（06 设计用线性 SVG 图标，小程序内用 emoji 兜底，省得拖 4 个 SVG）
function pickThumbEmoji(name) {
  const n = String(name || '');
  if (/卧推|飞鸟|胸|夹胸|俯卧撑/.test(n)) return '🏋️';
  if (/划船|引体|下拉|背/.test(n)) return '🚣';
  if (/卷腹|仰卧|腹|平板|举腿/.test(n)) return '🧘';
  if (/深蹲|蹲|腿|腿屈|腿伸|弓步|臀/.test(n)) return '🦵';
  if (/推举|侧平举|前平举|肩|耸肩/.test(n)) return '💪';
  if (/弯举|臂屈|三头|臂/.test(n)) return '💪';
  if (/硬拉|罗马尼亚/.test(n)) return '🏋️';
  if (/跑步|有氧|跳绳|划船机|单车|椭圆/.test(n)) return '🏃';
  return '🏋️';
}

Page({
  data: {
    // 'theme-light' | 'theme-dark'，由「我的 → 深色主题」开关控制，onShow 同步
    theme: 'theme-light',
    tab: 'records',  // 'records' | 'review'
    monthLabel: '2024年8月',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    weekDates: [],   // 7 天单元格
    todayStr: todayStr(),
    selectedDate: '',
    // 选中日期的训练记录卡
    record: {
      hasData: false,
      dateLabel: '',
      duration: '--',
      calories: '--',
      actionCount: 0,
      actions: []
    },
    showExSheet: false,
    exSheet: { name: '', gif: '', count: 0, maxWeight: 0, totalSets: 0, avgRpe: '', history: [] }
  },

  _touchStartX: 0,
  _touchStartY: 0,
  _swiping: false,

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, theme: themeCls });
    }
    // 来自「我的」页的 pendingListTab（保留旧入口兼容）
    const app = getApp();
    if (app && app.globalData && app.globalData.pendingListTab) {
      const target = app.globalData.pendingListTab;
      app.globalData.pendingListTab = '';
      this.setData({ tab: target });
    }
    this.setData({ todayStr: todayStr() });
    // 默认选中今天；若已选过日期则保持
    const sel = this.data.selectedDate || this.data.todayStr;
    this._buildWeek(sel);
    this._loadRecord(sel);
  },

  onLoad() {
    // 首次进入默认今天
    this.setData({ selectedDate: todayStr() });
  },

  // ============== HEADER ==============
  switchTitle(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    // 训练复盘 → 当前页内嵌组件显示（不再跳独立页）；组件 wx:if 创建时自行 rebuild
    this.setData({ tab });
  },

  // ============== MONTH ==============
  onPickMonth(e) {
    // picker mode=date fields=month 返回 'YYYY-MM'，需要补成 'YYYY-MM-01'
    const v = e.detail.value;
    if (!v) return;
    // 跳到这个月 1 号
    const iso = v + '-01';
    this._buildWeek(iso);
    this.setData({ selectedDate: iso });
    this._loadRecord(iso);
  },

  // ============== DATE ROW ==============
  selectDate(e) {
    const iso = e.currentTarget.dataset.iso;
    if (!iso || iso === this.data.selectedDate) return;
    this._buildWeek(iso);
    this.setData({ selectedDate: iso });
    this._loadRecord(iso);
  },

  // 滑动手势：左右滑切周
  onDateTouchStart(e) {
    const t = (e.touches && e.touches[0]) || {};
    this._touchStartX = t.clientX || 0;
    this._touchStartY = t.clientY || 0;
    this._swiping = false;
  },
  onDateTouchEnd(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || {};
    const dx = (t.clientX || 0) - this._touchStartX;
    const dy = (t.clientY || 0) - this._touchStartY;
    // 横向滑动 > 50rpx 且 横向位移 > 纵向位移 ×1.5 → 切周
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const delta = dx < 0 ? 7 : -7;
      const sel = this.data.selectedDate;
      const next = shiftDaysISO(sel, delta);
      this._buildWeek(next);
      this.setData({ selectedDate: next });
      this._loadRecord(next);
    }
  },

  // ============== WEEK BUILD ==============
  _buildWeek(iso) {
    const mon = mondayOf(iso);              // 自然周（周一 00:00 起），与计划页/复盘同一口径
    const logs = store.get().trainingLogs || [];
    const recordSet = new Set(logs.map(l => l.date));
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      const dIso = dateRange.fmtDate(d);
      weekDates.push({
        day: d.getDate(),
        iso: dIso,
        muted: false,
        hasRecord: recordSet.has(dIso),
        isActive: dIso === iso
      });
    }
    this.setData({
      weekDates,
      monthLabel: fmtMonthLabel(iso)
    });
  },

  // ============== RECORD CARD ==============
  _loadRecord(iso) {
    const logs = store.get().trainingLogs || [];
    const dayLogs = logs.filter(l => l.date === iso);
    if (!dayLogs.length) {
      this.setData({
        record: {
          hasData: false,
          dateLabel: fmtDateSlash(iso),
          duration: '--',
          calories: '--',
          actionCount: 0,
          actions: []
        }
      });
      return;
    }
    // 同日可能多场，合并所有 actions
    const allActions = [];
    let trainSec = 0;        // 纯训练秒（kcal 估算：休息不产热，不计入）
    let fullSec = 0;         // 训练 + 组间休息 = 整场时长（与「我的」页 todayTraining 一致）
    let k = 0;
    dayLogs.forEach(l => {
      (l.actions || []).forEach(a => {
        // GIF 缩略图：按 id 反查动作库（名字兜底），命中则走 cloud:// 真实演示动图
        const lib = findLib(a.id, a.name);
        allActions.push({
          k: k++,                                   // 唯一键：同日多场、同名动作也不会 wx:key 冲突
          id: a.id || '',
          name: a.name,
          meta: stats.setsMetaOf(a),                // '3 组 × 12/10/8 次'（逐组聚合，非末组快照）
          value: String(stats.peakWeightOf(a)),     // 峰值重量（原取末组，递减组会误报）
          unit: 'kg',
          gif: (lib && lib.video) ? media(lib.video) : '',
          thumbEmoji: pickThumbEmoji(a.name)
        });
      });
      trainSec += stats.trainSecOfLog(l);
      fullSec += stats.durationSecOfLog(l);
    });
    this.setData({
      record: {
        hasData: true,
        dateLabel: fmtDateSlash(iso),
        duration: fmtDuration(fullSec),
        calories: String(stats.estKcal(trainSec)),
        actionCount: allActions.length,
        actions: allActions
      }
    });
  },

  // 点按动作：弹出【当前选中日期】该动作的训练明细（逐组：重量 / 次数 / RPE / 训练时间 / 休息时间）
  // 仅取 this.data.selectedDate 当天日志，不再跨日期汇总
  openExercise(e) {
    const id = e.currentTarget.dataset.id || '';
    const name = e.currentTarget.dataset.name || '';
    const entry = findLib(id, name);
    const selDate = this.data.selectedDate;
    const logs = store.get().trainingLogs || [];
    const rows = [];
    let totalSets = 0, maxWeight = 0, rpeSum = 0, rpeCnt = 0, setNo = 0;
    // 命中判定：日志存了 id 就按 id 比（同名不同动作不串），旧日志无 id 才退回按名字比
    const sameAction = a => (a.id && id) ? a.id === id : a.name === name;
    logs.forEach(l => {
      if (l.date !== selDate) return;            // 只看当前选中日期
      (l.actions || []).forEach(a => {
        if (!sameAction(a)) return;
        const detail = stats.setsOf(a);
        if (detail.length) {
          detail.forEach(s => {
            setNo++;
            const weight = Number(s.weight) || 0;
            const reps = Number(s.reps) || 0;
            const rpe = (s.rpe !== '' && s.rpe != null) ? Number(s.rpe) : null;
            const trainSec = Number(s.trainSec) || 0;
            const restSec = Number(s.restSec) || 0;
            totalSets++;
            if (weight > maxWeight) maxWeight = weight;
            if (rpe != null) { rpeSum += rpe; rpeCnt++; }
            rows.push({
              setNo,
              weight, reps,
              rpe, rpeText: rpe != null ? String(rpe) : '—',
              train: fmtDuration(trainSec),
              rest: fmtDuration(restSec)
            });
          });
        } else {
          // 旧日志无 setsDetail：用顶层字段退化为 1 行
          setNo++;
          const weight = Number(a.weight) || 0;
          const reps = Number(a.reps) || 0;
          totalSets++;
          if (weight > maxWeight) maxWeight = weight;
          rows.push({ setNo, weight, reps, rpe: null, rpeText: '—', train: '0:00', rest: '0:00' });
        }
      });
    });
    // 同一天多次训练同一动作会出现重复 setNo，补唯一键避免 wx:key 冲突
    rows.forEach((r, i) => { r.k = i; });
    const avgRpe = rpeCnt ? (Math.round(rpeSum / rpeCnt * 10) / 10) : '—';
    if (entry) store.get().currentAction = entry;
    this.setData({
      showExSheet: true,
      exSheet: {
        name,
        gif: entry && entry.video ? media(entry.video) : '',
        count: rows.length,
        maxWeight,
        totalSets,
        avgRpe,
        history: rows
      }
    });
  },
  closeExSheet() { this.setData({ showExSheet: false }); },
  noop() {},

  // 分享（P2-4）。原来是 `onShareAppMessage() {}` —— 空实现不会报错，
  // 但分享出去是一张没有标题、也没有可跳转路径的空白卡；更关键的是：
  // 「分享图片给好友」（wx.showShareImageMenu）附带的**小程序入口路径**取决于
  // 当前页是否允许分享给朋友，页面没实现就等于入口退化到首页。
  //
  // 这里只做「发送给朋友」，**不做 onShareTimeline（朋友圈）**：
  // 朋友圈打开走的是「单页模式」——tabBar 不渲染、路由与多数交互接口被禁用，
  // 而本页是日期筛选 + 抽屉的交互密集页，落地即成「诚实的残废入口」。
  // 要发朋友圈得另做一个纯内容页，不是给这里加个 onShareTimeline 就能成立。
  onShareAppMessage() {
    return { title: '衡砺健身记录 · 训练记录', path: '/pages/list/list' };
  }
});

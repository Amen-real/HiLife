// pages/list/list.js —— 严格对齐 06-records.html（训练记录）
const store = require('../../utils/store.js');
const { library } = require('../../utils/exercises.js');
const { media } = require('../../utils/media.js');
const theme = require('../../utils/theme.js');

// 动作名（中文 nameZh / 英文 name）→ 动作库条目。
// 训练日志只存 name（见 workout.js saveWorkout），靠此映射出真实 GIF 与详情页数据。
const LIB_BY_NAME = {};
Object.keys(library).forEach(cat => (library[cat] || []).forEach(e => {
  if (e.nameZh) LIB_BY_NAME[e.nameZh] = e;
  if (e.name) LIB_BY_NAME[e.name] = e;
}));

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function todayStr() {
  return fmtDate(new Date());
}
function parseISO(iso) {
  const p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
// 当前日期所在周的周一
function startOfWeek(iso) {
  const d = parseISO(iso);
  const dow = d.getDay(); // 0=Sun..6=Sat
  // 一周从周一开始：周日(dow=0) 退 6 天；其他退 dow-1 天
  const back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  return d;
}
function shiftISO(iso, delta) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return fmtDate(d);
}
function fmtMonthLabel(iso) {
  const d = parseISO(iso);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
}
function fmtDateSlash(iso) {
  return iso.replace(/-/g, '/');
}
// 秒数 → MM:SS（不足 1 小时）
function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return pad(m) + ':' + pad(s);
}
// 简易卡路里估算：8 kcal/分钟（中等强度训练通用值）
function estKcal(sec) {
  return Math.round((sec / 60) * 8);
}

// 动作名 → emoji 缩略图（06 设计用线性 SVG 图标，小程序内用 emoji 兜底，省得拖 4 个 SVG）
function pickThumbEmoji(name) {
  const n = String(name || '');
  if (/卧推|飞鸟|胸|夹胸|俯卧撑|卧推/.test(n)) return '🏋️';
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
      const next = shiftISO(sel, delta);
      this._buildWeek(next);
      this.setData({ selectedDate: next });
      this._loadRecord(next);
    }
  },

  // ============== WEEK BUILD ==============
  _buildWeek(iso) {
    const mon = startOfWeek(iso);
    const logs = store.get().trainingLogs || [];
    const recordSet = new Set(logs.map(l => l.date));
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      const dIso = fmtDate(d);
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
    const log = logs.filter(l => l.date === iso);
    if (!log.length) {
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
    let totalSec = 0;
    log.forEach(l => {
      (l.actions || []).forEach(a => {
        // a.setsDetail 里 trainSec 累加
        const sec = (a.setsDetail || []).reduce((s, sd) => s + (sd.trainSec || 0), 0);
        totalSec += sec;
        allActions.push({
          name: a.name,
          meta: (a.sets || 0) + '组 × ' + (a.reps || 0) + '次',
          value: String(a.weight || 0),
          unit: 'kg',
          // GIF 缩略图：命中动作库则走 cloud:// 真实演示动图；否则回退 emoji
          gif: (LIB_BY_NAME[a.name] && LIB_BY_NAME[a.name].video) ? media(LIB_BY_NAME[a.name].video) : '',
          thumbEmoji: pickThumbEmoji(a.name)
        });
      });
    });
    this.setData({
      record: {
        hasData: true,
        dateLabel: fmtDateSlash(iso),
        duration: fmtDuration(totalSec),
        calories: String(estKcal(totalSec)),
        actionCount: allActions.length,
        actions: allActions
      }
    });
  },

  // 点按动作：弹出【当前选中日期】该动作的训练明细（逐组：重量 / 次数 / RPE / 训练时间 / 休息时间）
  // 仅取 this.data.selectedDate 当天日志，不再跨日期汇总
  openExercise(e) {
    const name = e.currentTarget.dataset.name || '';
    const entry = LIB_BY_NAME[name];
    const selDate = this.data.selectedDate;
    const logs = store.get().trainingLogs || [];
    const rows = [];
    let totalSets = 0, maxWeight = 0, rpeSum = 0, rpeCnt = 0, setNo = 0;
    logs.forEach(l => {
      if (l.date !== selDate) return;            // 只看当前选中日期
      (l.actions || []).forEach(a => {
        if (a.name !== name) return;
        const detail = a.setsDetail || [];
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

  onShareAppMessage() {}
});

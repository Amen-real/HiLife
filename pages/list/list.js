// pages/list/list.js
const store = require('../../utils/store.js');
const report = require('../../utils/report.js');
const RANGES = [7, 30, 90, 0]; // 0 = 全部

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function shiftDate(ds, delta) {
  const p = ds.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    tab: 'weight',
    rangeIdx: 1,
    ranges: ['7天', '30天', '90天', '全部'],
    stats: { latest: '--', change: '暂无', trend: 'none', max: '--', min: '--', days: 0 },
    weightList: [],
    // 历史记录日期筛选
    filterStart: '',
    filterEnd: '',
    filteredWeightList: [],
    // 训练记录日期筛选（今日 / 昨日 / 选择日期），默认只显示今日一天
    trainQuick: 'today',     // 'today' | 'yesterday' | 'custom'
    trainCustomDate: '',
    todayStr: todayStr(),
    filteredTrainGroups: [],
    trainGroups: [],
    hasWeight: false,
    // 训练详细报表（组数 / 锻炼时间 / 容量与次数）：对比周期固定为「周」
    // 报表三大类 banner 切换：默认显示「组数对比」，点击切换
    reportTab: 'sets',
    reportTabs: ['sets', 'time'],
    reportTabLabels: { sets: '组数对比', time: '锻炼时间' },
    report: { hasData: false, periodLabel: '本周', prevLabel: '上周' }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 来自「我的」页「查看全部训练记录」时，直接落在训练记录 tab
    const app = getApp();
    if (app && app.globalData && app.globalData.pendingListTab) {
      const target = app.globalData.pendingListTab;
      app.globalData.pendingListTab = '';
      this.setData({ tab: target });
    }
    this.setData({ todayStr: todayStr() });
    this.loadWeight();
    this.loadTraining();
    this.loadReport();
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  switchRange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ rangeIdx: idx }, () => this.loadWeight());
  },

  /* ---------- 历史记录日期筛选 ---------- */
  onFilterStart(e) {
    this.setData({ filterStart: e.detail.value }, () => this._applyFilter());
  },
  onFilterEnd(e) {
    this.setData({ filterEnd: e.detail.value }, () => this._applyFilter());
  },
  clearFilter() {
    this.setData({ filterStart: '', filterEnd: '' }, () => this._applyFilter());
  },
  _applyFilter() {
    const { weightList, filterStart, filterEnd } = this.data;
    if (!filterStart && !filterEnd) {
      this.setData({ filteredWeightList: weightList });
      return;
    }
    const filtered = weightList.filter(item => {
      if (filterStart && item.date < filterStart) return false;
      if (filterEnd && item.date > filterEnd) return false;
      return true;
    });
    this.setData({ filteredWeightList: filtered });
  },

  /* ---------- 训练记录日期筛选：今日 / 昨日 / 选择日期（默认今日） ---------- */
  // 点击「今日 / 昨日」切换查看的当天
  onTrainQuick(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ trainQuick: mode, trainCustomDate: '' }, () => this._applyTrainFilter());
  },
  // 选择日期：原生日期选择器选完即筛选该天
  onTrainCustomDate(e) {
    this.setData({ trainQuick: 'custom', trainCustomDate: e.detail.value }, () => this._applyTrainFilter());
  },
  // 回到默认（今日）
  clearTrainFilter() {
    this.setData({ trainQuick: 'today', trainCustomDate: '' }, () => this._applyTrainFilter());
  },
  _applyTrainFilter() {
    const { trainGroups, trainQuick, trainCustomDate } = this.data;
    let filtered = trainGroups;
    if (trainQuick === 'today') {
      const t = todayStr();
      filtered = trainGroups.filter(g => g.date === t);
    } else if (trainQuick === 'yesterday') {
      const y = shiftDate(todayStr(), -1);
      filtered = trainGroups.filter(g => g.date === y);
    } else if (trainQuick === 'custom') {
      filtered = trainCustomDate ? trainGroups.filter(g => g.date === trainCustomDate) : [];
    }
    this.setData({ filteredTrainGroups: filtered });
  },

  loadWeight() {
    const range = RANGES[this.data.rangeIdx];
    const s = store.getWeightStats(range || null);
    const changeVal = s.change != null ? Number(s.change) : null;
    const trend = changeVal == null ? 'none' : (changeVal < 0 ? 'down' : (changeVal > 0 ? 'up' : 'flat'));
    this.setData({
      stats: {
          latest: s.latest || '--',
          change: s.change != null ? s.change : '暂无',
          trend,
          max: s.max || '--',
          min: s.min || '--',
          days: s.days,
          down: !!s.down
        },
      weightList: s.list,
      hasWeight: s.list.length > 0
    }, () => {
      this._applyFilter();
      if (this.data.hasWeight) this.drawChart();
    });
  },

  loadTraining() {
    const logs = store.get().trainingLogs.slice();
    // 同日多场训练：按 createdAt 升序计算每场是第几练（最早=第1练）
    const asc = logs.slice().sort((a, b) =>
      a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date.localeCompare(b.date)
    );
    const sessionOf = {};
    const cnt = {};
    asc.forEach(l => { cnt[l.date] = (cnt[l.date] || 0) + 1; sessionOf[l.sid] = cnt[l.date]; });
    // 统计每个日期的场次数
    const perDate = {};
    logs.forEach(l => { perDate[l.date] = (perDate[l.date] || 0) + 1; });
    // 拍平每条场次，带 sessionNo / multi / key
    const flat = logs.map(l => Object.assign({}, l, {
      key: l.sid || (l.date + '_' + (l.createdAt || '')),
      sessionNo: sessionOf[l.sid] || 1,
      multi: (perDate[l.date] || 0) > 1
    }));
    // 按日期分组（折叠式布局）：同一天多场聚合为一个分组，组内按场次升序
    const groupsMap = {};
    const order = [];
    flat.forEach(l => {
      if (!groupsMap[l.date]) { groupsMap[l.date] = []; order.push(l.date); }
      groupsMap[l.date].push(l);
    });
    const trainGroups = order.map(date => {
      const sessions = groupsMap[date].slice().sort((a, b) => a.sessionNo - b.sessionNo);
      return {
        date,
        key: 'g_' + date,
        multi: sessions.length > 1,
        sessions,
        collapsed: false
      };
    });
    this.setData({ trainGroups }, () => this._applyTrainFilter());
  },

  /* ---------- 训练详细报表 ---------- */
  loadReport() {
    const logs = store.get().trainingLogs;
    const rep = report.computeReport(logs, 'week', this.data.todayStr);
    this.setData({ report: rep });
  },
  // 切换报表大类（组数对比 / 锻炼时间 / 容量与次数）
  switchReportTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.reportTab) return;
    this.setData({ reportTab: tab });
  },

  // 折叠/展开某日期分组
  toggleGroup(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const groups = this.data.filteredTrainGroups;
    if (!groups[idx]) return;
    const patch = {};
    patch['filteredTrainGroups[' + idx + '].collapsed'] = !groups[idx].collapsed;
    this.setData(patch);
  },

  goRecordWeight() {
    wx.navigateTo({ url: '/pages/weight-record/weight-record?from=list' });
  },

  openTrainDetail(e) {
    const date = e.currentTarget.dataset.date;
    const sid = e.currentTarget.dataset.sid;
    wx.navigateTo({ url: '/pages/train-detail/train-detail?date=' + date + (sid ? '&sid=' + sid : '') });
  },

  drawChart() {
    let dpr = 2;
    try { dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2; } catch (e) {}
    const query = wx.createSelectorQuery();
    query.select('#wc').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const w = res[0].width;
      const h = res[0].height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const list = this.data.weightList;
      const vals = list.map(r => r.weight);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const pad = 44;
      const cw = w - pad * 2;
      const ch = h - pad * 2;
      const range = (max - min) || 1;
      const pts = list.map((r, i) => ({
        x: pad + (list.length === 1 ? cw / 2 : cw * i / (list.length - 1)),
        y: pad + ch * (1 - (r.weight - min) / range)
      }));

      // 网格
      ctx.strokeStyle = '#eef0f3';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const y = pad + ch * i / 3;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
      }
      // 折线
      ctx.strokeStyle = '#07c160';
      ctx.lineWidth = 3;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      // 数据点
      ctx.fillStyle = '#07c160';
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
      // 极值标注
      ctx.fillStyle = '#8a9099';
      ctx.font = '11px sans-serif';
      ctx.fillText(max.toFixed(1), 4, pad - 8);
      ctx.fillText(min.toFixed(1), 4, h - pad + 18);
    });
  },

  onShareAppMessage() {}
});

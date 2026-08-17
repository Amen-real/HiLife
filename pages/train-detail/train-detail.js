// pages/train-detail/train-detail.js
const store = require('../../utils/store.js');

// 秒 -> 友好文案（例：90 -> "1分30秒"，45 -> "45s"）
function fmtSec(sec) {
  sec = Number(sec) || 0;
  if (!sec) return '0s';
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? (m + '分' + s + '秒') : (m + '分');
}

Page({
  data: {
    date: '',
    sessionLabel: '',
    log: null,
    summary: { actions: 0, sets: 0, train: '0s', rest: '0s' }
  },

  onLoad(options) {
    const date = options.date || '';
    const sid = options.sid || '';
    const logs = (store.get().trainingLogs) || [];
    // 优先按场次 sid 精确定位；无 sid（旧数据/兼容）则按日期取最新一场
    let log = null;
    if (sid) log = logs.find(l => l.sid === sid) || null;
    if (!log) log = logs.find(l => l.date === date) || null;
    if (!log) {
      this.setData({ date });
      wx.showToast({ title: '未找到该训练记录', icon: 'none' });
      return;
    }

    // 该日第几练（同日多场时显示，最早=第1练）
    const dayLogs = logs.filter(l => l.date === date);
    const asc = dayLogs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const idx = asc.findIndex(l => l.sid === log.sid);
    const sessionNo = idx >= 0 ? idx + 1 : 1;
    const sessionLabel = dayLogs.length > 1 ? ('第' + sessionNo + '练') : '';

    // 汇总：总组数 / 总训练时长 / 总休息时长
    let totalSets = 0, totalTrain = 0, totalRest = 0;
    log.actions.forEach(a => {
      totalSets += (a.sets || 0);
      (a.setsDetail || []).forEach(s => {
        totalTrain += Number(s.trainSec) || 0;
        totalRest += Number(s.restSec) || 0;
      });
    });

    this.setData({
      date,
      sessionLabel,
      log,
      summary: {
        actions: log.actions.length,
        sets: totalSets,
        train: fmtSec(totalTrain),
        rest: fmtSec(totalRest)
      }
    });
  }
});

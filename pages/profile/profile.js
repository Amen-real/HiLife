// pages/profile/profile.js
const store = require('../../utils/store.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
// 日期偏移（delta 天），用于「昨日」
function shiftDate(ds, delta) {
  const p = ds.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtSec(s) {
  s = Number(s) || 0;
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? (m + '分' + r + '秒') : (m + '分');
}
function weekday(ds) {
  const parts = ds.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function bmi(w, h) {
  if (!w || !h) return '--';
  const v = Number(w) / Math.pow(Number(h) / 100, 2);
  return v.toFixed(1);
}

Page({
  data: {
    profile: {},
    loggedIn: false,
    nickname: '',
    avatarText: '衡',
    avatarUrl: '',
    streak: 0,
    favCount: 0,
    health: { goal: '未设置', weight: '未记录', height: '未设置', bmi: '--' }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    this.refresh();
  },

  refresh() {
    const g = store.get();
    const p = g.profile;
    // 连续训练天数（截至今天，向前连续有训练记录的日期数）
    const daySet = new Set((g.trainingLogs || []).map(l => l.date));
    let streak = 0;
    let sd = new Date();
    const fmtD = x => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    while (daySet.has(fmtD(sd))) { streak++; sd.setDate(sd.getDate() - 1); }

    // 健康概览：当前目标 / 最新体重 / 身高 / BMI
    const ws = store.getWeightStats();
    const latestW = ws.latest;
    const h = p.height != null ? Number(p.height) : null;
    const health = {
      goal: p.goal || '未设置',
      weight: latestW != null ? latestW : '未记录',
      height: h != null ? h : '未设置',
      bmi: bmi(latestW ? Number(latestW) : null, h)
    };

    this.setData({
      profile: p,
      loggedIn: g.userInfo.loggedIn,
      nickname: g.userInfo.nickname,
      avatarUrl: g.userInfo.avatar || '',
      avatarText: g.userInfo.loggedIn ? (g.userInfo.nickname || '衡')[0] : '衡',
      streak,
      favCount: (g.favorites || []).length,
      health
    });
  },

  // 本地登录：不调用 wx.login / 云函数，生成本地匿名标识作为登录态
  // 同一设备复用稳定 local_uid（不关联真实微信身份，数据仅存本机）
  wechatLogin() {
    if (this.data.loggedIn) return;
    let localUid = wx.getStorageSync('local_uid');
    if (!localUid) {
      localUid = 'local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      wx.setStorageSync('local_uid', localUid);
    }
    store.login(localUid);
    wx.showToast({ title: '登录成功', icon: 'success' });
    this.refresh();
  },

  // 头像：从相册/拍照选择，保存到本地持久目录（不依赖微信临时路径，刷新不失效）
  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = res.tempFiles[0].tempFilePath;
        wx.getFileSystemManager().saveFile({
          tempFilePath: temp,
          success: (r) => {
            const saved = r.savedFilePath;
            store.setUserProfile(undefined, saved);
            this.setData({ avatarUrl: saved });
          },
          fail: () => {
            // 保存失败则退回临时路径
            store.setUserProfile(undefined, temp);
            this.setData({ avatarUrl: temp });
          }
        });
      }
    });
  },
  // 昵称输入实时回显（避免受控 input 光标跳动）
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },
  // 昵称失焦时持久化
  onNicknameBlur(e) {
    store.setUserProfile(e.detail.value, this.data.avatarUrl);
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后健康数据和训练记录将暂时隐藏，重新登录后自动恢复。',
      confirmText: '退出',
      confirmColor: '#F2545B',
      success: (r) => {
        if (r.confirm) {
          store.logout();
          this.setData({ avatarUrl: '' });
          this.refresh();
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      }
    });
  },

  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },

  goPlan() { wx.navigateTo({ url: '/pages/plan/plan' }); },

  comingSoon(e) {
    const act = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.act) || '该功能';
    wx.showToast({ title: act + ' 开发中', icon: 'none' });
  },

  goTrainRecords() {
    const app = getApp();
    if (app && app.globalData) app.globalData.pendingListTab = 'training';
    wx.switchTab({ url: '/pages/list/list' });
  }
});

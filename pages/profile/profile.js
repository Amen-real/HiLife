// pages/profile/profile.js
const store = require('../../utils/store.js');

// 用户数据字段（导出/导入/清除只作用于这些，设备运行配置如 visionBackendUrl 等不纳入）
const DATA_KEYS = [
  'userInfo', 'profile', 'selectedActions', 'trainingPlans', 'activePlanId',
  'weightRecords', 'trainingLogs', 'meals', 'favorites', 'customActions', 'reminderOn'
];

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
    health: { goal: '未设置', weight: '未记录', height: '未设置', bmi: '--' },
    showDataMgr: false,
    showExportShare: false,
    exportFilePath: ''
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

  // 点击「收藏」统计项 → 进入收藏页查看已收藏动作
  goFavorites() { wx.navigateTo({ url: '/pages/favorites/favorites' }); },

  // 点击「隐私政策」→ 进入隐私政策页查看完整内容
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  // 点击「训练复盘」→ 进入复盘页（按记录数+是否有周期自动分流模式）
  goReview() { wx.navigateTo({ url: '/pages/review/review' }); },

  comingSoon(e) {
    const act = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.act) || '该功能';
    wx.showToast({ title: act + ' 开发中', icon: 'none' });
  },

  goTrainRecords() {
    const app = getApp();
    if (app && app.globalData) app.globalData.pendingListTab = 'training';
    wx.switchTab({ url: '/pages/list/list' });
  },

  /* ===== 数据管理面板：进入 / 关闭 ===== */
  openDataMgr() { this.setData({ showDataMgr: true }); },
  closeDataMgr() { this.setData({ showDataMgr: false }); },
  // 阻止点击面板内容区冒泡到遮罩（避免误关）
  stopTap() {},

  /* ===== 数据管理：导出 / 导入 / 清除 ===== */
  // 导出：写文件 → 弹「转发」面板 → 用户点按钮时在 TAP 回调里调 shareFileMessage（满足手势要求）
  exportData() {
    this.closeDataMgr();
    const g = getApp().globalData;
    const payload = { _app: 'hilife', _ver: 1, _exportedAt: Date.now() };
    DATA_KEYS.forEach(k => { payload[k] = g[k]; });
    const json = JSON.stringify(payload);
    const fs = wx.getFileSystemManager();
    const path = `${wx.env.USER_DATA_PATH}/hilife-backup-${Date.now()}.txt`;
    wx.showLoading({ title: '生成备份...' });
    fs.writeFile({
      filePath: path,
      data: json,
      encoding: 'utf8',
      success: () => {
        wx.hideLoading();
        // 保存路径并弹出转发面板（shareFileMessage 必须在用户 TAP 回调中调用）
        this.setData({ showExportShare: true, exportFilePath: path });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); }
    });
  },

  // 用户点击「转发文件」按钮时直接调用（满足 TAP gesture 要求）
  doShareFile() {
    const path = this.data.exportFilePath;
    if (!path) return;
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: path,
        fileName: 'hilife-backup.txt',
        success: () => {
          this.setData({ showExportShare: false, exportFilePath: '' });
          wx.showToast({ title: '导出成功', icon: 'success' });
        },
        fail: (err) => {
          console.warn('[export] shareFileMessage 失败：', err);
          this.setData({ showExportShare: false, exportFilePath: '' });
          wx.showToast({ title: '转发失败，请重试', icon: 'none' });
        }
      });
    } else {
      this.setData({ showExportShare: false, exportFilePath: '' });
      wx.showToast({ title: '当前环境不支持转发文件', icon: 'none' });
    }
  },

  closeExportShare() { this.setData({ showExportShare: false, exportFilePath: '' }); },

  // 导出降级：PC 端另存为；再不行复制文件路径
  _saveFallback(path) {
    this.setData({ showExportShare: false, exportFilePath: '' });
    if (wx.saveFileToDisk) {
      wx.saveFileToDisk({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到本地', icon: 'success' }),
        fail: () => this._copyPath(path)
      });
    } else {
      this._copyPath(path);
    }
  },

  _copyPath(path) {
    wx.setClipboardData({
      data: path,
      success: () => wx.showModal({
        title: '导出',
        content: '文件已生成，路径已复制：\n' + path + '\n（当前环境不支持直接转发，请在文件管理器中找到该文件手动发送）',
        showCancel: false
      })
    });
  },

  // 导入：从微信会话选择备份 JSON，覆盖用户数据字段（设备配置保持当前设备值）
  importData() {
    this.closeDataMgr();
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'json'],
      success: (res) => {
        const file = res.tempFiles[0];
        const fs = wx.getFileSystemManager();
        wx.showLoading({ title: '导入中...' });
        fs.readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => {
            wx.hideLoading();
            try {
              const data = JSON.parse(r.data);
              if (data._app !== 'hilife') {
                wx.showModal({ title: '导入失败', content: '这不是衡砺健身记录的备份文件', showCancel: false });
                return;
              }
              const g = getApp().globalData;
              DATA_KEYS.forEach(k => { if (data[k] !== undefined) g[k] = data[k]; });
              g.reminderOn = !!g.reminderOn;
              getApp().persist();
              this.refresh();
              wx.showToast({ title: '导入成功', icon: 'success' });
            } catch (e) {
              wx.showModal({ title: '导入失败', content: '文件解析出错：' + (e.message || e), showCancel: false });
            }
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '读取失败', icon: 'none' }); }
        });
      },
      fail: () => {}
    });
  },

  // 清除：重置全部用户数据 + 登录态，并清掉本地登录标识与退出快照
  clearLocalData() {
    wx.showModal({
      title: '清除本机数据',
      content: '将清除全部训练记录、体重、饮食、计划、收藏等本地数据，且不可恢复。确定继续？',
      confirmText: '清除',
      confirmColor: '#F2545B',
      success: (r) => {
        if (!r.confirm) return;
        this.closeDataMgr();
        const g = getApp().globalData;
        g.userInfo = { loggedIn: false, nickname: '', avatar: '' };
        g.profile = { gender: '', goal: '减重', targetWeight: null, height: null, currentWeight: null, fitnessDays: 0 };
        g.selectedActions = [];
        g.trainingPlans = [];
        g.activePlanId = '';
        g.weightRecords = [];
        g.trainingLogs = [];
        g.meals = [];
        g.favorites = [];
        g.customActions = [];
        g.reminderOn = false;
        getApp().persist();
        wx.removeStorageSync('local_uid');
        wx.removeStorageSync('uu_fitness_backup');
        this.refresh();
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  }
});

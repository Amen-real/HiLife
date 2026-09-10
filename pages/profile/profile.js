// pages/profile/profile.js
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const nutrition = require('../../utils/nutrition.js');

// 用户数据字段（导出/导入/清除只作用于这些，设备运行配置如 visionBackendUrl 等不纳入）
const DATA_KEYS = [
  'userInfo', 'profile', 'selectedActions', 'trainingPlans', 'activePlanId',
  'weightRecords', 'trainingLogs', 'meals', 'favorites', 'customActions', 'reminderOn'
];

function bmi(w, h) {
  if (!w || !h) return '--';
  const v = Number(w) / Math.pow(Number(h) / 100, 2);
  return v.toFixed(1);
}

/* ===== 「我的」页派生数据用的纯函数（口径与数据页/复盘组件保持一致） ===== */
const APP_VERSION = '1.0.0';
function round1(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 10) / 10 : 0; }
// 大数字时长：3 小时以上给「3.2h」，不足 1 小时给「45m」
function fmtDur(totalSec) {
  const s = Number(totalSec) || 0;
  if (s <= 0) return '0m';
  if (s < 3600) return Math.round(s / 60) + 'm';
  const h = s / 3600;
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
}
// 累计容量：12800 → '12.8k'（与复盘页 fmtVol 同款）
function fmtVol(v) {
  const n = Number(v) || 0;
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}
// 称号：按训练天数分档，给正反馈而非考核
function rankOf(days) {
  const d = Number(days) || 0;
  if (d <= 0) return '新手上路';
  if (d < 7) return '初出茅庐';
  if (d < 30) return '渐入佳境';
  if (d < 100) return '稳定训练者';
  if (d < 365) return '训练达人';
  return '年度铁人';
}
// BMI 分档（中国成人标准）
function bmiBucket(v) {
  if (v < 18.5) return '偏瘦';
  if (v < 24) return '正常';
  if (v < 28) return '超重';
  return '肥胖';
}
// BMI 刻度定位：显示区间 15–35，越界夹到两端避免滑块出框
function bmiMarkStyle(v) {
  const pct = Math.max(2, Math.min(98, (Number(v) - 15) / 20 * 100));
  return 'left:' + pct.toFixed(1) + '%;';
}

Page({
  data: {
    profile: {},
    loggedIn: false,
    nickname: '',
    avatarText: '衡',
    avatarUrl: '',
    // 账户主卡：称号 + 累计三连
    heroTitle: '新手上路',
    totals: { days: 0, dur: '0m', vol: '0' },
    // 我的数据：四格概览 + 解读块
    health: { goal: '未设置', weight: '未记录', height: '未设置', bmi: '--' },
    hasProfile: false,
    bmi: { show: false, label: '', markStyle: 'left:0%;' },
    goal: {
      show: false, verb: '减', done: 0, total: 0,
      from: '--', to: '--', pct: 0, fillStyle: 'width:0%;', remain: '0', weeks: 0
    },
    reminderOn: false,
    version: APP_VERSION,
    showDataMgr: false,
    showExportShare: false,
    exportFilePath: '',
    // 深色主题开关（数据真源在 utils/theme.js，此处仅作 switch 的 checked 绑定）
    darkMode: false,
    // 'theme-light' | 'theme-dark'
    theme: 'theme-light'
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({
      theme: themeCls,
      darkMode: theme.get() === theme.DARK
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4, theme: themeCls });
    }
    this.refresh();
  },

  // 深色主题开关：切换后即时同步底栏；各 tab 页（首页等）在自身 onShow 里读取新值
  onToggleTheme(e) {
    const on = !!(e && e.detail && e.detail.value);
    const t = theme.set(on ? theme.DARK : theme.LIGHT);
    const themeCls = t === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ darkMode: t === theme.DARK, theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ theme: themeCls });
    }
    wx.showToast({
      title: t === theme.DARK ? '已切换到深色' : '已切换到浅色',
      icon: 'none',
      duration: 1200
    });
  },

  // 训练提醒：本页做本地开关（落 store.reminderOn），首次开启时说明提醒形式
  // 注：真正的推送需服务端下发订阅消息，此处不做假承诺
  tapReminder() {
    const on = !this.data.reminderOn;
    store.setReminder(on);
    this.setData({ reminderOn: on });
    if (on) {
      wx.showModal({
        title: '已开启训练提醒',
        content: '将在你设定的训练日于小程序内提示。关闭可随时点回本项。',
        confirmText: '知道了',
        showCancel: false
      });
    } else {
      wx.showToast({ title: '已关闭训练提醒', icon: 'none', duration: 1200 });
    }
  },

  refresh() {
    const g = store.get();
    const p = g.profile || {};
    const logs = g.trainingLogs || [];

    /* ===== ① 账户主卡：累计三连（天数 / 时长 / 容量） ===== */
    // 时长口径 = Σ(trainSec + restSec)，与数据页 totalFullSec、复盘页 durationSecOfLog 一致
    // 容量口径 = Σ(重量 × 次数)，与复盘页 loadOfLog 一致
    let totalSec = 0;
    let totalVol = 0;
    const activeDays = {};
    logs.forEach(l => {
      if (!l) return;
      if (l.date) activeDays[l.date] = 1;
      (l.actions || []).forEach(a => {
        const sets = (a.setsDetail && a.setsDetail.length)
          ? a.setsDetail
          : (Array.isArray(a.sets) ? a.sets : []);
        sets.forEach(s => {
          totalSec += (Number(s.trainSec) || 0) + (Number(s.restSec) || 0);
          totalVol += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        });
      });
    });
    const totals = {
      days: Object.keys(activeDays).length,
      dur: fmtDur(totalSec),
      vol: fmtVol(totalVol)
    };

    /* ===== ② 我的数据：健康四格 ===== */
    const ws = store.getWeightStats();
    const latestW = ws.latest;                                   // '72.5' | null
    const latestWn = latestW != null ? Number(latestW) : null;
    const h = (p.height != null && p.height !== '') ? Number(p.height) : null;
    const health = {
      // 目标词归一：历史数据里的「减重」显示为规范词「减脂」（与设置页、营养推荐同词表）
      goal: nutrition.normalizeGoal(p.goal) || '未设置',
      weight: latestW != null ? latestW : '未记录',
      height: h != null ? h : '未设置',
      // 身高按 cm 校验（>80），避免误填米制时算出一个荒谬的 BMI
      bmi: bmi(latestWn, h > 80 ? h : null)
    };

    // BMI 解读：身高按 cm 校验（>80 防误填米制）
    const bmiVal = (latestWn && h > 80)
      ? Math.round(latestWn / Math.pow(h / 100, 2) * 10) / 10
      : 0;
    const bmiInfo = bmiVal
      ? { show: true, label: bmiBucket(bmiVal), markStyle: bmiMarkStyle(bmiVal) }
      : { show: false, label: '', markStyle: 'left:0%;' };

    // 距目标：起点取最早一条体重记录（无记录则以当前体重为起点，进度为 0）
    const tw = Number(p.targetWeight);
    let goalInfo = {
      show: false, verb: '减', done: 0, total: 0,
      from: '--', to: '--', pct: 0, fillStyle: 'width:0%;', remain: '0', weeks: 0
    };
    if (tw > 0 && latestWn != null) {
      const all = store.getWeightStats(0).list;                  // 全部，按记录顺序（升序）
      const startW = all.length ? Number(all[0].weight) : latestWn;
      const fromW = (startW > 0) ? startW : latestWn;
      const verb = tw < fromW ? '减' : '增';
      const totalN = Math.abs(fromW - tw);
      const doneN = Math.max(0, Math.abs(fromW - latestWn));     // 反向移动记 0，不出现负进度
      const remainN = Math.abs(latestWn - tw);
      const pct = totalN < 0.05 ? 100 : Math.max(0, Math.min(100, Math.round(doneN / totalN * 100)));
      // 节奏预估：按每周 0.5kg 的安全速度估算，不足半公斤不再给周数
      const weeks = remainN >= 0.5 ? Math.ceil(remainN / 0.5) : 0;
      goalInfo = {
        show: true, verb,
        done: round1(doneN), total: round1(totalN),
        from: round1(fromW), to: round1(tw),
        pct, fillStyle: 'width:' + pct + '%;',
        remain: round1(remainN), weeks
      };
    }

    // 空态：热量推荐所需的「身高 + 体重 + 目标」三件套缺一即引导完善
    const hasProfile = !!(h > 80 && latestWn && p.goal);

    this.setData({
      profile: p,
      loggedIn: !!g.userInfo.loggedIn,
      nickname: g.userInfo.nickname,
      avatarUrl: g.userInfo.avatar || '',
      avatarText: g.userInfo.loggedIn ? (g.userInfo.nickname || '衡')[0] : '衡',
      heroTitle: rankOf(p.fitnessDays),
      totals,
      health,
      hasProfile,
      bmi: bmiInfo,
      goal: goalInfo,
      reminderOn: !!g.reminderOn
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

  // 点击「隐私政策」→ 进入隐私政策页查看完整内容
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

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
        // 与 utils/store.js logout() 里的重置对象保持完全一致（字段与默认值都对齐），
        // 否则两处默认值会各自漂移：此前此处缺 weeklyTarget/age/activityLevel/intakeOverride
        g.profile = { gender: '', goal: '减脂', targetWeight: null, height: null, currentWeight: null, fitnessDays: 0, weeklyTarget: 3, age: null, activityLevel: 'moderate', intakeOverride: null };
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

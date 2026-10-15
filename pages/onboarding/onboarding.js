// pages/onboarding/onboarding.js
// 首启引导页：4 屏轮播（欢迎 → 功能 → 权限与隐私 → 选填资料）。
// 触发与记忆：首页 onShow 检测 storage 'onboardingDone' 标记（存版本号，改版可升版本重显）；
// 「跳过 / 开始使用」都会落标记，只显一次；系统返回不落标记 ⇒ 下次冷启动会再来一次。
// 资料保存复用「我的 → 健康数据」同一 schema 与唯一写入口 store.updateProfile（单源铁律）。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');
const nutrition = require('../../utils/nutrition.js');
const navMetrics = require('../../utils/navMetrics.js');

const OB_VERSION = 'v1';
const GOALS = nutrition.GOALS;

Page({
  data: {
    theme: 'theme-light',
    navRowStyle: '',
    statusBarStyle: 'height: 0px',   // 首帧占位 0，onLoad 实测状态栏高度回填（全仓同款范式）
    current: 0,
    total: 4,
    // 第 4 屏表单（选填）：字段与 pages/settings 完全同构
    gender: '男',
    age: '',
    height: '',
    goal: GOALS[0],
    targetWeight: '',
    goals: GOALS
  },

  onLoad() {
    // 自定义导航后「跳过」落在系统胶囊纵向带：横向让位 + 纵向同心（navMetrics 单源）
    this.setData({
      navRowStyle: navMetrics.overlayRowStyle(),
      statusBarStyle: 'height: ' + navMetrics.statusBarHeight() + 'px'
    });
  },

  onShow() {
    // 主题三件套：theme.sync() + 根节点 class + .page.theme-dark（新页铁律）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  },

  onSwiper(e) {
    this.setData({ current: e.detail.current });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onAge(e) { this.setData({ age: e.detail.value }); },
  onHeight(e) { this.setData({ height: e.detail.value }); },
  onTargetWeight(e) { this.setData({ targetWeight: e.detail.value }); },
  pickGender(e) { this.setData({ gender: e.currentTarget.dataset.v }); },
  pickGoal(e) { this.setData({ goal: e.currentTarget.dataset.v }); },

  onNext() {
    if (this.data.current < this.data.total - 1) {
      this.setData({ current: this.data.current + 1 });
    } else {
      this.finish(true);
    }
  },

  onSkip() {
    this.finish(false);
  },

  // 数值轻校验：填了才校验，超出常识区间直接拦（避免垃圾数据进健康档案）
  _num(v, lo, hi, label) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!isFinite(n) || n < lo || n > hi) {
      wx.showToast({ title: label + '需在 ' + lo + '-' + hi + ' 之间', icon: 'none' });
      throw new Error(label);
    }
    return n;
  },

  finish(saveForm) {
    if (saveForm) {
      try {
        const d = this.data;
        const age = this._num(d.age, 6, 100, '年龄');
        const height = this._num(d.height, 100, 250, '身高');
        const targetWeight = this._num(d.targetWeight, 25, 300, '目标体重');
        // 有任何一项填写才落库；首启顺带完成本地匿名登录（数据落库需要登录态）
        if (d.gender || age != null || height != null || targetWeight != null) {
          auth.ensureLocalLogin();
          store.updateProfile({
            gender: d.gender || '',
            goal: d.goal,
            age: age,
            height: height,
            targetWeight: targetWeight
          });
        }
      } catch (e) {
        return; // 校验未过：toast 已弹，停在当前屏让用户改
      }
    }
    wx.setStorageSync('onboardingDone', OB_VERSION);
    wx.switchTab({ url: '/pages/home/home' });
  }
});

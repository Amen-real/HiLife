// pages/settings/settings.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const theme = require('../../utils/theme.js');
const nutrition = require('../../utils/nutrition.js');
// 目标词表唯一真源在 utils/nutrition.js（GOALS），此处不再本地重复定义，避免两处漂移
const GOALS = nutrition.GOALS;
// 活动量档位：展示文案与 store.profile.activityLevel 取值一一对应（系数映射见 utils/nutrition.js）
const ACTIVITY_LEVELS = ['久坐', '轻度', '中度', '高度', '运动员'];
const ACTIVITY_KEYS = ['sedentary', 'light', 'moderate', 'high', 'athlete'];

Page({
  data: {
    theme: 'theme-light',
    gender: '',
    goal: GOALS[0],
    targetWeight: '',
    height: '',
    age: '',
    activityLevels: ACTIVITY_LEVELS,
    activityIndex: 2,
    goals: GOALS,
    genders: ['男', '女'],
    genderIndex: 0,
    goalIndex: 0
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  },

  onLoad() {
    const p = store.get().profile;
    // 历史数据里 goal 可能是别名（如「减重」），先归一成规范词再定位下标，
    // 否则 indexOf 返回 -1 会被 Math.max(0,…) 兜到第一项 → 用户一保存就被静默改写
    const goal = nutrition.normalizeGoal(p.goal) || GOALS[0];
    this.setData({
      gender: p.gender || '',
      goal,
      targetWeight: p.targetWeight || '',
      height: p.height || '',
      age: p.age || '',
      activityIndex: Math.max(0, ACTIVITY_KEYS.indexOf(p.activityLevel || 'moderate')),
      genderIndex: p.gender === '女' ? 1 : 0,
      goalIndex: Math.max(0, GOALS.indexOf(goal))
    });
  },

  pickGender(e) {
    this.setData({ genderIndex: Number(e.detail.value), gender: Number(e.detail.value) === 0 ? '男' : '女' });
  },

  pickGoal(e) {
    this.setData({ goalIndex: Number(e.detail.value), goal: this.data.goals[Number(e.detail.value)] });
  },

  onTarget(e) { this.setData({ targetWeight: e.detail.value }); },
  onHeight(e) { this.setData({ height: e.detail.value }); },
  onAge(e) { this.setData({ age: e.detail.value }); },
  pickActivity(e) { this.setData({ activityIndex: Number(e.detail.value) }); },

  save() {
    if (!auth.requireLogin()) return;
    store.updateProfile({
      gender: this.data.gender,
      goal: this.data.goal,
      targetWeight: this.data.targetWeight ? Number(this.data.targetWeight) : null,
      height: this.data.height ? Number(this.data.height) : null,
      age: this.data.age ? Number(this.data.age) : null,
      activityLevel: ACTIVITY_KEYS[this.data.activityIndex]
    });
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  }
});

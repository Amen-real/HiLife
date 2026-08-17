// pages/settings/settings.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const GOALS = ['减重', '增肌', '塑形', '保持'];

Page({
  data: {
    gender: '',
    goal: '减重',
    targetWeight: '',
    height: '',
    goals: GOALS,
    genders: ['男', '女'],
    genderIndex: 0,
    goalIndex: 0
  },

  onLoad() {
    const p = store.get().profile;
    this.setData({
      gender: p.gender || '',
      goal: p.goal || '减重',
      targetWeight: p.targetWeight || '',
      height: p.height || '',
      genderIndex: p.gender === '女' ? 1 : 0,
      goalIndex: Math.max(0, GOALS.indexOf(p.goal || '减重'))
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

  save() {
    if (!auth.requireLogin()) return;
    store.updateProfile({
      gender: this.data.gender,
      goal: this.data.goal,
      targetWeight: this.data.targetWeight ? Number(this.data.targetWeight) : null,
      height: this.data.height ? Number(this.data.height) : null
    });
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  }
});

// pages/weight-record/weight-record.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
function pad(n) { return n < 10 ? '0' + n : '' + n; }

Page({
  data: {
    date: '',
    weight: ''
  },

  onLoad() {
    const d = new Date();
    this.setData({
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    });
  },

  onWeight(e) { this.setData({ weight: e.detail.value }); },

  save() {
    if (!auth.requireLogin()) return;
    const w = parseFloat(this.data.weight);
    if (!w || w < 20 || w > 300) {
      wx.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }
    store.addWeight(this.data.date, w);
    wx.showToast({ title: '已记录', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});

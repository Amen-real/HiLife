// pages/privacy/privacy.js —— 隐私政策页：主题同步 + 联系邮箱复制
const theme = require('../../utils/theme.js');

// 联系开发者的唯一真源（用户可见的联系方式只此一处）。
// 刻意不走微信客服会话（open-type="contact"）：客服消息要另外配置客服人员，
// 而邮箱零配置、还能让用户附截图。wxml 只渲染 {{email}}，改邮箱只改这一行。
const CONTACT_EMAIL = '1347134533@qq.com';

Page({
  data: {
    theme: 'theme-light',
    email: CONTACT_EMAIL
  },
  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  },

  // 点邮箱 → 复制。小程序内无法直接唤起邮件 App 发信，「复制地址」是唯一稳的做法。
  // ⚠️ wx.setClipboardData 是官方隐私接口（「剪贴板」）：用户拒绝授权时它会失败 ⇒
  //    成功/失败都必须有可见出口，否则就是「点了没反应」（与 profile.copyIcp / _copyPath 同一类坑）。
  copyEmail() {
    const tip = '邮箱地址：' + CONTACT_EMAIL;
    const show = (copied) => wx.showModal({
      title: '联系开发者',
      content: (copied ? '地址已复制，粘贴到邮箱 App 发送即可\n' : '复制失败，请手动记录\n') + tip,
      showCancel: false
    });
    wx.setClipboardData({
      data: CONTACT_EMAIL,
      success: () => show(true),
      fail: () => show(false)
    });
  }
});

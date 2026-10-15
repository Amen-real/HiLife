// utils/auth.js
// 登录门禁：未登录时，所有「会写入用户数据」的操作都需要先登录。
// 阅读类操作（浏览动作库、查看记录、切换分类/筛选）不受限制。
// 「我的」页是登录入口，永远可达，不应被拦截。

const PROFILE_URL = '/pages/profile/profile';

// 本地登录要落 store（login 写 globalData + persist），requireLogin 的跳转目标也在页面层。
const store = require('./store.js');

// appInstance 可选：页面/逻辑层里 getApp() 可靠，可省略；
// 但 App.onLaunch 阶段 getApp() 不可靠（微信官方明确警告「不要在 App() 内使用 getApp()」），
// 必须由调用方把已初始化好的 app 实例（this）传进来，否则会误判为未登录而弹窗。
function isLoggedIn(appInstance) {
  const app = appInstance || getApp();
  return !!(app && app.globalData && app.globalData.userInfo && app.globalData.userInfo.loggedIn);
}

// 在「会记录数据」的操作前调用：
// - 已登录：返回 true，调用方可继续执行
// - 未登录：弹出引导，确认后跳「我的」页登录；返回 false，调用方应提前 return
function requireLogin() {
  if (isLoggedIn()) return true;
  wx.showModal({
    title: '需要登录',
    content: '登录后即可在本机保存你的训练、饮食与健康数据。',
    confirmText: '去登录',
    cancelText: '稍后',
    confirmColor: '#07C160',
    success: (res) => {
      if (res.confirm) wx.switchTab({ url: PROFILE_URL });
    }
  });
  return false;
}

// 本地登录：不调用 wx.login / 云函数，生成本地匿名标识作为登录态
// 同一设备复用稳定 local_uid（不关联真实微信身份，数据仅存本机）。
// 单源（2026-10-15 抽取）：此前 uid 生成内联在 profile.wechatLogin，
// 首启引导页也要落登录态 ⇒ 抽到这里共用，杜绝第二份生成逻辑漂移。
function ensureLocalLogin() {
  if (isLoggedIn()) return true;
  let uid = wx.getStorageSync('local_uid');
  if (!uid) {
    uid = 'local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    wx.setStorageSync('local_uid', uid);
  }
  store.login(uid);
  return true;
}

module.exports = { isLoggedIn, requireLogin, ensureLocalLogin };

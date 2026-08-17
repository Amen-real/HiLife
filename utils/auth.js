// utils/auth.js
// 登录门禁：未登录时，所有「会写入用户数据」的操作都需要先登录。
// 阅读类操作（浏览动作库、查看记录、切换分类/筛选）不受限制。
// 「我的」页是登录入口，永远可达，不应被拦截。

const PROFILE_URL = '/pages/profile/profile';

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

// 开程序时一次性提示（可关闭），引导登录；已登录则不弹
// 必须由 onLaunch 把 this 作为 appInstance 传入，避免 getApp() 在启动期返回 undefined 而误弹
function promptLoginOnLaunch(appInstance) {
  if (isLoggedIn(appInstance)) return;
  wx.showModal({
    title: '欢迎使用 衡力健身记录',
    content: '登录后你的训练、饮食与健康数据将保存在本机，支持随时查看与回放。',
    confirmText: '去登录',
    cancelText: '先逛逛',
    confirmColor: '#07C160',
    success: (res) => {
      if (res.confirm) wx.switchTab({ url: PROFILE_URL });
    }
  });
}

module.exports = { isLoggedIn, requireLogin, promptLoginOnLaunch };

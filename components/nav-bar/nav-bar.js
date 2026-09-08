// components/nav-bar/nav-bar.js —— 通用自定义导航栏
// 自动读取状态栏高度，撑出 statusBarHeight + 44px 的占位，避免页面内容被遮挡。
Component({
  properties: {
    // 标题文字；留空则只渲染状态栏占位 + 返回按钮（适用于页面内已有自有标题块的页，如 cycle / weight-record / favorites）
    title: { type: String, value: '' },
    // 是否显示左侧返回按钮（tab 页传 false，navigateTo 进入的二级页传 true）
    showBack: { type: Boolean, value: false }
  },

  data: {
    sbh: 20,      // 状态栏高度（px）
    totalH: 64    // 状态栏 + 导航栏总高（px）
  },

  lifetimes: {
    attached() {
      const info = (typeof wx.getWindowInfo === 'function')
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const sbh = info.statusBarHeight || 20;
      this.setData({ sbh: sbh, totalH: sbh + 44 });
    }
  },

  methods: {
    goBack() {
      // 有上一页则正常返回；直接落地页（无历史栈）则兜底回首页 tab
      if (getCurrentPages().length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/home/home' });
      }
    }
  }
});

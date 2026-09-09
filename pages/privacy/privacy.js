// pages/privacy/privacy.js —— 隐私政策静态页，仅负责主题同步
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'theme-light'
  },
  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
  }
});

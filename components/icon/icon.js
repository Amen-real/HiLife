// components/icon/icon.js —— 轻量图标组件：根据 name 渲染内联 base64 PNG
// 使用 base64 而非 <image> 本地路径，避免自定义组件里路径解析失败导致图标不显示。
const ICON_DATA = require('./icons-data.js');

Component({
  options: {
    addGlobalClass: true,
    multipleSlots: false
  },
  properties: {
    // 图标名（对应 assets/icons/i-{name}.png）
    name: { type: String, value: '' },
    // 尺寸（单位 rpx）
    size: { type: Number, value: 48 }
  },
  data: {
    src: '',
    boxStyle: ''
  },
  lifetimes: {
    // attached 必定触发，保证首次渲染就能拿到 src（observer 在部分基础库初次不触发）
    attached() {
      this._update();
    }
  },
  observers: {
    'name,size': function () {
      this._update();
    }
  },
  methods: {
    _update() {
      const name = this.data.name || '';
      const s = this.data.size || 48;
      this.setData({
        src: name ? (ICON_DATA[name] || '') : '',
        boxStyle: 'width:' + s + 'rpx;height:' + s + 'rpx;'
      });
    }
  }
});

// pages/food-scan/food-scan.js —— 拍照识别（对齐 08-拍照识别 / 09-食物识别结果 设计稿）
// 流程：进入全屏取景（live camera + cover-view 覆盖层）→ 快门/相册 → AI 识别 → 结果弹层（09）
//      → 重新识别（回取景）/ 加入记录（写入今日饮食并返回）
// ⚠️ camera 是原生组件：取景框、按钮等覆盖物必须用 cover-view（真机普通 view 压不住原生层）；
//     结果/历史页用普通 view（此时相机已 wx:if 卸载，无原生层遮挡问题）。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const vision = require('../../utils/foodvision.js');

const HISTORY_KEY = 'hh_food_scan_history';

// 按当前小时推断默认餐别
function mealByHour(h) {
  if (h < 11) return '早餐';
  if (h < 14) return '午餐';
  if (h < 20) return '晚餐';
  return '加餐';
}

Page({
  data: {
    view: 'camera',       // camera=取景 | analyzing=识别中 | result=识别结果 | history=识别历史
    flash: false,         // 闪光灯（torch）
    camError: false,      // 相机权限被拒/不可用
    statusBarStyle: 'height: 0px',
    photo: null,          // 识别结果 {name, kcal, weight, confText, items[], img, mock}
    history: []           // 识别历史（本地存储，仅文字字段）
  },

  onLoad() {
    const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarStyle: 'height: ' + (info.statusBarHeight || 20) + 'px' });
    this.setData({ history: this.loadHistory() });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: -1 }); // 非 tab 页，不高亮
    }
  },

  /* ---------- 取景态 ---------- */
  toggleFlash() { this.setData({ flash: !this.data.flash }); },
  onCamError() { this.setData({ camError: true }); },

  // 顶部返回：结果/历史态回取景；取景态直接退出页面
  goBack() {
    if (this.data.view === 'camera') { wx.navigateBack({ fail: () => {} }); return; }
    this.setData({ view: 'camera', photo: null });
  },

  // 快门：CameraContext.takePhoto → 识别
  takePhoto() {
    if (this._busy || this.data.camError) return;
    this._busy = true;
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'high',
      success: (res) => this.analyze(res.tempImagePath),
      fail: () => { this._busy = false; wx.showToast({ title: '拍摄失败，请重试', icon: 'none' }); }
    });
  },

  // 相册选图 → 识别
  pickAlbum() {
    if (this._busy) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const f = (res.tempFiles && res.tempFiles[0]) || {};
        if (f.tempFilePath) this.analyze(f.tempFilePath);
      },
      fail: () => {}
    });
  },

  openSetting() {
    wx.openSetting({
      success: (r) => {
        if (r.authSetting && r.authSetting['scope.camera']) this.setData({ camError: false });
      }
    });
  },

  /* ---------- 识别 ---------- */
  analyze(tempFilePath) {
    this._busy = true;
    this.setData({ view: 'analyzing' });
    vision.analyzeImage(tempFilePath).then((raw) => {
      this._busy = false;
      if (!raw || raw.success === false) {
        throw new Error((raw && raw.note) || '未识别出食物，请靠近重拍');
      }
      const conf = (raw.confidence != null && raw.confidence !== '') ? Number(raw.confidence) : null;
      const pct = conf != null ? (conf <= 1 ? Math.round(conf * 100) : Math.round(conf)) : null;
      const items = (raw.items || []).map(it => ({
        name: it.name || '食物',
        weight: (it.weight_g != null && it.weight_g !== '') ? it.weight_g + 'g' : '—'
      }));
      const photo = {
        name: raw.name || '识别到的食物',
        kcal: (raw.total_calories != null) ? Math.round(raw.total_calories) : null,
        weight: (raw.total_weight_g != null && raw.total_weight_g !== '') ? Math.round(raw.total_weight_g) : '',
        protein: (raw.protein != null && raw.protein !== '') ? Math.round(raw.protein) : null,
        carb: (raw.carb != null && raw.carb !== '') ? Math.round(raw.carb) : null,
        fat: (raw.fat != null && raw.fat !== '') ? Math.round(raw.fat) : null,
        confText: pct != null ? pct + '%' : '—',
        items: items,
        img: tempFilePath || '',
        mock: !!raw.mock
      };
      this.pushHistory(photo);
      this.setData({ photo: photo, view: 'result' });
    }).catch((err) => {
      this._busy = false;
      this.setData({ view: 'camera' });
      wx.showModal({
        title: '识别失败',
        content: String((err && (err.errMsg || err.message)) || err),
        showCancel: false
      });
    });
  },

  /* ---------- 识别历史 ---------- */
  loadHistory() {
    try { return wx.getStorageSync(HISTORY_KEY) || []; } catch (e) { return []; }
  },
  pushHistory(p) {
    const item = { ts: Date.now(), name: p.name, kcal: p.kcal, weight: p.weight, conf: p.confText };
    const list = [item].concat(this.data.history).slice(0, 20);
    try { wx.setStorageSync(HISTORY_KEY, list); } catch (e) {}
    this.setData({ history: list });
  },
  openHistory() { this.setData({ view: 'history', history: this.loadHistory() }); },
  clearHistory() {
    wx.showModal({
      title: '清空识别历史',
      content: '确定清空全部识别历史吗？',
      confirmColor: '#E5484D',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.setStorageSync(HISTORY_KEY, []); } catch (e) {}
        this.setData({ history: [] });
      }
    });
  },
  // 点历史项 → 以结果态查看（历史不存原图，无照片占位）
  onPickHistory(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const it = this.data.history[idx];
    if (!it) return;
    this.setData({
      photo: { name: it.name, kcal: it.kcal, weight: it.weight, confText: it.conf || '—', items: [], img: '' },
      view: 'result'
    });
  },

  /* ---------- 结果态 ---------- */
  backToCamera() { this.setData({ view: 'camera', photo: null }); },

  // 加入记录 / 完成：写入今日饮食并返回上一页（首页 onShow 自动刷新饮食卡）
  saveAndExit() {
    if (!auth.requireLogin()) return;
    const p = this.data.photo;
    if (!p || p.kcal == null) { wx.showToast({ title: '暂无热量数据', icon: 'none' }); return; }
    const type = mealByHour(new Date().getHours());
    store.addMeal({
      type: type,
      name: p.name,
      calories: p.kcal,
      protein: Math.round(p.protein || 0),
      carb: Math.round(p.carb || 0),
      fat: Math.round(p.fat || 0),
      note: 'AI拍照估算' + (p.weight ? ' ' + p.weight + 'g' : '') + (p.mock ? '（示例数据）' : '')
    });
    wx.showToast({ title: '已记录到' + type, icon: 'success' });
    setTimeout(() => {
      wx.navigateBack({ fail: () => { wx.switchTab({ url: '/pages/advice/advice' }); } });
    }, 600);
  }
});

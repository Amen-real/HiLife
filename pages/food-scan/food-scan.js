// pages/food-scan/food-scan.js
const off = require('../../utils/openfoodfacts.js');
const cs = require('../../utils/caloriescan.js');
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');

const MEALS = ['早餐', '午餐', '晚餐', '加餐'];

// 按当前小时推断默认餐别
function mealByHour(h) {
  if (h < 11) return '早餐';
  if (h < 14) return '午餐';
  if (h < 20) return '晚餐';
  return '加餐';
}

Page({
  data: {
    loading: false,
    mode: '',                 // 'product' | 'search' | 'camera'
    keyword: '',
    results: [],              // 搜索结果列表
    product: null,            // 当前选中商品（含 per100g）
    photo: null,              // 拍照识别结果
    meals: MEALS,
    mealIndex: 0,
    grams: '100',
    scaled: null              // 按份量缩放后的营养
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: -1 }); // 非 tab 页，不高亮
    }
  },

  onInput(e) { this.setData({ keyword: e.detail.value }); },

  // 扫码识别（条码 / 二维码）
  scanCode() {
    wx.scanCode({
      scanType: ['barCode', 'datamatrix', 'qrCode'],
      success: (res) => this.loadProduct(res.result),
      fail: () => {}
    });
  },

  // 按条码加载完整商品
  async loadProduct(barcode) {
    if (!barcode) return;
    this.setData({ loading: true, mode: 'product', product: null, scaled: null });
    wx.showLoading({ title: '查询中...' });
    try {
      const product = await off.getProductByBarcode(barcode);
      // 默认份量：优先用 serving_size 中的数字，否则 100g
      let grams = 100;
      const m = (product.servingSize || '').match(/[\d.]+/);
      if (m) grams = Math.round(parseFloat(m[0]));
      this.setData({
        product: product,
        grams: String(grams),
        mealIndex: MEALS.indexOf(mealByHour(new Date().getHours())),
        mode: 'product'
      });
      this.updateScaled();
    } catch (err) {
      wx.showModal({
        title: '未找到商品',
        content: 'Open Food Facts 暂无该条码对应的商品。可尝试用「名称搜索」。',
        showCancel: false
      });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  // 名称搜索
  async onSearch() {
    const kw = this.data.keyword.trim();
    if (!kw) { wx.showToast({ title: '请输入食物名称', icon: 'none' }); return; }
    this.setData({ loading: true, mode: 'search', results: [] });
    wx.showLoading({ title: '搜索中...' });
    try {
      const results = await off.searchProducts(kw);
      this.setData({ results: results });
      if (!results.length) wx.showToast({ title: '无结果，换个词试试', icon: 'none' });
    } catch (err) {
      wx.showModal({ title: '搜索失败', content: String(err.message || err), showCancel: false });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  // 从搜索结果点选 → 拉完整营养
  onPick(e) {
    const code = e.currentTarget.dataset.code;
    this.loadProduct(code);
  },

  onMealChange(e) { this.setData({ mealIndex: Number(e.detail.value) }); },
  onGramsInput(e) {
    this.setData({ grams: e.detail.value });
    this.updateScaled();
  },

  // 计算按当前份量缩放后的营养
  updateScaled() {
    const p = this.data.product;
    const g = parseFloat(this.data.grams) || 0;
    if (!p) { this.setData({ scaled: null }); return; }
    const f = g / 100;
    const n = p.per100g;
    const r = (v) => (v == null ? null : Math.round(v * f * 10) / 10);
    this.setData({
      scaled: {
        kcal: r(n.kcal),
        protein: r(n.protein),
        carbs: r(n.carbs),
        fat: r(n.fat),
        sugars: r(n.sugars),
        salt: r(n.salt)
      }
    });
  },

  // 拍照识别（自托管 CalorieScan 后端）
  chooseAndAnalyze() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const f = (res.tempFiles && res.tempFiles[0]) || {};
        if (f.tempFilePath) this.analyzePhoto(f.tempFilePath);
      },
      fail: () => {}
    });
  },

  async analyzePhoto(tempFilePath) {
    this.setData({ loading: true, mode: 'camera', photo: null });
    wx.showLoading({ title: '识别中...' });
    try {
      const raw = await cs.analyzeImage(tempFilePath);
      const conf = (raw && raw.confidence != null) ? Number(raw.confidence) : null;
      const photo = {
        name: (raw && raw.name) || '识别到的食物',
        total_calories: (raw && raw.total_calories != null) ? Math.round(raw.total_calories) : null,
        total_weight_g: (raw && raw.total_weight_g != null) ? Math.round(raw.total_weight_g) : null,
        confidence: conf,
        confidenceText: conf != null ? Math.round(conf * 100) + '%' : '—',
        confidencePct: conf != null ? Math.round(conf * 100) : 0,
        mock: !!(raw && raw.mock),
        note: (raw && raw.note) || ''
      };
      this.setData({ mode: 'camera', photo: photo });
      if (photo.total_calories == null) {
        wx.showToast({ title: '识别失败，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.showModal({
        title: '识别失败',
        content: String((err && (err.errMsg || err.message)) || err),
        showCancel: false
      });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  // 记录条码/搜索商品到今日饮食
  addToDiet() {
    if (!auth.requireLogin()) return;
    const p = this.data.product;
    const s = this.data.scaled;
    if (!p || !s || s.kcal == null) {
      wx.showToast({ title: '该商品缺少营养数据', icon: 'none' });
      return;
    }
    const type = this.data.meals[this.data.mealIndex];
    store.addMeal({
      type: type,
      name: p.name + (p.brand ? '（' + p.brand + '）' : ''),
      calories: Math.round(s.kcal),
      protein: Math.round(s.protein || 0),
      carb: Math.round(s.carbs || 0),
      fat: Math.round(s.fat || 0),
      note: 'Open Food Facts · ' + this.data.grams + 'g'
    });
    wx.showToast({ title: '已记录到' + type, icon: 'success' });
  },

  // 记录拍照识别结果到今日饮食（后端只返回总热量/重量，宏量营养素未知，记 0）
  recordPhoto() {
    if (!auth.requireLogin()) return;
    const p = this.data.photo;
    if (!p || p.total_calories == null) {
      wx.showToast({ title: '暂无热量数据', icon: 'none' });
      return;
    }
    const type = this.data.meals[this.data.mealIndex];
    store.addMeal({
      type: type,
      name: p.name,
      calories: p.total_calories,
      protein: 0,
      carb: 0,
      fat: 0,
      note: 'AI拍照估算' + (p.total_weight_g != null ? ' ' + p.total_weight_g + 'g' : '')
    });
    wx.showToast({ title: '已记录到' + type, icon: 'success' });
  },

  goAdvice() { wx.switchTab({ url: '/pages/advice/advice' }); }
});

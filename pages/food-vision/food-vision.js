// pages/food-vision/food-vision.js
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const vision = require('../../utils/foodvision.js');
const theme = require('../../utils/theme.js');

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '加餐'];

Page({
  data: {
    theme: 'theme-light',
    loading: false,
    result: null,        // { foods:[], total:{}, note, mock, provider }
    error: '',
    mealTypes: MEAL_TYPES,
    recordType: '午餐',
    todayMeals: [],      // 今日已记录饮食（供「今日饮食」列表展示）
    todayCalories: 0     // 今日合计卡路里
  },

  onLoad(options) {
    // 从「饮食记录」页的某一餐点「AI 识别拍照」进来：预选该餐别，记录后自动返回
    if (options && options.meal) {
      this.setData({ recordType: options.meal });
      this._fromAdvice = true;
    }
    this.computeToday();
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    // 从其他入口记录后回到本页，刷新今日列表
    this.computeToday();
  },

  // 根据食物名猜测一个 emoji 缩略图（无真实图时更贴近预览视觉）
  emojiFor(name) {
    const n = name || '';
    if (/鸡|牛|羊|猪|肉|鱼|虾|蟹|蛋|腿|排/.test(n)) return '🍗';
    if (/沙拉|菜|蔬|草| greens|纤维|萝卜|瓜/.test(n)) return '🥗';
    if (/饭|米|面|包|碳|薯|馒|饼/.test(n)) return '🍚';
    if (/奶|豆|酸奶|豆浆|奶酪/.test(n)) return '🥛';
    if (/果|苹|香|橙|莓|梨|桃/.test(n)) return '🍎';
    if (/汤|粥|羹/.test(n)) return '🍲';
    return '🍽️';
  },

  // 汇总今日（按自然日）饮食与合计卡路里
  computeToday() {
    const meals = store.get().meals || [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const list = meals
      .filter(m => (m.time || 0) >= start.getTime())
      .map(m => Object.assign({}, m, { emoji: this.emojiFor(m.name) }))
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    const cal = list.reduce((s, m) => s + (m.calories || 0), 0);
    this.setData({ todayMeals: list, todayCalories: cal });
  },

  // 拍照 / 从相册选择
  chooseImage(e) {
    const source = e.currentTarget.dataset.source; // 'camera' | 'album'
    const sourceType = source === 'camera' ? ['camera'] : ['album'];
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      success: (r) => this.runAnalyze(r.tempFiles[0].tempFilePath),
      fail: () => {}
    });
  },

  runAnalyze(path) {
    this.setData({ loading: true, error: '', result: null });
    vision.analyzeImage(path)
      .then((res) => {
        const r = res || {};
        const foods = (r.foods || []).map(f => Object.assign({}, f, { emoji: this.emojiFor(f.name) }));
        this.setData({ loading: false, result: Object.assign({}, r, { foods }) });
      })
      .catch((err) => {
        const msg = (err && err.errMsg) || '识别失败，请重试';
        this.setData({ loading: false, error: msg });
        wx.showToast({ title: '识别失败', icon: 'none' });
      });
  },

  pickType(e) {
    this.setData({ recordType: e.currentTarget.dataset.type });
  },

  // 记录单个食物到今日饮食
  recordOne(e) {
    if (!auth.requireLogin()) return;
    const idx = e.currentTarget.dataset.idx;
    const f = (this.data.result.foods || [])[idx];
    if (!f) return;
    store.addMeal({
      type: this.data.recordType,
      name: f.name,
      calories: f.calories,
      protein: f.protein,
      carb: f.carb,
      fat: f.fat
    });
    wx.showToast({ title: '已记录到饮食', icon: 'success' });
    this.computeToday();
    if (this._fromAdvice) wx.navigateBack();
  },

  // 按当前餐别批量记录全部
  recordAll() {
    if (!auth.requireLogin()) return;
    const foods = this.data.result.foods || [];
    if (!foods.length) return;
    const type = this.data.recordType;
    foods.forEach((f) => store.addMeal({
      type, name: f.name,
      calories: f.calories, protein: f.protein, carb: f.carb, fat: f.fat
    }));
    wx.showToast({ title: `已记录 ${foods.length} 项`, icon: 'success' });
    this.computeToday();
    if (this._fromAdvice) wx.navigateBack();
  }
});

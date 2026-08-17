// pages/advice/advice.js
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const foodvision = require('../../utils/foodvision.js');
const MEAL_TYPES = ['早餐', '午餐', '晚餐', '加餐', '蔬果'];
// 餐次图标 / 底色（对齐参考文件建议页）—— 图标名对应 assets/icons/i-{name}.png
const MEAL_ICON = { '早餐': 'breakfast', '午餐': 'lunch', '晚餐': 'dinner', '加餐': 'snack', '蔬果': 'veg' };
const MEAL_BG = { '早餐': '#FDF1D6', '午餐': '#E6F9F1', '晚餐': '#E6EDFE', '加餐': '#FFEDE3', '蔬果': '#F1E9FF' };

// 根据目标估算每日建议摄入总热量（用于环形图满值）
function intakeTargetOf(goal) {
  return goal === '增肌' ? 2400 : (goal === '减脂' || goal === '减重') ? 1800 : 2100;
}

// 日期工具：meal.time 为时间戳，换算为 YYYY-MM-DD 便于按日期筛选
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function dateOf(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    tab: 'suggest',
    intakeTarget: 2100,
    mealType: '早餐',
    mealTypes: MEAL_TYPES,
    mealHead: null,
    recommends: [],
    records: [],
    totalCal: 0,
    // 饮食记录（按餐别分组 + 今日汇总）
    mealSections: [
      { key: '早餐', icon: 'breakfast', items: [], subCal: 0 },
      { key: '午餐', icon: 'lunch', items: [], subCal: 0 },
      { key: '晚餐', icon: 'dinner', items: [], subCal: 0 },
      { key: '加餐', icon: 'snack', items: [], subCal: 0 }
    ],
    dietSummary: { cal: 0, p: 0, c: 0, f: 0 },
    // 环形图 / 剩余热量 / 明细计数
    ringPct: 0,
    remain: 0,
    totalItems: 0,
    // 饮食记录日期筛选（空 = 今天）
    dietDate: '',
    isToday: true,
    showAdd: false,
    addType: '早餐',
    editingId: null,
    recName: '', recCalories: '', recProtein: '', recCarb: '', recFat: '', recPortion: '', recNote: '',
    recognizing: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 首次进入默认看「今天」，之后保留用户所选日期（切 tab 不重置）
    if (!this.data.dietDate) this.setData({ dietDate: todayStr() });
    // 预览同款：每日建议摄入总热量（环形图满值）
    const intakeTarget = intakeTargetOf(store.get().profile.goal);
    this.setData({ intakeTarget });
    this.loadRecommend();
    this.loadRecords();
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  switchMeal(e) {
    this.setData({ mealType: e.currentTarget.dataset.type }, () => this.loadRecommend());
  },

  loadRecommend() {
    const list = (mock.dietRecommend[this.data.mealType] || []).map(m =>
      Object.assign({}, m)
    );
    const total = list.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    const cur = this.data.mealType;
    this.setData({
      recommends: list,
      mealHead: {
        icon: MEAL_ICON[cur] || '🍽️',
        name: cur,
        bg: MEAL_BG[cur] || '#F2F4F7',
        kcalText: total ? ('约 ' + total + ' 千卡') : '暂无推荐'
      }
    });
  },

  // 饮食记录：按早/午/晚/加餐分组 + 计算所选日期的汇总（环形 + 营养素）
  loadRecords() {
    const date = this.data.dietDate || todayStr();
    const all = store.get().meals;
    const meals = all.filter(m => dateOf(m.time) === date);
    const sections = this.data.mealSections.map(s => {
      const items = meals.filter(m => m.type === s.key);
      const subCal = items.reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
      return Object.assign({}, s, {
        items, subCal,
        bg: MEAL_BG[s.key] || '#F2F4F7',
        icon: MEAL_ICON[s.key] || '🍽️'
      });
    });
    const sum = meals.reduce((acc, m) => {
      acc.cal += Number(m.calories) || 0;
      acc.p += Number(m.protein) || 0;
      acc.c += Number(m.carb) || 0;
      acc.f += Number(m.fat) || 0;
      return acc;
    }, { cal: 0, p: 0, c: 0, f: 0 });
    const target = this.data.intakeTarget || intakeTargetOf(store.get().profile.goal);
    const cal = sum.cal;
    const ringPct = target ? Math.min(100, Math.round(cal / target * 100)) : 0;
    const remain = Math.max(0, target - cal);
    const totalItems = sections.reduce((s, x) => s + x.items.length, 0);
    this.setData({
      mealSections: sections,
      dietSummary: sum,
      totalCal: sum.cal,
      isToday: date === todayStr(),
      ringPct,
      remain,
      totalItems
    });
  },

  /* ---------- 饮食记录日期筛选 ---------- */
  onDietDateChange(e) {
    this.setData({ dietDate: e.detail.value }, () => this.loadRecords());
  },
  resetDietDate() {
    this.setData({ dietDate: todayStr() }, () => this.loadRecords());
  },

  addMeal(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const m = this.data.recommends.find(x => x.id === id);
    if (!m) return;
    store.addMeal({
      type: this.data.mealType,
      name: m.name,
      calories: m.calories,
      protein: m.protein,
      carb: m.carb,
      fat: m.fat
    });
    this.loadRecords();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  /* ---------- 饮食记录：添加 / AI识别 / 删除 ---------- */
  openAdd(e) {
    this.setData({
      showAdd: true,
      addType: e.currentTarget.dataset.type,
      editingId: null,
      recName: '', recCalories: '', recProtein: '', recCarb: '', recFat: '', recPortion: '', recNote: ''
    });
  },
  // 修改已记录项：预填数据并打开弹窗（editingId 标记进入更新模式）
  editRecord(e) {
    const id = e.currentTarget.dataset.id;
    const m = store.get().meals.find(x => x.id === id);
    if (!m) return;
    this.setData({
      showAdd: true,
      addType: m.type,
      editingId: id,
      recName: m.name,
      recCalories: m.calories ? String(m.calories) : '',
      recProtein: m.protein ? String(m.protein) : '',
      recCarb: m.carb ? String(m.carb) : '',
      recFat: m.fat ? String(m.fat) : '',
      recPortion: m.portion || '',
      recNote: m.note || ''
    });
  },
  closeAdd(e) {
    // 双保险：仅当直接点击遮罩本身（而非弹窗内容）时才关闭，避免输入/点击内容时误关
    if (e && e.target && e.currentTarget && e.target !== e.currentTarget) return;
    this.setData({ showAdd: false, editingId: null });
  },
  // 取消按钮：无条件关闭弹窗，绕开 closeAdd 的 target/currentTarget 守卫（原生 button 的 target 不恒定）
  cancelAdd() {
    this.setData({ showAdd: false, editingId: null });
  },
  noop() {},
  onRecInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  saveRecord() {
    if (!auth.requireLogin()) return;
    const d = this.data;
    const name = d.recName.trim();
    // 仅食物名称为必填项；热量/蛋白质/碳水/脂肪均为选填，留空则记 0
    if (!name) { wx.showToast({ title: '请输入食物名称', icon: 'none' }); return; }
    const patch = {
      type: d.addType,
      name: name,
      calories: Number(d.recCalories) || 0,
      protein: Number(d.recProtein) || 0,
      carb: Number(d.recCarb) || 0,
      fat: Number(d.recFat) || 0,
      portion: d.recPortion.trim(),
      note: d.recNote.trim()
    };
    if (d.editingId) {
      store.updateMeal(d.editingId, patch);
    } else {
      store.addMeal(patch);
    }
    // 新增的餐食记在「今天」，添加后切回今天视图以便看到刚记的条目；修改则保留当前筛选日期
    const addedNew = !d.editingId;
    this.setData({
      showAdd: false,
      editingId: null,
      dietDate: addedNew ? todayStr() : this.data.dietDate
    }, () => {
      this.loadRecords();
    });
    wx.showToast({ title: '已记录', icon: 'success' });
  },
  takePhoto() {
    if (this.data.recognizing) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (file) this.recognizeFood(file);
      }
    });
  },
  // AI 拍照识别：上传图片到视觉识别后端（Qwen-VL），返回营养数据回填表单
  recognizeFood(tempFilePath) {
    this.setData({ recognizing: true });
    wx.showLoading({ title: 'AI 识别中', mask: true });
    foodvision.analyzeImage(tempFilePath)
      .then((data) => {
        const foods = (data && data.foods) || [];
        if (!foods.length) {
          wx.hideLoading();
          this.setData({ recognizing: false });
          wx.showToast({ title: '未识别到食物，请手动填写', icon: 'none' });
          return;
        }
        const f = foods[0];
        const t = data.total || {};
        const pick = (a, b) => (a != null && a !== '' ? a : b);
        const cal = pick(f.calories, t.calories);
        const pro = pick(f.protein, t.protein);
        const car = pick(f.carb, t.carb);
        const fat = pick(f.fat, t.fat);
        wx.hideLoading();
        this.setData({
          recognizing: false,
          recName: f.name || '识别食物',
          recCalories: cal != null ? String(cal) : '',
          recProtein: pro != null ? String(pro) : '',
          recCarb: car != null ? String(car) : '',
          recFat: fat != null ? String(fat) : ''
        });
        wx.showToast({
          title: foods.length > 1 ? '识别' + foods.length + '种，已填第1种' : ('识别：' + (f.name || '食物')),
          icon: 'none'
        });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ recognizing: false });
        console.error('foodvision recognize failed', err);
        wx.showToast({ title: '识别失败，请手动填写', icon: 'none' });
      });
  },
  deleteRecord(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录', content: '确定删除这条饮食记录吗？',
      success: (r) => {
        if (r.confirm) {
          store.deleteMeal(id);
          this.loadRecords();
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      }
    });
  }
});

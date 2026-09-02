// pages/advice/advice.js —— 对齐 07-diet.html（HiLiLife 饮食建议）
// 顶部可在「饮食建议 / 饮食记录」间切换；
// 饮食建议页：按 早/中/晚/加餐/蔬果 5 类展示推荐食物（垂直卡片，含 cloud:// 真实图），点击 + 添加到对应餐别；
// 饮食记录页：顶部 今日摄入 + 三大营养素 + 5 餐分组，每条记录支持 修改 / 删除；每餐下方「添加食物」可走 AI 识别拍照（内联）或手动输入。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const media = require('../../utils/media.js').media;
const vision = require('../../utils/foodvision.js');

// 每日宏量营养素建议（g），对齐 07-diet.html 营养概览数值
const MACRO_GOAL = { p: 140, c: 220, f: 70 };
const COLOR = { p: '#6F9F00', c: '#FF9500', f: '#FFB020' }; // 蛋白质/碳水/脂肪 配色

// 每日建议摄入总热量（环形图满值），按目标微调
function intakeTargetOf(goal) {
  return goal === '增肌' ? 2400 : (goal === '减脂' || goal === '减重') ? 1800 : 2100;
}

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

// 饮食记录餐别（顺序固定，即便当天为空也展示，方便添加）；含 蔬果 分类
const MEAL_DEFS = [
  { type: '早餐', icon: 'food-egg' },
  { type: '午餐', icon: 'food-rice' },
  { type: '晚餐', icon: 'food-bowl' },
  { type: '加餐', icon: 'food-noodle' },
  { type: '蔬果', icon: 'food-salad' }
];

// 推荐食物：按 早/中/晚/加餐/蔬果 5 分类，每类多条 cloud:// 真实图（来自 mock.js dietRecommend）
// 数据源：mock.js dietRecommend（图片路径已与云存储目录一致：images/food/<name>.jpg）
// 这里内嵌以便 advice 页自包含（数据规模小、无副作用）
const FOOD_GROUPS = [
  {
    key: '早餐',
    foods: [
      { id: 'm1', name: '燕麦 + 鸡蛋', calories: 260, protein: 18, carb: 30, fat: 8, desc: '慢碳提供持久能量，鸡蛋补充优质蛋白。', image: '/images/food/food_oatmeal_egg.jpg' },
      { id: 'm2', name: '无糖酸奶 + 蓝莓', calories: 190, protein: 12, carb: 24, fat: 5, desc: '益生菌助消化，抗氧化物丰富。', image: '/images/food/food_yogurt_berry.jpg' },
      { id: 'm3', name: '全麦吐司 + 生菜蛋', calories: 260, protein: 15, carb: 32, fat: 8, desc: '全麦膳食纤维饱腹，搭配蔬果更均衡。', image: '/images/food/food_toast_egg.jpg' },
      { id: 'm4', name: '鸡胸肉沙拉杯', calories: 320, protein: 30, carb: 18, fat: 10, desc: '高蛋白低脂，适合减脂期。', image: '/images/food/food_chicken_salad.jpg' },
      { id: 'm5', name: '鸡蛋白 + 小番茄', calories: 150, protein: 14, carb: 8, fat: 4, desc: '纯蛋白补给，热量极低。', image: '/images/food/food_egg_tomato.jpg' },
      { id: 'm6', name: '玉米 + 无糖豆浆', calories: 240, protein: 13, carb: 38, fat: 4, desc: '优质植物蛋白与粗粮组合。', image: '/images/food/food_corn_soy.jpg' },
      { id: 'm7', name: '红薯 + 水煮蛋', calories: 260, protein: 14, carb: 36, fat: 6, desc: '低 GI 碳水，稳定血糖。', image: '/images/food/food_sweetpotato.jpg' },
      { id: 'm8', name: '牛奶燕麦杯', calories: 260, protein: 16, carb: 30, fat: 8, desc: '钙与蛋白双补，方便携带。', image: '/images/food/food_oatmeal_egg.jpg' },
      { id: 'm9', name: '苹果 + 原味酸奶', calories: 190, protein: 10, carb: 28, fat: 4, desc: '轻负担早餐，富含果胶。', image: '/images/food/food_yogurt_berry.jpg' },
      { id: 'm10', name: '鸡肉生菜卷', calories: 320, protein: 28, carb: 20, fat: 12, desc: '用生菜替代面饼，碳水更低。', image: '/images/food/food_chicken_salad.jpg' }
    ]
  },
  {
    key: '午餐',
    foods: [
      { id: 'd1', name: '糙米饭 + 煎鸡胸 + 西兰花', calories: 480, protein: 42, carb: 45, fat: 12, desc: '标准减脂餐，蛋白足、碳水稳。', image: '/images/food/food_rice_chicken.jpg' },
      { id: 'd2', name: '荞麦面 + 牛肉片 + 菠菜', calories: 520, protein: 38, carb: 55, fat: 14, desc: '荞麦低 GI，补铁又饱腹。', image: '/images/food/food_noodle_beef.jpg' },
      { id: 'd3', name: '紫薯 + 清蒸鱼 + 芦笋', calories: 430, protein: 40, carb: 40, fat: 10, desc: '优质脂肪酸与蛋白来源。', image: '/images/food/food_fish_veg.jpg' }
    ]
  },
  {
    key: '晚餐',
    foods: [
      { id: 'e1', name: '鸡胸豆腐汤 + 凉拌黄瓜', calories: 300, protein: 32, carb: 14, fat: 10, desc: '清淡低卡，减轻夜间负担。', image: '/images/food/food_tofu_soup.jpg' },
      { id: 'e2', name: '虾仁炒蛋 + 半根玉米', calories: 360, protein: 34, carb: 22, fat: 14, desc: '高蛋白低脂，恢复肌肉。', image: '/images/food/food_shrimp_egg.jpg' },
      { id: 'e3', name: '牛肉沙拉 + 油醋汁', calories: 380, protein: 36, carb: 16, fat: 18, desc: '晚间少碳水，保留优质脂肪。', image: '/images/food/food_beef_salad.jpg' }
    ]
  },
  {
    key: '加餐',
    foods: [
      { id: 'n1', name: '原味坚果一小把', calories: 160, protein: 6, carb: 6, fat: 14, desc: '健康脂肪补给，控制分量。', image: '/images/food/food_nuts.jpg' },
      { id: 'n2', name: '香蕉 + 乳清蛋白', calories: 220, protein: 27, carb: 28, fat: 2, desc: '训练前后快速补充。', image: '/images/food/food_banana_shake.jpg' },
      { id: 'n3', name: '无糖豆浆一杯', calories: 90, protein: 9, carb: 6, fat: 4, desc: '低卡植物蛋白。', image: '/images/food/food_corn_soy.jpg' }
    ]
  },
  {
    key: '蔬果',
    foods: [
      { id: 'v1', name: '西兰花', calories: 35, protein: 3, carb: 7, fat: 0, desc: '低卡高纤维，减脂必备。', image: '/images/food/food_rice_chicken.jpg' },
      { id: 'v2', name: '小番茄', calories: 18, protein: 1, carb: 4, fat: 0, desc: '富含番茄红素，热量极低。', image: '/images/food/food_egg_tomato.jpg' },
      { id: 'v3', name: '牛油果半个', calories: 120, protein: 1, carb: 6, fat: 11, desc: '优质单不饱和脂肪。', image: '/images/food/food_avocado.jpg' },
      { id: 'v4', name: '蓝莓', calories: 57, protein: 1, carb: 14, fat: 0, desc: '抗氧化水果，控量食用。', image: '/images/food/food_yogurt_berry.jpg' }
    ]
  }
];

// id → 食物（含所属餐别 type），供点击添加/查表
const FOOD_MAP = {};
FOOD_GROUPS.forEach(g => g.foods.forEach(f => { FOOD_MAP[f.id] = Object.assign({}, f, { type: g.key }); }));

// 根据食物名猜测一个 emoji 缩略图（无真实图时更贴近预览视觉），AI 识别结果缩略用
function emojiFor(name) {
  const n = name || '';
  if (/鸡|牛|羊|猪|肉|鱼|虾|蟹|蛋|腿|排/.test(n)) return '🍗';
  if (/沙拉|菜|蔬|草|萝卜|瓜/.test(n)) return '🥗';
  if (/饭|米|面|包|碳|薯|馒|饼/.test(n)) return '🍚';
  if (/奶|豆|酸奶|豆浆|奶酪/.test(n)) return '🥛';
  if (/果|苹|香|橙|莓|梨|桃/.test(n)) return '🍎';
  if (/汤|粥|羹/.test(n)) return '🍲';
  return '🍽️';
}

Page({
  data: {
    view: 'advice',
    todayDate: todayStr(),
    selectedDate: todayStr(),
    intakeLabel: '今日摄入',
    intakeTarget: 2100,
    intakePct: 0,
    ringStyle: '--pct: 0',
    nutrients: [
      { key: '蛋白质', goal: MACRO_GOAL.p, swatchStyle: 'background:' + COLOR.p },
      { key: '碳水', goal: MACRO_GOAL.c, swatchStyle: 'background:' + COLOR.c },
      { key: '脂肪', goal: MACRO_GOAL.f, swatchStyle: 'background:' + COLOR.f }
    ],
    // 饮食建议：5 类筛选 + 当前类食物（cloud:// 已解析）
    categoryKeys: FOOD_GROUPS.map(g => g.key),
    currentCategory: '早餐',
    currentFoods: [],
    // 饮食记录视图
    mealGroups: [],
    showAddSheet: false,
    addType: '早餐',
    showManual: false,
    editingMealId: '',
    recognizing: false,
    recResult: null,
    form: { name: '', portion: 1, calories: '', protein: '', carb: '', fat: '' }
  },

  onShow() {
    // 非 tab 页，不高亮底部栏
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: -1 });
    }
    this.refresh();
  },

  // 切换 饮食建议 / 饮食记录 视图
  switchView(e) {
    this.setData({ view: e.currentTarget.dataset.view });
  },

  // 依据选中日期的饮食记录聚合：完成度环 + 三大营养素缺口 + 五餐分组
  refresh() {
    const st = store.get();
    const goal = (st.profile && st.profile.goal) || '维持';
    const intakeTarget = intakeTargetOf(goal);
    const date = this.data.selectedDate || todayStr();
    const meals = (st.meals || []).filter(m => dateOf(m.time) === date);
    const sum = meals.reduce((a, m) => {
      a.cal += Number(m.calories) || 0;
      a.p += Number(m.protein) || 0;
      a.c += Number(m.carb) || 0;
      a.f += Number(m.fat) || 0;
      return a;
    }, { cal: 0, p: 0, c: 0, f: 0 });

    const intakePct = intakeTarget ? Math.min(100, Math.round(sum.cal / intakeTarget * 100)) : 0;

    // 五餐分组（顺序见 MEAL_DEFS），每条记录带名称与四营养素，合计本餐 kcal
    const mealGroups = MEAL_DEFS.map(d => {
      const list = meals
        .filter(m => m.type === d.type)
        .sort((a, b) => (a.time || 0) - (b.time || 0))
        .map(m => ({
          id: m.id,
          name: m.name,
          portion: Number(m.portion) || 1,
          calories: Number(m.calories) || 0,
          protein: Number(m.protein) || 0,
          carb: Number(m.carb) || 0,
          fat: Number(m.fat) || 0
        }));
      const total = list.reduce((s, m) => s + m.calories, 0);
      return Object.assign({}, d, { meals: list, total });
    });

    // 推荐食物：取当前选中分类，映射 cloud:// 真实图
    const cur = this.data.currentCategory || '早餐';
    const group = FOOD_GROUPS.find(g => g.key === cur) || FOOD_GROUPS[0];
    const currentFoods = group.foods.map(f => Object.assign({}, f, { img: media(f.image) }));

    const isToday = date === todayStr();

    // 三大营养素进度（占建议值比例，封顶 100%），供 Hero 进度条着色，与营养概览 swatch 同色系
    const macroDefs = [
      { key: '蛋白质', val: sum.p, goal: MACRO_GOAL.p, color: COLOR.p },
      { key: '碳水', val: sum.c, goal: MACRO_GOAL.c, color: COLOR.c },
      { key: '脂肪', val: sum.f, goal: MACRO_GOAL.f, color: COLOR.f }
    ];
    const macros = macroDefs.map(m => {
      const pct = m.goal ? Math.min(100, Math.round(m.val / m.goal * 100)) : 0;
      return { key: m.key, val: m.val, goal: m.goal, color: m.color, fillStyle: 'width:' + pct + '%' };
    });

    this.setData({
      intakeTarget, intakePct, ringStyle: '--pct: ' + intakePct, mealGroups, currentFoods,
      intakeSum: sum,  // 饮食记录页 hero 用
      macros,
      todayDate: todayStr(),
      selectedDate: date,
      intakeLabel: isToday ? '今日摄入' : '摄入'
    });
  },

  // 日期筛选：点击 Hero 右侧日期 → 原生日期选择器 → 重算该日摄入与分组
  onDateChange(e) {
    const d = e.detail.value; // YYYY-MM-DD
    if (!d) return;
    this.setData({ selectedDate: d });
    this.refresh();
  },

  // 当前视图日期对应的记录时间戳：今天用 now；历史日固定到当天正午，便于回看 / 补录
  mealTimeFor(dateStr) {
    if (dateStr === todayStr()) return Date.now();
    const t = Date.parse(dateStr + 'T12:00:00');
    return isNaN(t) ? Date.now() : t;
  },

  // 切换推荐分类（早/中/晚/加餐/蔬果）
  switchCategory(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.currentCategory) return;
    const group = FOOD_GROUPS.find(g => g.key === key) || FOOD_GROUPS[0];
    const currentFoods = group.foods.map(f => Object.assign({}, f, { img: media(f.image) }));
    this.setData({ currentCategory: key, currentFoods });
  },

  // 推荐食物：点击写入所属餐别（按 FOOD_MAP.id.type），随后刷新汇总
  addFood(e) {
    const id = e.currentTarget.dataset.id;
    if (!auth.requireLogin()) return;
    const f = FOOD_MAP[id];
    if (!f) return;
    store.addMeal({
      type: f.type,
      name: f.name,
      calories: f.calories,
      protein: f.protein,
      carb: f.carb,
      fat: f.fat,
      portion: 1,
      time: this.mealTimeFor(this.data.selectedDate)
    });
    this.refresh();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  /* ---------- 添加食物（sheet + 手动输入） ---------- */
  // 打开「添加方式」选择：记录到指定餐别
  openAdd(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ addType: type, showAddSheet: true });
  },
  closeAdd() { this.setData({ showAddSheet: false }); },
  noop() {},

  // 选择 AI 识别拍照 或 手动输入
  chooseAdd(e) {
    const way = e.currentTarget.dataset.way;
    this.setData({ showAddSheet: false });
    if (way === 'ai') {
      // 直接调用视觉识别（相机/相册 → 识别 → 记录到当前餐别），不再跳转页面
      this.startAI();
    } else {
      this.setData({ showManual: true });
    }
  },

  // 手动表单输入（通用字段绑定）
  onForm(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },
  closeManual() { this.setData({ showManual: false, editingMealId: '' }); },

  // 编辑某条饮食记录：把 meal 当前值塞入表单，打开手动 modal
  editMeal(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const meal = (store.get().meals || []).find(m => m.id === id);
    if (!meal) return;
    this.setData({
      editingMealId: id,
      addType: meal.type || '早餐',
      form: {
        name: meal.name || '',
        portion: meal.portion || 1,
        calories: meal.calories != null ? String(meal.calories) : '',
        protein: meal.protein != null ? String(meal.protein) : '',
        carb: meal.carb != null ? String(meal.carb) : '',
        fat: meal.fat != null ? String(meal.fat) : ''
      },
      showManual: true
    });
  },

  // 删除某条饮食记录：弹确认 → store.deleteMeal → 刷新 + toast
  deleteMeal(e) {
    if (!auth.requireLogin()) return;
    const id = e.currentTarget.dataset.id;
    const meal = (store.get().meals || []).find(m => m.id === id);
    if (!meal) return;
    wx.showModal({
      title: '删除记录',
      content: '确定删除「' + (meal.name || '该记录') + '」？',
      confirmText: '删除',
      confirmColor: '#E54848',
      success: (res) => {
        if (!res.confirm) return;
        store.deleteMeal(id);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  // 保存手动记录到当前餐别（add 或 update 取决于 editingMealId）
  saveManual() {
    if (!auth.requireLogin()) return;
    const f = this.data.form;
    const name = (f.name || '').trim();
    if (!name) { wx.showToast({ title: '请输入食物名称', icon: 'none' }); return; }
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const portion = Math.max(1, Math.round(num(f.portion) || 1));
    const patch = {
      type: this.data.addType,
      name: name,
      portion: portion,
      calories: num(f.calories),
      protein: num(f.protein),
      carb: num(f.carb),
      fat: num(f.fat)
    };
    if (this.data.editingMealId) {
      store.updateMeal(this.data.editingMealId, patch);
    } else {
      store.addMeal(Object.assign({}, patch, { time: this.mealTimeFor(this.data.selectedDate) }));
    }
    this.setData({
      showManual: false,
      editingMealId: '',
      form: { name: '', portion: 1, calories: '', protein: '', carb: '', fat: '' }
    });
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  /* ---------- AI 识别拍照（内联，直接调用视觉识别） ---------- */
  // 打开相机/相册后直接识别，结果记录到当前餐别（addType），全程不离开本页
  startAI() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (r) => {
        const f = (r.tempFiles && r.tempFiles[0]) || {};
        if (f.tempFilePath) this.runRecognize(f.tempFilePath);
      },
      fail: () => {}
    });
  },

  runRecognize(path) {
    this.setData({ recognizing: true, recResult: null });
    vision.analyzeImage(path)
      .then((res) => {
        const r = res || {};
        const foods = (r.foods || []).map(f => Object.assign({}, f, { emoji: emojiFor(f.name) }));
        this.setData({ recognizing: false, recResult: Object.assign({}, r, { foods }) });
      })
      .catch((err) => {
        this.setData({ recognizing: false });
        const msg = (err && (err.errMsg || err.message)) || '识别失败，请重试';
        wx.showToast({ title: '识别失败', icon: 'none' });
      });
  },

  // 记录单条识别结果到当前餐别
  recRecordOne(e) {
    if (!auth.requireLogin()) return;
    const idx = e.currentTarget.dataset.idx;
    const foods = (this.data.recResult && this.data.recResult.foods) || [];
    const f = foods[idx];
    if (!f) return;
    store.addMeal({
      type: this.data.addType,
      name: f.name,
      calories: f.calories,
      protein: f.protein,
      carb: f.carb,
      fat: f.fat,
      time: this.mealTimeFor(this.data.selectedDate)
    });
    this.refresh();
    wx.showToast({ title: '已记录', icon: 'success' });
  },

  // 批量记录全部识别结果
  recRecordAll() {
    if (!auth.requireLogin()) return;
    const foods = (this.data.recResult && this.data.recResult.foods) || [];
    if (!foods.length) return;
    const type = this.data.addType;
    const t = this.mealTimeFor(this.data.selectedDate);
    foods.forEach((f) => store.addMeal({
      type, name: f.name, calories: f.calories, protein: f.protein, carb: f.carb, fat: f.fat, time: t
    }));
    this.refresh();
    wx.showToast({ title: `已记录 ${foods.length} 项`, icon: 'success' });
    this.setData({ recResult: null });
  },

  closeRec() { this.setData({ recResult: null }); }
});

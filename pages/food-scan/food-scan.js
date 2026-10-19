// pages/food-scan/food-scan.js —— 拍照识别（对齐 08-拍照识别 / 09-食物识别结果 设计稿）
// 流程：进入全屏取景（live camera + cover-view 覆盖层）→ 快门/相册 → AI 识别 → 结果弹层（09）
//      → 重新识别（回取景）/ 加入记录（写入今日饮食并返回）
// A3：结果可逐项纠正 → 纠正写入本地知识库 → 下次同款识别直接套用你的修正值
// ⚠️ camera 是原生组件：取景框、按钮等覆盖物必须用 cover-view（真机普通 view 压不住原生层）；
//     结果/历史页用普通 view（此时相机已 wx:if 卸载，无原生层遮挡问题）。
//
// ── A3 三条关键口径（改之前先读，每条都是有意为之） ──────────────────────
// ① **知识库签名取 `_raw`（模型的原始返回），不是纠正后的名字。**
//    下次能被看到的仍然只有模型的原始返回，签名必须由它算出来才对得上。
//    所以纠正后的名字只作为 `displayName` 存下来给人看，不参与定键。
// ② **套用历史修正值时只覆盖「有值」的字段。**
//    `foodkb` 刻意用 null 区分「0」与「未知」；拿 null 盖掉模型给的值
//    等于把已有信息变成没信息 —— 那是降级，不是修正。
// ③ **`KB_HIT`（省下一次调用）只在手动输入命中时记，本页不记。**
//    本页的复用在模型跑完之后，钱已经花了，走 `VISION_REUSED`。
//    把两者混在一起，就是把「准确率」谎报成「成本节省」。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const vision = require('../../utils/foodvision.js');
const theme = require('../../utils/theme.js');
const foodkb = require('../../utils/foodkb.js');
const navMetrics = require('../../utils/navMetrics.js');
const privacy = require('../../utils/privacy.js');
const metrics = require('../../utils/metrics.js');

const HISTORY_KEY = 'hh_food_scan_history';

// confidence 低于此值就提示核对。0.6 是经验阈值：再低基本是「猜的」，
// 这时最该做的不是让用户相信数字，而是明确告诉他不可信。
const LOW_CONF = 0.6;

/**
 * 可纠正的数值字段 —— **单源**：WXML 的 `data-field` 与这里的键一一对应。
 * max 不是摆设：纠正值会写进知识库并在以后**自动复用**，
 * 一个打错的「3600 蛋白质」会在之后每次识别时被静默套用 —— 必须在入口拦住。
 */
const NUM_FIELDS = {
  kcal:    { label: '热量',      unit: 'kcal', max: 5000 },
  protein: { label: '蛋白质',    unit: 'g',    max: 1000 },
  carb:    { label: '碳水化合物', unit: 'g',    max: 1000 },
  fat:     { label: '脂肪',      unit: 'g',    max: 1000 }
};

// 按当前小时推断默认餐别
function mealByHour(h) {
  if (h < 11) return '早餐';
  if (h < 14) return '午餐';
  if (h < 20) return '晚餐';
  return '加餐';
}

/**
 * 解析用户输入：空 → `{ val: null }`（未知）；非数字/越界 → `{ bad: true }`；
 * 正常 → `{ val: 整数 }`。用对象而不是 NaN 当哨兵，是为了让「空」和「非法」
 * 在调用点必须分开处理 —— `isNaN(null)` 是 false，一个 NaN 哨兵会把
 * 「用户没填」当成「填错了」。
 */
function parseNum(txt, max) {
  const t = String(txt == null ? '' : txt).trim();
  if (!t) return { val: null };
  const n = Number(t);
  if (!isFinite(n) || n < 0 || n > max) return { bad: true };
  return { val: Math.round(n) };
}

/**
 * 识别中的阶段提示。为什么要按秒升级文案：
 * 识别走的是「提交任务 → 轮询」的异步链路，模型通常 3~10s，慢时能到几十秒。
 * 原先整段只有一句静态「AI 识别中…」，用户等 20 秒得不到任何反馈，
 * 体感就从「慢」变成「卡死了 / 识别不出来」——**感知的一半是反馈，不是速度**。
 * 最后一段要给出「可以不等」的出口，避免让人被困在一个可能还要等一分钟的页面里。
 */
const AN_TIPS = [
  [8, '正在分析食物营养'],
  [20, '还在识别，请稍候（模型较慢）'],
  [Infinity, '还在识别…可以继续等，或返回后手动填写热量']
];

function anTipFor(sec) {
  for (let i = 0; i < AN_TIPS.length; i++) {
    if (sec < AN_TIPS[i][0]) return AN_TIPS[i][1];
  }
  return AN_TIPS[AN_TIPS.length - 1][1];
}

/**
 * 派生态：营养行**必须由源值同算**，不能在 setData 时手工维护。
 * 本项目已经踩过一次「派生态与源数据不同算」→ 改完 kcal 行上还留着旧数值。
 */
function buildNutri(p) {
  p.nutri = [
    { k: 'kcal',    label: '热量',       unit: 'kcal', val: p.kcal,    dot: 'dot-kcal' },
    { k: 'protein', label: '蛋白质',     unit: 'g',    val: p.protein, dot: 'dot-pro' },
    { k: 'carb',    label: '碳水化合物', unit: 'g',    val: p.carb,    dot: 'dot-carb' },
    { k: 'fat',     label: '脂肪',       unit: 'g',    val: p.fat,     dot: 'dot-fat' }
  ];
  return p;
}

Page({
  data: {
    theme: 'theme-light',
    view: 'camera',       // camera=取景 | analyzing=识别中 | result=识别结果 | history=识别历史
    flash: false,         // 闪光灯（torch）
    camError: false,      // 相机权限被拒/不可用
    statusBarStyle: 'height: 0px',
    // 顶部导航带的两串行内样式（见 utils/navMetrics.js）。它们同时管两件事：
    //   ① 横向 —— 给微信系统胶囊「··· ⊙」让位（不让位则控件被系统截走触摸、点不到）；
    //   ② 纵向 —— 行高钉成导航带 = 2×(胶囊上沿 − 状态栏) + 胶囊高，让行**与胶囊同心**。
    // ⚠️ 本页顶部行有三处、形态分两类：结果/历史态是常流里的行（navRowStyle），
    //    取景态是 <camera> 上的绝对定位覆盖层（camRowStyle，必须自带 top）。
    //    三处都吃这两个值之一 —— 漏一处就是「差半个行高」或「压进状态栏」。
    navRowStyle: '',
    camRowStyle: '',
    photo: null,          // 识别结果 {name, kcal, weight, protein, carb, fat, confText, items[], img, nutri[], canEdit, edited, reused, lowConf}
    history: [],          // 识别历史（本地存储，仅文字/数字字段）
    anSec: 0,             // 识别中已用秒数（给用户一个「它在动」的证据）
    anTip: AN_TIPS[0][1], // 识别中阶段文案（见 AN_TIPS）
    kbSize: 0,            // A3：本地知识库已记条目数
    kbSaved: 0            // A3：本周命中知识库、因而**没有调用模型**的次数
  },

  onLoad() {
    // 顶部三条内边距都从 navMetrics 取 —— 状态栏高度、导航带高、胶囊让位量是同一套窗口度量，
    // 本页不再自己读一份 getWindowInfo（那正是「第二份实现」，会各走各的兜底值）。
    this.setData({ statusBarStyle: 'height: ' + navMetrics.statusBarHeight() + 'px' });
    this.setData({ navRowStyle: navMetrics.topRowStyle() });
    this.setData({ camRowStyle: navMetrics.overlayRowStyle() });
    this.setData({ history: this.loadHistory() });
    this.syncKb();
    // 预热识别服务：云托管缩容后第一次请求要拉起实例（10s+，callContainer 15s 就会掐死）。
    // 在 onLoad 就打一次 /health（fire-and-forget），冷启动消耗在用户取景/拍照期间烧掉，
    // 真正 submit 时实例已热 —— 这是「第一次识别必失败/必慢」的主要解药。
    try { vision.warmUp(); } catch (e) {}
  },

  onShow() {
    // 主题：同步自身（「我的 → 深色主题」开关持久化在 Storage）。
    // 取景态本就是原生暗色设计（.page-dark），主题类主要影响结果/历史态（var(--n-50) 系）
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: -1 }); // 非 tab 页，不高亮
    }
    this.syncKb();
  },

  // 页面销毁时一定要停掉计时器：setInterval 不会随页面卸载自动消失，
  // 留着它就是一个对已销毁实例的 setData，静默报错且每秒一次。
  onUnload() { this._stopAnTimer(); },

  // 知识库状态。数据量极小（一次 size + 一次区间聚合），onShow 里同步读不会拖慢页面。
  // 两个模块的存储访问内部都已吞异常，这里再兜一层：展示性数据不该让页面起不来。
  syncKb() {
    let n = 0;
    let saved = 0;
    try {
      n = foodkb.size();
      const w = metrics.week();
      saved = (w.ev && w.ev[metrics.EVENTS.KB_HIT]) || 0;
    } catch (e) {}
    this.setData({ kbSize: n, kbSaved: saved });
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
  // 先过隐私授权：用户拒绝后 wx.chooseMedia 只会**静默失败**（点了完全没反应），
  // 由 utils/privacy.js 统一给一句人话说明，并留一次重新授权的机会。
  pickAlbum() {
    if (this._busy) return;
    privacy.ensure('从相册选图识别食物').then((ok) => {
      if (!ok) return;
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

  /**
   * 识别中计时器：每秒刷新已用秒数与阶段文案。
   *
   * 为什么非要让它动起来：识别走「提交任务 → 轮询」，模型常 3~10s、慢时几十秒。
   * 原先整页只有一句静态「AI 识别中…」，等 20s 得不到任何新信息，
   * 体感就从「慢」变成「卡死了 / 识别不出来」。**感知的一半来自反馈，不是速度本身。**
   * 粒度刻意取 1s：够消除「卡死」感，又不至于给一个正在等的人额外加渲染负担。
   */
  _startAnTimer() {
    this._stopAnTimer();
    const t0 = Date.now();
    this._anTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      this.setData({ anSec: sec, anTip: anTipFor(sec) });
    }, 1000);
  },

  _stopAnTimer() {
    if (this._anTimer) { clearInterval(this._anTimer); this._anTimer = null; }
  },

  analyze(tempFilePath) {
    // 每次识别领一个自增号。取消或再次识别都会让号前进，在途回调据此作废 ——
    // 否则「取消后请求才返回」会把用户又拽回结果页，看起来像页面自己在跳。
    const id = (this._anId = (this._anId || 0) + 1);
    this._busy = true;
    this._lastImg = tempFilePath;   // 失败弹窗的「重试」用同一张图再跑，不必逼用户重拍
    this.setData({ view: 'analyzing', anSec: 0, anTip: anTipFor(0) });
    this._startAnTimer();
    const t0 = Date.now();
    // 记在「发起」而不是「成功」：识别失败也是真花了钱 —— 按次计费的调用已经发生
    metrics.inc(metrics.EVENTS.VISION_START);
    vision.analyzeImage(tempFilePath).then((raw) => {
      if (id !== this._anId) return;   // 已被取消：结果作废，不落任何界面
      this._busy = false;
      this._stopAnTimer();
      if (!raw || raw.success === false) {
        throw new Error((raw && raw.note) || '未识别出食物，请靠近重拍');
      }
      metrics.inc(metrics.EVENTS.VISION_OK);
      // 耗时只累加成功路径：visionAvgSec 的分母是成功次数，而失败最坏会耗到
      // 轮询超时（约 90s），混进来会把均值带成一个没有意义的数。
      metrics.addMs(metrics.EVENTS.VISION_MS, Date.now() - t0);

      const conf = (raw.confidence != null && raw.confidence !== '') ? Number(raw.confidence) : null;
      const pct = conf != null ? (conf <= 1 ? Math.round(conf * 100) : Math.round(conf)) : null;
      const pctNorm = conf != null ? (conf <= 1 ? conf : conf / 100) : null;
      const items = (raw.items || []).map(it => ({
        name: it.name || '食物',
        weight: (it.weight_g != null && it.weight_g !== '') ? it.weight_g + 'g' : '—'
      }));

      // 签名用「模型的原始返回」算（见文件头 ①）
      this._raw = {
        name: raw.name || '',
        items: (raw.items || []).map(it => ({ name: it.name }))
      };

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
        canEdit: true,      // 刚识别出的结果可纠正；历史回看不可（见 onPickHistory）
        edited: false,
        reused: false,      // 是否套用了你此前的修正值
        lowConf: pctNorm != null && pctNorm < LOW_CONF
      };

      // A3：套用此前的修正值（模型已跑完，没有省下调用 → 记 VISION_REUSED）
      const learned = foodkb.lookup(this._raw, false);
      if (learned) {
        if (learned.name) photo.name = learned.name;
        // 只覆盖「有值」的字段（见文件头 ②）
        if (learned.calories != null) photo.kcal = learned.calories;
        if (learned.protein != null) photo.protein = learned.protein;
        if (learned.carb != null) photo.carb = learned.carb;
        if (learned.fat != null) photo.fat = learned.fat;
        if (learned.weight != null) photo.weight = learned.weight;
        photo.reused = true;
        metrics.inc(metrics.EVENTS.VISION_REUSED);
      }

      buildNutri(photo);
      this.pushHistory(photo);
      this.setData({ photo: photo, view: 'result' });
    }).catch((err) => {
      if (id !== this._anId) return;   // 已取消：不弹失败、也不记一笔失败
      metrics.inc(metrics.EVENTS.VISION_FAIL);
      this._busy = false;
      this._stopAnTimer();
      this._raw = null;
      this.setData({ view: 'camera' });
      // 只弹 userMessage 翻好的人话。服务端的 err.message 是给运维排查用的
      // （可能含「去配哪个环境变量」），原样甩给用户既看不懂、也等于泄漏内部配置。
      console.warn('[food-scan] 识别失败', err && err.code, err);
      // 「重试」只在该重试有用时出现。给一个注定失败的按钮，用户会连点几次、
      // 每次等满轮询窗口，最后得出的结论是「这功能就是坏的」—— 比不给更伤。
      const canRetry = vision.isRetryable(err);
      wx.showModal({
        title: '识别失败',
        content: vision.userMessage(err)
          + (canRetry ? '' : '\n\n（这属于识别服务侧的问题，重拍也解决不了，建议手动填写热量）'),
        showCancel: canRetry,
        confirmText: canRetry ? '重试' : '知道了',
        cancelText: '取消',
        success: (r) => {
          if (canRetry && r.confirm && this._lastImg) this.analyze(this._lastImg);
        }
      });
    });
  },

  /**
   * 取消识别：作废在途回调（_anId 前进），回到取景。
   *
   * 为什么识别中那页必须留出口：轮询窗口最长 70s，没有出口就是把人困住 ——
   * 而阶段文案里写着「可以返回后手动填写热量」，一个没有返回入口的页面
   * 会把那句话变成实现不了的承诺。
   * 注意**不谎报**：请求已经发出、按次计费的调用可能已经发生，所以只作废界面回填，
   * 不去回滚已记的 VISION_START（成本是真的，不该在统计里消失）。
   */
  cancelAnalyze() {
    this._anId = (this._anId || 0) + 1;
    this._busy = false;
    this._stopAnTimer();
    this._raw = null;
    this.setData({ view: 'camera', anSec: 0 });
  },

  /* ---------- A3：纠错 ---------- */
  // ⚠️ 营养行在 WXML 里必须是**静态事件名** `bindtap="editNum"`。
  //    写成 `bindtap="{{photo.canEdit ? 'editNum' : ''}}"` 会被当成字面量事件名 ——
  //    点击**静默无反应且不报错**，静态扫描也看不出来。不能编辑时在这里直接返回。
  editNum(e) {
    const p = this.data.photo;
    if (!p || !p.canEdit) return;
    const f = e.currentTarget.dataset.field;
    const cfg = NUM_FIELDS[f];
    if (!cfg) return;
    openNumEditor(cfg, p[f], (val) => {
      const np = Object.assign({}, p);
      np[f] = val;
      np.edited = true;
      buildNutri(np);
      this.setData({ photo: np });
      metrics.inc(metrics.EVENTS.VISION_EDITED);
      this.learnFromPhoto(np);
    });
  },

  // 改菜名：模型常给泛称（「识别到的食物」），这是纠错里最值钱的一项 ——
  // 名字对了，历史记录和后续命中才有意义。
  editName() {
    const p = this.data.photo;
    if (!p || !p.canEdit) return;
    wx.showModal({
      title: '修改名称',
      content: '当前：' + p.name,
      editable: true,
      placeholderText: '输入正确的食物名称（最多 20 字）',
      success: (r) => {
        if (!r.confirm) return;
        const t = String(r.content == null ? '' : r.content).trim();
        if (!t) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        if (t.length > 20) { wx.showToast({ title: '名称最多 20 个字', icon: 'none' }); return; }
        const np = Object.assign({}, p, { name: t, edited: true });
        this.setData({ photo: np });
        metrics.inc(metrics.EVENTS.VISION_EDITED);
        this.learnFromPhoto(np);
      }
    });
  },

  // 纠正即学习：不等到「加入记录」才写。用户改完又反悔去重拍，
  // 那次纠正依然是有效知识（下次同款直接命中），没理由因为没落库就丢掉。
  learnFromPhoto(p) {
    if (!this._raw) return;   // 历史回看没有原始签名，不写库（防污染）
    const entry = foodkb.learn(this._raw, {
      calories: p.kcal, protein: p.protein, carb: p.carb, fat: p.fat, weight: p.weight
    }, p.name);
    if (entry) {
      metrics.inc(metrics.EVENTS.KB_LEARN);
      this.syncKb();          // 让「已记 N 条」当场 +1：改完看不见变化会让人以为没生效
    }
  },

  /* ---------- 识别历史 ---------- */
  loadHistory() {
    try { return wx.getStorageSync(HISTORY_KEY) || []; } catch (e) { return []; }
  },
  pushHistory(p) {
    const item = {
      ts: Date.now(), name: p.name, kcal: p.kcal, weight: p.weight,
      protein: p.protein, carb: p.carb, fat: p.fat, conf: p.confText
    };
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

  // 点历史项 → 以结果态查看。**只读**，这是有意为之：
  // ① 历史是「模型当时说了什么」的流水，改它既改不动已经落库的饮食记录，也纠正不了未来识别；
  // ② 历史项没有原始 items，无从计算签名 —— 若允许编辑，learn() 会拿**上一条识别的签名**
  //    去写库，直接把知识库指向错误的东西。
  // 因此这里清空 `_raw` 并置 `canEdit:false`：编辑入口连提示一起不显示，
  // 不做「诚实的残废入口」（点了没反应比没有入口更糟）。
  onPickHistory(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const it = this.data.history[idx];
    if (!it) return;
    this._raw = null;
    const photo = {
      name: it.name,
      kcal: it.kcal == null ? null : it.kcal,
      weight: it.weight == null ? '' : it.weight,
      protein: it.protein == null ? null : it.protein,
      carb: it.carb == null ? null : it.carb,
      fat: it.fat == null ? null : it.fat,
      confText: it.conf || '—',
      items: [],
      img: '',
      canEdit: false,
      edited: false,
      reused: false,
      lowConf: false
    };
    buildNutri(photo);
    this.setData({ photo: photo, view: 'result' });
  },

  /* ---------- 结果态 ---------- */
  backToCamera() { this.setData({ view: 'camera', photo: null }); },

  // 低置信度引导：条码需要外部食物库（成本高、不在本轮范围），
  // 所以只引导到**已经存在**的手动录入（「饮食记录」页 → 添加食物 → 手动输入），
  // 那条路径命中本地知识库时零模型调用。不承诺这里做不了的事。
  gotoManualHint() {
    wx.showModal({
      title: '手动录入',
      content: '到「饮食记录」页 → 对应餐别「添加食物」→ 手动输入。\n填过的食物会被记住，下次输入同名食物自动带出营养值，不消耗 AI 识别次数。',
      showCancel: false
    });
  },

  // 加入记录 / 完成：写入今日饮食并返回上一页（首页 onShow 自动刷新饮食卡）
  saveAndExit() {
    if (!auth.requireLogin()) return;
    const p = this.data.photo;
    if (!p || p.kcal == null) { wx.showToast({ title: '暂无热量数据', icon: 'none' }); return; }
    const type = mealByHour(new Date().getHours());
    const note = 'AI拍照估算' + (p.weight ? ' ' + p.weight + 'g' : '')
      + (p.edited ? '（已修正）' : '')
      + (p.reused ? '（套用本地修正值）' : '');
    store.addMeal({
      type: type,
      name: p.name,
      calories: p.kcal,
      protein: Math.round(p.protein || 0),
      carb: Math.round(p.carb || 0),
      fat: Math.round(p.fat || 0),
      note: note
    });
    wx.showToast({ title: '已记录到' + type, icon: 'success' });
    setTimeout(() => {
      wx.navigateBack({ fail: () => { wx.switchTab({ url: '/pages/advice/advice' }); } });
    }, 600);
  }
});

/**
 * 打开数值编辑弹窗。用原生 `wx.showModal({ editable })` 而不是自绘数字键盘：
 * 免去一层遮罩/焦点/深色对比度风险，且基础库 2.17.1+ 即支持（本项目 libVersion 3.0.0）。
 */
function openNumEditor(cfg, cur, onOk) {
  wx.showModal({
    title: '修改' + cfg.label,
    content: '当前 ' + (cur == null ? '未知' : cur + ' ' + cfg.unit),
    editable: true,
    placeholderText: '输入新的' + cfg.label + '（' + cfg.unit + '）',
    success: (r) => {
      if (!r.confirm) return;
      const txt = String(r.content == null ? '' : r.content).trim();
      // 空输入 = 放弃修改，而不是「清成未知」：手滑清空一个已确认的值是不可逆的
      // 信息损失。确实要标成未知，请显式输入 0（0 与未知在本项目里是两件事）。
      if (!txt) { wx.showToast({ title: '未输入数值，保持不变', icon: 'none' }); return; }
      const parsed = parseNum(txt, cfg.max);
      if (parsed.bad) {
        wx.showToast({ title: cfg.label + '需为 0–' + cfg.max + ' 的数字', icon: 'none' });
        return;
      }
      onOk(parsed.val);
    }
  });
}

// pages/workout/workout.js
// 训练执行页（全部动作可滚动列表 + 单卡展开，参考 ui-workout-redesign.html）
// 流程：进入页面全局计时暂停（顶部播放/暂停按钮控制，或点组 ✓ 自动启动）→ 逐动作卡片可展开 → 组数输入 kg/次 → 点 ✓ 完成该组
//   （若开启"每组计时"且未训练过，先跑 5秒准备+60秒训练计时，结束自动标记完成）→ 完成后弹组间/动作间休息
//   → 下一动作自动展开；全部完成保存入库。顶栏"完成"可随时结束并保存。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const { media, resolveUrl } = require('../../utils/media.js');
const exercises = require('../../utils/exercises.js');
const workoutSession = require('../../utils/workoutSession.js');
const theme = require('../../utils/theme.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtClock(sec) { sec = sec || 0; return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
// 替换/添加动作浮层：单次渲染的最大候选数（超出部分上拉加载更多），避免上千项一次性渲染超节点上限被截断
const REPL_PAGE = 120;
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 恢复历史会话时，把可能遗留的旧 OSS 绝对地址（阿里云到期）重新归一化到当前 R2：
//   - 任意 http(s) 绝对地址 → 提取相对路径，由 media() 按当前 MEDIA_BASE 重新拼（自动映射到 upscaled/、补 r2.dev 域名）
//   - 旧 .mp4 演示 → 改成 .gif（演示实为 GIF 动图）
// 幂等：已是当前 R2 地址或相对路径时行为不变。
function rebaseMediaUrl(p) {
  if (!p || typeof p !== 'string') return p || '';
  const m = /https?:\/\/[^/]+(\/.*)$/.exec(p);
  let rel = m ? m[1] : p;
  if (/\.mp4$/i.test(rel)) rel = rel.replace(/\.mp4$/i, '.gif');
  return media(rel);
}

// 把所选动作解析为训练组列表（warmup 字段默认 false，保留样式扩展位）
function presetSets(a) {
  if (Array.isArray(a.sets) && a.sets.length) {
    return a.sets.map(s => ({
      reps: s.reps != null ? String(s.reps) : '',
      weight: s.weight != null ? String(s.weight) : '',
      trainSec: s.trainSec || 0,
      restSec: s.restSec || 0,
      // 保留计划里已记录的 RPE（向后兼容，无则空）
      rpe: (s.rpe != null && s.rpe !== '') ? String(s.rpe) : '',
      warmup: !!s.warmup
    }));
  }
  const n = Math.max(1, Number(a.setsCount) || 1);
  const reps = a.reps != null && a.reps !== '' ? String(a.reps) : '';
  const weight = a.weight != null && a.weight !== '' ? String(a.weight) : '';
  return Array.from({ length: n }, () => ({ reps, weight, trainSec: 0, restSec: 0, rpe: '', warmup: false }));
}

Page({
  data: {
    total: 0,
    actions: [],          // 全部动作（含训练记录）
    expandedId: null,     // 当前展开的动作 id
    planName: '',         // 训练名（同分类显示类目，否则"综合训练"）
    stats: { doneSets: 0, totalSets: 0, doneActions: 0, totalActions: 0, doneVol: 0, totalVol: 0 },
    workoutClock: '00:00',// 全局训练计时 mm:ss
    clockRunning: false,   // 全局计时是否运行中（手动播放/暂停；点组 ✓ 自动启动）
    actNo: 0,             // 休息弹窗显示的"第几组"（当前完成组序号）
    // 休息倒计时悬浮窗
    showRest: false,
    restLeft: 0,
    restKind: '',
    restOptions: [60, 90, 120],
    restSelected: 1,
    vibrateOn: true,
    restMinimized: false,
    // 训练计时
    showTrain: false,
    trainPhase: '',
    trainLeft: 0,
    trainTotal: 0,
    trainMinimized: false,
    trainBall: { x: 0, y: 0 },
    trainBallStyle: '',
    restBall: { x: 0, y: 0 },
    restBallStyle: '',
    // 视频放大覆盖层（参数化，替换原单动作 act.video）
    showVideoOverlay: false,
    overlayVideo: '',
    overlayPoster: '',
    // 动作历史
    showHistory: false,
    histAction: null,     // 当前展开动作（历史 overlay 只展示选中动作）
    hist: null,           // 历史汇总：上次日期/每组对比/最佳重量容量（打开时由 buildActionHistory 计算）
    // 替换动作
    showReplace: false,
    replaceAi: -1,          // 待替换的动作索引
    replaceTargetId: '',     // 待替换的动作 id
    replaceTargetName: '',   // 待替换的动作名（标题显示）
    // 单动作操作菜单（头部 ⋯）：动作详情 / 替换动作 / 删除动作
    showActionMenu: false,
    menuAi: -1,              // 菜单指向的动作索引
    menuActionName: '',      // 菜单标题显示的动作名
    menuPosStyle: '',        // 悬浮小窗位置（完整 CSS 串，锚定被点 ⋯ 下方；单 mustache 合规）
    // 替换/添加浮层的搜索 + 分类过滤
    replKeyword: '',
    replCat: '全部',
    replCats: ['全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心'],
    replaceFiltered: [],
    addFiltered: [],
    replaceFullLen: 0,
    addFullLen: 0,
    replBodyH: 0,            // 浮层 scroll-view 确定高度(px)，真机用 JS 实测，避免 flex 高度对 scroll-view 失效导致只显示几项
    finished: false,
    // 添加动作
    showAdd: false,
    // 弹窗/悬浮球进度环（conic-gradient 完整 CSS 字符串，由 JS 拼接，单 mustache 合规）
    trainRingStyle: '',
    trainBallRingStyle: '',
    restRingStyle: '',
    restBallRingStyle: '',
    restClock: '00:00',
    // 自定义导航栏总高（px，状态栏 + 44px 导航栏）：供 .wo-top 的 sticky top 偏移，避免与吸顶导航栏重叠
    navH: 0
  },

  // 深色主题同步：本页原先无 onShow，切主题后从其它页进入仍是白色，这里与其它页保持同一套路
  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({ theme: themeCls });
    // 自定义导航栏下同步状态栏前景/背景色（背景色仅系统兜底，页面自身用 .page.theme-dark 深底）
    wx.setNavigationBarColor({
      frontColor: themeCls === 'theme-dark' ? '#ffffff' : '#000000',
      backgroundColor: themeCls === 'theme-dark' ? '#0A0A0A' : '#F7F7F5'
    });
  },

  // 解析本次训练的动作来源：优先「手动已选」（训练页动作库勾选），其次「活跃计划」。
  // 计划流程（首页/计划页「开始训练」、导入今日训练）不再写 selectedActions，
  // 避免污染训练页「已选动作」；本页直接从 activePlan 解析动作。
  resolveWorkoutSource() {
    const sel = store.get().selectedActions || [];
    if (sel.length) return { actions: sel, name: '' };
    const plan = store.getActivePlan();
    if (plan && Array.isArray(plan.actions) && plan.actions.length) {
      return { actions: plan.actions.map(pa => store.planActionToTrain(pa)), name: plan.name || '今日训练' };
    }
    return { actions: [], name: '' };
  },

  onLoad() {
    // 导航栏高度实测注入（.wo-top 是 sticky 顶栏，需要让出导航栏位置）
    const winInfo = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ navH: (winInfo.statusBarHeight || 20) + 44 });

    const src = this.resolveWorkoutSource();
    this._woSource = src.name ? 'plan' : 'manual'; // 标记来源：plan 来源的替换/添加动作不回写 selectedActions
    const sel = src.actions;
    // 计划签名：用于判断「上次未完成的会话」是否属于同一套动作
    const sig = sel.map(a => a.id).sort().join(',');
    const sess = workoutSession.load();
    let actions, expandedId, planName, elapsed = 0;
    if (sess && sess.signature === sig && Array.isArray(sess.actions) && sess.actions.length) {
      // 恢复上次未完成的训练（保留已输入的重量/次数/完成状态与计时）
      // 防御：陈旧会话可能存着已失效的旧 OSS 绝对地址或 .mp4，归一化回当前 R2 的 gif，避免缩略图空白
      actions = sess.actions.map(a => {
        const o = Object.assign({}, a);
        if (o.image) o.image = rebaseMediaUrl(o.image);
        if (o.video) o.video = rebaseMediaUrl(o.video);
        return o;
      });
      expandedId = sess.expandedId || (actions[0] && actions[0].id) || null;
      planName = sess.planName || '';
      elapsed = sess.elapsed || 0;
    } else {
      if (!sel.length) {
        wx.showToast({ title: '请先选择动作', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      this.buildLibrary();   // 扁平化全量动作库（内置库 + 自建动作），供替换/添加候选池
      actions = sel.map(a => ({
        id: a.id,
        name: a.name,
        nameZh: a.nameZh || '',
        category: a.category,
        equip: a.equip,
        image: media(a.image || ''),
        video: media(a.video || ''),
        perSetTimer: true,
        sets: presetSets(a)
      }));
      expandedId = actions.length ? actions[0].id : null;
      const cats = [];
      actions.forEach(a => { if (cats.indexOf(a.category) < 0) cats.push(a.category); });
      planName = src.name || (cats.length === 1 ? cats[0] : '综合训练');
      // 建立可恢复会话（供离开训练页后全局悬浮窗显示 + 恢复）
      workoutSession.save({ signature: sig, actions, planName, expandedId, elapsed: 0, running: false, startTs: null });
    }
    const restTotal = store.get().restTimer || 90;
    const restSelected = this.data.restOptions.indexOf(restTotal);
    const vibrateOn = wx.getStorageSync('hh_vibrate');
    const stats = this.decorate(actions, expandedId);
    const liveElapsed = workoutSession.getElapsed();
    this.setData({
      actions, total: actions.length, expandedId, planName,
      restTotal, restLeft: restTotal,
      restSelected: restSelected < 0 ? 1 : restSelected,
      vibrateOn: vibrateOn !== false, stats, actNo: 0,
      workoutClock: fmtClock(liveElapsed),
      clockRunning: !!(sess && sess.running)
    });
    this._woElapsed = liveElapsed;
    // 若会话仍在计时中（最小化前未暂停），重新进入后自动续跑全局计时
    if (sess && sess.running) this.startWorkoutClock();

    const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
    this._winW = info.windowWidth;
    this._winH = info.windowHeight || (info.windowWidth * 1.6);
    // 默认顶部 y = 自定义导航栏（fixed, z-index 999, 高 = 状态栏 + 44）之下，
    // 否则球会被导航栏整只盖住（z-index 150 < 999，2026-09-08「看不到悬浮球」真凶）
    this._topY = (info.statusBarHeight || 20) + 44 + Math.round(24 * info.windowWidth / 750);
    // 悬浮球像素尺寸（WXSS 120rpx），用于精确计算贴边位置
    this._ballPx = Math.round(120 * info.windowWidth / 750);
    const pillW = info.windowWidth * 0.32;
    this._pillW = pillW;
    // 不再用 movable-view（其 x/y 应用时机在真机不可控，曾致球整只停在屏外不可见），
    // 改为 fixed 定位 + 自管拖拽：位置完全由 JS 拼的 style 字符串决定，所见即所得
    this.applyBall('train', this.defaultBall());
    this.applyBall('rest', this.defaultBall());
    // 恢复离开前最小化的训练/休息倒计时球（如有）
    this.restoreMiniTimer(sess);
    this.initBeeps();
  },

  // 悬浮球默认位置：右缘贴边、顶部对齐
  defaultBall() {
    return { x: Math.max(0, this._winW - this._ballPx), y: this._topY };
  },
  // 位置合法性兜底（storage 脏数据 / 屏幕尺寸变化后回读）
  clampBall(p) {
    const maxX = Math.max(0, this._winW - this._ballPx);
    const maxY = Math.max(0, this._winH - this._ballPx);
    return {
      x: isFinite(p && p.x) ? Math.max(0, Math.min(maxX, p.x)) : maxX,
      y: isFinite(p && p.y) ? Math.max(0, Math.min(maxY, p.y)) : this._topY
    };
  },
  // 位置对象 → 内联 style（单 mustache 完整 CSS 字符串，符合 wxml 红线）
  ballStyle(p) {
    return 'left:' + Math.round(p.x) + 'px;top:' + Math.round(p.y) + 'px';
  },
  // 统一写某个球（key: 'train' | 'rest'）的位置与样式
  applyBall(key, p) {
    this.setData({
      [key === 'train' ? 'trainBall' : 'restBall']: p,
      [key === 'train' ? 'trainBallStyle' : 'restBallStyle']: this.ballStyle(p)
    });
  },
  // 进度环样式：conic-gradient 扇形（12 点方向起顺时针），JS 拼完整 CSS 字符串（单 mustache 红线）
  // 常量色值直写（不走 CSS 变量）：弹窗为固定深色卡（参考图方案），不随页面主题翻转
  ringStyle(left, total, color) {
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((left / total) * 100))) : 0;
    return 'background: conic-gradient(' + color + ' ' + pct + '%, rgba(255,255,255,.10) 0deg)';
  },
  // 训练计时（弹窗 + 最小化球）环统一重绘：剩余占比，荧光绿
  paintTrain() {
    const ring = this.ringStyle(this.data.trainLeft, this.data.trainTotal, '#C8FF00');
    this.setData({ trainRingStyle: ring, trainBallRingStyle: ring });
  },
  // 休息计时（弹窗 + 最小化球）环统一重绘：剩余占比，能量橙（DESIGN.md 休息语义色）
  paintRest() {
    const ring = this.ringStyle(this.data.restLeft, this.data.restTotal, '#FF9500');
    this.setData({ restRingStyle: ring, restBallRingStyle: ring, restClock: fmtClock(this.data.restLeft) });
  },

  // 把当前进度快照进全局会话（离开训练页前调用，确保悬浮窗与恢复为最新状态）
  // 仅更新动作/计划类字段；elapsed/running/startTs 由计时模型（markRunning/freeze/getElapsed）管理，不被覆盖
  snapshotSession() {
    // 签名与 onLoad 保持一致：从当前会话动作列表推导
    // （计划来源时 selectedActions 为空，不能再用它算签名；onLoad 时 sel 与 actions 的 id 一一对应）
    const sig = (this.data.actions || []).map(a => a.id).sort().join(',');
    // 最小化倒计时球快照：离开页面（最小化成药丸）后球随页面销毁，回来时据此恢复
    let miniTimer = null;
    if (this.data.showTrain && this.data.trainMinimized) {
      miniTimer = {
        kind: 'train', phase: this.data.trainPhase,
        left: this.data.trainLeft, total: this.data.trainTotal,
        ai: this._trainAi, si: this._trainSi, ts: Date.now()
      };
    } else if (this.data.showRest && this.data.restMinimized) {
      miniTimer = { kind: 'rest', left: this.data.restLeft, total: this.data.restTotal, ts: Date.now() };
    }
    workoutSession.update({
      signature: sig,
      actions: this.data.actions,
      planName: this.data.planName,
      expandedId: this.data.expandedId,
      miniTimer: miniTimer
    });
  },

  // 恢复离开前最小化的倒计时球：按墙上时间折算剩余秒数，已倒数完则静默丢弃（不做完成副作用）
  restoreMiniTimer(sess) {
    const mini = sess && sess.miniTimer;
    workoutSession.update({ miniTimer: null });
    if (!mini || !(mini.left > 0)) return;
    const left = mini.left - Math.floor((Date.now() - (mini.ts || Date.now())) / 1000);
    if (left <= 0) return;
    if (mini.kind === 'train') {
      const a = this.data.actions[mini.ai];
      const set = a && a.sets && a.sets[mini.si];
      if (!set || set.done) return;
      this._trainAi = mini.ai; this._trainSi = mini.si;
      this.setData({ showTrain: true, trainPhase: mini.phase, trainLeft: left, trainTotal: mini.total, trainMinimized: true });
      this.paintTrain();
      if (mini.phase === 'work') this._trainWorkStartedAt = Date.now() - (mini.total - left) * 1000;
      this.clearTrainTimer();
      this._trainTimer = setInterval(() => this.trainTick(), 1000);
    } else {
      this.setData({ showRest: true, restLeft: left, restTotal: mini.total, restKind: 'set', restMinimized: true });
      this.paintRest();
      this.startRest();
    }
  },

  // 派生字段：stats 汇总 + 每动作 volText（已完成/目标容量）+ 每组的 current（展开动作的第一个未完成组）
  decorate(actions, expandedId) {
    expandedId = expandedId || this.data.expandedId;
    let totalSets = 0, doneSets = 0, totalActions = actions.length, doneActions = 0, totalVol = 0, doneVol = 0;
    actions.forEach(a => {
      let aDone = a.sets.length > 0;
      let firstUndone = -1;
      let aTotalVol = 0, aDoneVol = 0;
      a.sets.forEach((s, i) => {
        totalSets++;
        const w = Number(s.weight) || 0, r = Number(s.reps) || 0;
        const vol = w * r;
        aTotalVol += vol; totalVol += vol;
        if (s.done) { doneSets++; doneVol += vol; }
        else { aDone = false; if (firstUndone < 0) firstUndone = i; }
        s.current = (a.id === expandedId && firstUndone === i);
        // 休息时长展示为 MM:SS（WXML 不支持函数调用，必须在 JS 预格式化）
        s.restText = (Number(s.restSec) || 0) > 0 ? fmtClock(Number(s.restSec)) : '';
      });
      if (aDone) doneActions++;
      a.volText = aDoneVol.toFixed(1) + '/' + aTotalVol.toFixed(1);
    });
    return { totalSets, doneSets, totalActions, doneActions, totalVol: Math.round(totalVol), doneVol: Math.round(doneVol) };
  },

  // 全局训练计时（手动控制：点开始按钮启动、可暂停；点组 ✓ 自动启动）
  // 采用墙上时间模型：markRunning 记录 startTs，getElapsed 按真实时间累加，离开页面后仍在后台走表
  startWorkoutClock() {
    if (this._woTimer) return;
    if (this._woElapsed == null) this._woElapsed = 0;
    workoutSession.markRunning();
    this.setData({ clockRunning: true });
    this._woTimer = setInterval(() => {
      this.setData({ workoutClock: fmtClock(workoutSession.getElapsed()) });
    }, 1000);
  },
  // 暂停全局计时（冻结 elapsed，保留已计秒数，下次启动从断点继续）
  pauseWorkoutClock() {
    if (this._woTimer) { clearInterval(this._woTimer); this._woTimer = null; }
    workoutSession.freeze();
    this.setData({ clockRunning: false });
  },
  // 顶栏播放/暂停按钮：切换全局计时
  toggleClock() {
    if (this._woTimer) this.pauseWorkoutClock();
    else this.startWorkoutClock();
  },
  // 点组 ✓ 时确保全局计时运行（未运行则启动，已运行/暂停态下点组也会被用户手动恢复）
  ensureClockRunning() {
    if (!this._woTimer) this.startWorkoutClock();
  },

  // 展开/折叠动作卡
  toggleEx(e) {
    const id = e.currentTarget.dataset.id;
    const expandedId = this.data.expandedId === id ? null : id;
    const actions = this.data.actions.slice();
    const stats = this.decorate(actions, expandedId);
    this.setData({ expandedId, actions, stats });
  },

  onInputReps(e) {
    const ai = e.currentTarget.dataset.ai, si = e.currentTarget.dataset.si;
    this.setData({ ['actions[' + ai + '].sets[' + si + '].reps']: e.detail.value });
  },
  onInputWeight(e) {
    const ai = e.currentTarget.dataset.ai, si = e.currentTarget.dataset.si;
    this.setData({ ['actions[' + ai + '].sets[' + si + '].weight']: e.detail.value });
  },

  // 每组 RPE 步进（1–10，空记录从 7 起调）：记录自觉费力度，供复盘努力度维度
  stepRpe(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const si = Number(e.currentTarget.dataset.si);
    const d = Number(e.currentTarget.dataset.d);
    const set = this.data.actions[ai] && this.data.actions[ai].sets[si];
    if (!set || set.done) return;
    const base = (set.rpe !== '' && set.rpe != null) ? Number(set.rpe) : 7;
    let v = base + d;
    if (v < 1) v = 1;
    if (v > 10) v = 10;
    this.setData({ ['actions[' + ai + '].sets[' + si + '].rpe']: String(v) });
  },

  // 展开卡底部「+ 新增一组」
  addSet(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const actions = this.data.actions.slice();
    const a = Object.assign({}, actions[ai]);
    a.sets = a.sets.concat([{ reps: '', weight: '', trainSec: 0, restSec: 0, rpe: '', warmup: false }]);
    actions[ai] = a;
    const stats = this.decorate(actions);
    this.setData({ actions, stats });
  },

  // 组行行尾 ✕ → 删除该组
  // 入口在该动作只剩 1 组时被 wxml 隐藏（避免动作变成 0 组，此时应删整个动作），这里再做一次兜底
  // 该组已填数据或已完成 → 二次确认；空组直接删
  deleteSet(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const si = Number(e.currentTarget.dataset.si);
    const a = this.data.actions[ai];
    const set = a && a.sets && a.sets[si];
    if (!a || !set) return;
    if (!a.sets || a.sets.length <= 1) return;

    const hasData = !!set.done
      || (set.weight !== '' && set.weight != null)
      || (set.reps !== '' && set.reps != null);

    const doDelete = () => {
      // 正在给该动作计时：删的正是这一组 → 停表；删在它之前 → 索引前移，
      // 否则计时结束回调 completeSet(ai, si) 会打到错位后的组
      if (this._trainAi === ai) {
        if (this._trainSi === si) {
          this.clearTrainTimer();
          this.setData({ showTrain: false });
        } else if (this._trainSi > si) {
          this._trainSi -= 1;
        }
      }
      const actions = this.data.actions.slice();
      const act = Object.assign({}, actions[ai]);
      act.sets = act.sets.slice();
      act.sets.splice(si, 1);
      actions[ai] = act;
      const stats = this.decorate(actions);
      this.setData({ actions, stats });
      this.snapshotSession();   // 组数已变，立刻同步会话（onHide 也会快照，这里保证即时一致）
    };

    if (hasData) {
      wx.showModal({
        title: '删除本组',
        content: '将删除第 ' + (si + 1) + ' 组（' + (set.weight || '-') + 'kg × ' + (set.reps || '-') + '次）',
        confirmText: '删除',
        confirmColor: '#F2545B',
        success: (r) => { if (r.confirm) doDelete(); }
      });
    } else {
      doDelete();
    }
  },

  // 组行 ✓ → 完成该组（触发训练计时或弹休息）
  completeSetTap(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const si = Number(e.currentTarget.dataset.si);
    const a = this.data.actions[ai];
    const set = a && a.sets && a.sets[si];
    if (!set || set.done) return;
    this.ensureClockRunning();   // 点组 ✓ 时左上角全局计时自动启动
    if (a.perSetTimer && !set.trainSec) {
      this.openTrain(ai, si);
    } else {
      this.completeSet(ai, si);
    }
  },

  // 点 ✓ 启动该组训练计时：5秒准备 → 60秒训练；结束自动标记该组完成并弹休息
  openTrain(ai, si) {
    if (this.data.showTrain) return;
    const a = this.data.actions[ai];
    const set = a && a.sets && a.sets[si];
    if (set && set.done) return;
    this._trainAi = ai; this._trainSi = si;
    this.setData({ showTrain: true, trainPhase: 'ready', trainLeft: 5, trainTotal: 5, trainMinimized: false });
    this.clearTrainTimer();
    this.paintTrain();
    this._trainTimer = setInterval(() => this.trainTick(), 1000);
  },
  // 训练计时每秒 tick（openTrain / skipTrain 共用）
  trainTick() {
    const left = this.data.trainLeft - 1;
    if (this.data.trainPhase === 'ready') {
      if (left > 0) {
        this.setData({ trainLeft: left });
        this.paintTrain();
        this.playBeep(left === 1 ? 'last' : 'tick');
        return;
      }
      this.enterWorkPhase();
      return;
    }
    if (left > 0) {
      this.setData({ trainLeft: left });
      this.paintTrain();
      return;
    }
    this.clearTrainTimer();
    this.recordTrainSec(this._trainAi, this._trainSi, 60);
    this.completeSet(this._trainAi, this._trainSi);
  },
  // 准备 → 训练 阶段切换（倒计时走完 / 「跳过」共用）
  enterWorkPhase() {
    this.setData({ trainPhase: 'work', trainLeft: 60, trainTotal: 60 });
    this.paintTrain();
    this._trainWorkStartedAt = Date.now();
    this.playBeep('go');
  },
  // 弹窗「跳过」：准备阶段直接进入训练（训练阶段无跳过语义，按钮隐藏）
  skipTrain() {
    if (this.data.trainPhase !== 'ready' || !this._trainTimer) return;
    this.clearTrainTimer();
    this.enterWorkPhase();
    this._trainTimer = setInterval(() => this.trainTick(), 1000);
  },

  // 训练计时弹窗：手动「结束训练」→ 记录实际时长并标记该组完成；「取消」→ 直接关闭
  cancelTrain() {
    this.clearTrainTimer();
    if (this.data.trainPhase === 'work') {
      const elapsed = this._trainWorkStartedAt
        ? Math.max(1, Math.round((Date.now() - this._trainWorkStartedAt) / 1000))
        : 0;
      this.recordTrainSec(this._trainAi, this._trainSi, elapsed);
      this.completeSet(this._trainAi, this._trainSi);
      return;
    }
    this.setData({ showTrain: false });
  },

  initBeeps() {
    this._beepTick = wx.createInnerAudioContext();
    this._beepTick.src = '/audio/beep_tick.wav';
    this._beepLast = wx.createInnerAudioContext();
    this._beepLast.src = '/audio/beep_last.wav';
  },
  playBeep(type) {
    if (this._destroyed) return;
    const ctx = (type === 'last' || type === 'go') ? this._beepLast : this._beepTick;
    if (!ctx) return;
    try { ctx.stop(); } catch (e) {}
    try { ctx.play(); } catch (e) {}
  },
  clearTrainTimer() {
    if (this._trainTimer) { clearInterval(this._trainTimer); this._trainTimer = null; }
  },

  // 记录某组训练时长（训练计时结束/手动结束训练时）
  recordTrainSec(ai, si, sec) {
    const actions = this.data.actions.slice();
    actions[ai] = Object.assign({}, actions[ai]);
    actions[ai].sets = actions[ai].sets.slice();
    actions[ai].sets[si] = Object.assign({}, actions[ai].sets[si], { trainSec: sec });
    this.setData({ actions, showTrain: false });
  },

  // 完成某动作某组 → 弹休息（或收尾）
  completeSet(ai, si) {
    const actions = this.data.actions.slice();
    const a = Object.assign({}, actions[ai]);
    const sets = a.sets.slice();
    sets[si] = Object.assign({}, sets[si], { done: true });
    a.sets = sets;
    actions[ai] = a;

    const hasMoreSet = si < sets.length - 1;
    const hasMoreAction = ai < this.data.total - 1;

    let nextIndex = ai, nextSet = si + 1, restKind;
    if (hasMoreSet) restKind = 'set';
    else if (hasMoreAction) { restKind = 'action'; nextIndex = ai + 1; nextSet = 0; }
    // 末组（无更多组、也无更多动作）同样弹休息计时：
    // 之前判成 'done' 直接 return，导致「单动作单组」点完 ✓ 什么弹窗都没有（2026-09-09 反馈）。
    // 'done'（训练完成/保存）不再由本函数触发，保存只走顶栏「完成」。
    else restKind = 'last';

    this._afterRest = (restKind === 'last') ? null : { nextIndex, nextSet };
    this._activeActionIndex = ai;
    this._activeSetIndex = si;

    const stats = this.decorate(actions);
    this.setData(Object.assign(
      { actions, showRest: true, restLeft: this.data.restTotal, restKind, restMinimized: false, actNo: si, showTrain: false, stats }
    ));
    this.paintRest();
    this.startRest();
  },

  startRest() {
    this.clearRest();
    this._restStartedAt = Date.now();
    this._restTimer = setInterval(() => {
      const left = this.data.restLeft - 1;
      if (left <= 0) this.endRest(true);
      else {
        this.setData({ restLeft: left });
        this.paintRest();
        if (left <= 5) this.playBeep(left === 1 ? 'last' : 'tick');
      }
    }, 1000);
  },
  clearRest() {
    if (this._restTimer) { clearInterval(this._restTimer); this._restTimer = null; }
  },

  endRest(byTimer) {
    this.clearRest();
    if (byTimer && this.data.vibrateOn) wx.vibrateShort({ type: 'medium', fail() {} });
    const ai = this._activeActionIndex, si = this._activeSetIndex;
    const actions = this.data.actions.slice();
    if (ai != null && si != null) {
      const realSec = this._restStartedAt ? Math.round((Date.now() - this._restStartedAt) / 1000) : this.data.restTotal;
      actions[ai] = Object.assign({}, actions[ai]);
      actions[ai].sets = actions[ai].sets.slice();
      actions[ai].sets[si] = Object.assign({}, actions[ai].sets[si], { restSec: realSec });
      this._activeActionIndex = null;
      this._activeSetIndex = null;
    }
    // 收尾态（'last' 末组 / 'done' 历史态）：只关闭弹窗，不跳转下一组、绝不自动保存
    // ——整次训练的保存只走顶栏「完成(.wo-done-btn)」。
    if (this.data.restKind === 'done' || this.data.restKind === 'last') {
      // restSec → restText(MM:SS) 必须经 decorate 重算后再 setData：
      // 此前该分支只写 restSec、不重算 restText，单动作单组休息结束后行内
      // .wo-set-rest 一直空着，要等下次触发 decorate 的交互才「延迟」出现（2026-09-10 反馈）
      const stats = this.decorate(actions);
      this.setData({ actions, stats, showRest: false });
      return;
    }
    const target = this._afterRest || { nextIndex: 0, nextSet: 0 };
    const newExpandedId = this.data.actions[target.nextIndex] ? this.data.actions[target.nextIndex].id : this.data.expandedId;
    const stats = this.decorate(actions, newExpandedId);
    this.setData({ showRest: false, restLeft: this.data.restTotal, expandedId: newExpandedId, actions, stats });
  },

  skipRest() { this.endRest(false); },

  minimizeTrain() {
    const p = this.clampBall(wx.getStorageSync('hh_train_ball'));
    this.setData({
      trainMinimized: true, trainBall: p, trainBallStyle: this.ballStyle(p),
      trainBallRingStyle: this.ringStyle(this.data.trainLeft, this.data.trainTotal, '#C8FF00')
    });
  },
  expandTrain() { if (this._guardBallTap()) return; this.setData({ trainMinimized: false }); },
  minimizeRest() {
    const p = this.clampBall(wx.getStorageSync('hh_rest_ball'));
    this.setData({
      restMinimized: true, restBall: p, restBallStyle: this.ballStyle(p),
      restBallRingStyle: this.ringStyle(this.data.restLeft, this.data.restTotal, '#FF9500')
    });
  },
  expandRest() { if (this._guardBallTap()) return; this.setData({ restMinimized: false }); },

  // —— 悬浮球自管拖拽（fixed + touch 事件，替代 movable-view） ——
  // 拖拽后紧接着的 tap 需要屏蔽，否则轻拖一下会误触发展开
  _guardBallTap() {
    if (this._ballTapBlock) { this._ballTapBlock = false; return true; }
    return false;
  },
  onBallTouchStart(e) {
    const key = e.currentTarget.dataset.key;
    const t = e.touches[0];
    const p = key === 'train' ? this.data.trainBall : this.data.restBall;
    this._ballDrag = { key, sx: t.clientX, sy: t.clientY, ox: p.x, oy: p.y, moved: false, last: p };
  },
  onBallTouchMove(e) {
    const d = this._ballDrag;
    if (!d) return;
    const t = e.touches[0];
    if (!d.moved && (Math.abs(t.clientX - d.sx) > 3 || Math.abs(t.clientY - d.sy) > 3)) d.moved = true;
    const p = this.clampBall({ x: d.ox + (t.clientX - d.sx), y: d.oy + (t.clientY - d.sy) });
    d.last = p;
    this.applyBall(d.key, p);
  },
  onBallTouchEnd() {
    const d = this._ballDrag;
    this._ballDrag = null;
    if (!d || !d.moved) return; // 未移动 = 点击，展开交给 bindtap
    this._ballTapBlock = true;
    // 贴边吸附：球心在左半屏吸左缘(x=0)，否则吸右缘(x=winW-ballPx)；y 保持在松手处
    const snapped = this.clampBall({
      x: (d.last.x + this._ballPx / 2) < this._winW / 2 ? 0 : this._winW - this._ballPx,
      y: d.last.y
    });
    this.applyBall(d.key, snapped);
    wx.setStorageSync(d.key === 'train' ? 'hh_train_ball' : 'hh_rest_ball', snapped);
  },

  adjustRest(e) {
    const d = Number(e.currentTarget.dataset.delta);
    let sec = this.data.restLeft + d;
    if (sec < 5) sec = 5;
    if (sec > 600) sec = 600;
    this.setData({ restLeft: sec });
    this.paintRest();
  },
  changeRest(e) {
    const sec = Number(e.currentTarget.dataset.sec);
    const idx = this.data.restOptions.indexOf(sec);
    if (idx < 0) return;
    store.get().restTimer = sec;
    store.persist();
    this.clearRest();
    this.setData({ restTotal: sec, restLeft: sec, restSelected: idx });
    this.paintRest();
    this.startRest();
  },
  toggleVibrate() {
    const next = !this.data.vibrateOn;
    wx.setStorageSync('hh_vibrate', next);
    this.setData({ vibrateOn: next });
  },

  noop() {},

  // 动作历史：本次明细 + 上次同动作每组对比（↑↓）+ 历史最佳重量/容量
  openHistory(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    this.setData({ showHistory: true, histAction: a, hist: this.buildActionHistory(a) });
  },
  closeHistory() { this.setData({ showHistory: false, histAction: null, hist: null }); },

  // 汇总某动作的历史（数据源：store.trainingLogs，已按日期倒序；本次会话尚未保存，故首条即「上次」）
  buildActionHistory(a) {
    const logs = (store.get().trainingLogs || []);
    // 跨场次匹配同动作：优先 id，退化到 name+equip（自建动作可能无 id / 同名不同器械）
    const same = (it) => (it.id && a.id && it.id === a.id) ||
      (!it.id && !a.id && it.name === (a.nameZh || a.name) && (it.equip || '') === (a.equip || ''));
    const hits = [];
    logs.forEach(log => {
      (log.actions || []).forEach(it => { if (same(it)) hits.push({ date: log.date, it: it }); });
    });
    const prev = hits[0] || null;
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    // 历史最佳：所有场次所有组的最大重量；最佳容量 = 单场次 Σ(次数×重量) 最大值
    let bestWeight = 0, bestVolume = 0;
    hits.forEach(h => {
      let vol = 0;
      (h.it.setsDetail || []).forEach(s => {
        const w = num(s.weight), r = num(s.reps);
        if (w > bestWeight) bestWeight = w;
        vol += w * r;
      });
      if (vol > bestVolume) bestVolume = vol;
    });
    // 本次每组：附带相对上次同组序的重量/次数变化（null = 无可比数据）
      const prevSets = (prev && prev.it.setsDetail) || [];
      const sets = (a.sets || []).map((s, i) => {
        const w = num(s.weight), r = num(s.reps);
        const p = prevSets[i];
        // 相对上次同组序的变化；无可比数据（首次训练/该组上次为空）则不给标记
        let dw = null, dr = null;
        if (p && (num(p.weight) > 0 || num(p.reps) > 0)) {
          if (w > 0 && num(p.weight) > 0) dw = w - num(p.weight);
          if (r > 0 && num(p.reps) > 0) dr = r - num(p.reps);
        }
        return {
          no: i + 1,
          reps: s.reps || '-',
          weight: s.weight || '-',
          trainSec: s.trainSec || 0,
          restSec: s.restSec || 0,
          rpe: (s.rpe != null && s.rpe !== '') ? String(s.rpe) : '',
          dw: dw, dwAbs: dw === null ? 0 : Math.abs(dw), hasDw: dw !== null,
          dr: dr, drAbs: dr === null ? 0 : Math.abs(dr), hasDr: dr !== null && dr !== 0
        };
      });
    return {
      hasHistory: hits.length > 0,
      sessions: hits.length,
      prevDate: prev ? prev.date : '',
      prevSets: prevSets.map((s, i) => ({ no: i + 1, reps: s.reps || '-', weight: s.weight || '-', rpe: s.rpe || '' })),
      bestWeight: bestWeight,
      bestVolume: bestVolume,
      sets: sets
    };
  },

  // 替换动作：打开选择浮层（候选 = 全量动作库排除当前动作）
  /* ===== 单动作操作菜单（头部 ⋯）：动作详情 / 替换动作 / 删除动作 ===== */
  openActionMenu(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    // 量取被点 ⋯ 的视口位置，把悬浮小窗（fixed）锚定在其下方、贴右对齐，并夹在屏内不压导航栏
    const doOpen = (posStyle) => {
      this.setData({
        showActionMenu: true,
        menuAi: ai,
        menuActionName: a.nameZh || a.name || '',
        menuPosStyle: posStyle || 'top: 120px; right: 24px;'
      });
    };
    wx.createSelectorQuery()
      .select('#gear-' + a.id)
      .boundingClientRect(rect => {
        let posStyle = '';
        if (rect) {
          const info = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const winW = info.windowWidth;
          const winH = info.windowHeight || Math.round(info.windowWidth * 1.6);
          let top = rect.bottom + 6;
          const menuH = 190;   // 小窗估算高度(px)：标题 + 3 个菜单项
          if (top + menuH > winH - 12) top = winH - 12 - menuH;
          if (top < 64) top = 64;   // 不压吸顶的自定义导航栏
          let right = winW - rect.right;
          if (right < 12) right = 12;
          posStyle = 'top:' + Math.round(top) + 'px; right:' + Math.round(right) + 'px;';
        }
        doOpen(posStyle);
      })
      .exec();
  },
  closeActionMenu() { this.setData({ showActionMenu: false }); },

  // 动作详情：优先取动作库完整数据（含 steps / equip / category），写入 store 后跳转
  // （action-detail 的 onLoad 从 store.get().currentAction 取数，不带 url 参数）
  menuGoDetail() {
    const ai = this.data.menuAi;
    const a = this.data.actions[ai];
    if (!a) return;
    let full = a;
    const lib = this.buildLibrary();
    const hit = lib.find(x => x.id === a.id);
    if (hit) full = hit;
    store.get().currentAction = full;
    this.setData({ showActionMenu: false });
    wx.navigateTo({ url: '/pages/action-detail/action-detail' });
  },

  // 替换动作：复用既有 replaceAction（构造等价事件对象）
  menuReplaceAction() {
    const ai = this.data.menuAi;
    this.setData({ showActionMenu: false });
    this.replaceAction({ currentTarget: { dataset: { ai } } });
  },

  menuDeleteAction() {
    const ai = this.data.menuAi;
    const a = this.data.actions[ai];
    if (!a) return;
    const n = (a.sets || []).length;
    wx.showModal({
      title: '删除动作',
      content: '将删除「' + (a.nameZh || a.name) + '」及其 ' + n + ' 组记录',
      confirmText: '删除',
      confirmColor: '#F2545B',
      success: (r) => { if (r.confirm) this._doDeleteAction(ai); }
    });
  },
  _doDeleteAction(ai) {
    // 正在给该动作计时 → 停表；删在其之前 → 动作索引前移
    if (this._trainAi === ai) {
      this.clearTrainTimer();
      this.setData({ showTrain: false });
    } else if (this._trainAi > ai) {
      this._trainAi -= 1;
    }
    const actions = this.data.actions.slice();
    const removed = actions[ai];
    actions.splice(ai, 1);
    // 删的正是当前展开项 → 收起，避免 expandedId 指向已删除的动作
    let expandedId = this.data.expandedId;
    if (removed && expandedId === removed.id) expandedId = null;
    const stats = this.decorate(actions, expandedId);
    this.setData({ actions, stats, expandedId, showActionMenu: false });
    // 必须显式快照：signature 由动作 id 推导，删动作会改变签名。
    // 若不重快照，下次 onLoad 的 resolveWorkoutSource 签名比对失配 → 页面重建 → 删除被回滚
    this.snapshotSession();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  replaceAction(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    const all = this.buildLibrary();
    this._replaceAll = all
      .filter(x => x.id !== a.id)
      .map(x => ({
        id: x.id,
        name: x.name,
        nameZh: x.nameZh || '',
        category: x.category || '',
        image: x.image ? media(x.image) : '',
        video: x.video ? media(x.video) : ''   // 浮层缩略图优先用 GIF 演示
      }));
    this.setData({
      showReplace: true,
      replaceAi: ai,
      replaceTargetId: a.id,
      replaceTargetName: a.nameZh || a.name,
      replKeyword: '',
      replCat: '全部'
    });
    this.measureReplBody();
    this.applyReplFilter('replace');
  },
  closeReplace() { this.setData({ showReplace: false }); },
  // 选择替换目标：用新动作数据替换当前动作（保留已有组数/重量/次数记录），并写回当前训练计划
  selectReplacement(e) {
    const newId = e.currentTarget.dataset.id;
    const ai = this.data.replaceAi;
    const oldId = this.data.replaceTargetId;
    if (newId === oldId) return; // 点的是当前项，忽略
    const cand = this.data.replaceFiltered.find(c => c.id === newId);
    if (!cand || ai < 0) return;
    const raw = this._libById[newId] || {};
    const actions = this.data.actions.slice();
    const oldSets = actions[ai].sets; // 保留已有组数据
    actions[ai] = Object.assign({}, actions[ai], {
      id: cand.id,
      name: cand.name,
      nameZh: cand.nameZh,
      category: cand.category,
      image: cand.image,
      // 用原始动作库的 video 相对路径重新拼 R2：候选 cand 未携带 video 字段，必须用 raw（_libById）取
      video: raw.video ? media(raw.video) : '',
      sets: oldSets // 保留已有训练进度
    });
    const stats = this.decorate(actions, this.data.expandedId);
    this.setData({
      actions, stats,
      replaceTargetId: newId,
      replaceTargetName: cand.nameZh || cand.name,
      showReplace: false
    });
    // 同步回「已选动作」：仅手动勾选来源（selectedActions 保持原始相对路径，避免二次 media 包裹）；
    // 计划来源不写 selectedActions，避免污染训练页「已选动作」
    if (this._woSource !== 'plan') {
      store.removeSelected(oldId);
      store.addSelected({
        id: cand.id, name: cand.name, nameZh: cand.nameZh || '', category: cand.category || '',
        image: raw.image || '', video: raw.video || '', emoji: raw.emoji || '', equip: raw.equip || '', part: raw.part || ''
      });
    }
    wx.showToast({ title: '已替换动作', icon: 'success' });
  },

  // 扁平化全量动作库：内置库（按分类）→ 一维数组，叠加自建动作；并建立 id→动作 索引
  buildLibrary() {
    if (this._libFlat) return this._libFlat;
    const lib = (exercises.library) || {};
    const flat = [];
    Object.keys(lib).forEach(k => { if (Array.isArray(lib[k])) lib[k].forEach(a => flat.push(a)); });
    (store.get().customActions || []).forEach(a => flat.push(a));
    this._libById = {};
    flat.forEach(a => { this._libById[a.id] = a; });
    this._libFlat = flat;
    return flat;
  },

  // 添加动作：打开选择浮层（候选 = 全量动作库排除当前计划已有动作）
  openAdd() {
    const all = this.buildLibrary();
    const existing = {};
    this.data.actions.forEach(a => { existing[a.id] = true; });
    this._addAll = all
      .filter(x => !existing[x.id])
      .map(x => ({
        id: x.id,
        name: x.name,
        nameZh: x.nameZh || '',
        category: x.category || '',
        image: x.image ? media(x.image) : '',
        video: x.video ? media(x.video) : ''   // 浮层缩略图优先用 GIF 演示
      }));
    this.setData({ showAdd: true, replKeyword: '', replCat: '全部' });
    this.measureReplBody();
    this.applyReplFilter('add');
  },
  closeAdd() { this.setData({ showAdd: false }); },

  // 实测窗口高度，给浮层 scroll-view 一个确定的 px 高度。
  // 真机上 scroll-view 用 flex:1 经常拿不到稳定高度 → 高度塌陷、只露几项且滚不动；
  // 改为 JS 实测 windowHeight 按 70vh 减去头部估算高度，直接给 px 高度最可靠。
  measureReplBody() {
    let info;
    try { info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync(); }
    catch (e) { info = null; }
    const winH = (info && (info.windowHeight || info.screenHeight)) || 0;
    const winW = (info && info.windowWidth) || 375;
    if (!winH) { this.setData({ replBodyH: 0 }); return; }
    const headerPx = 260 * winW / 750;                 // 标题+搜索框+分类 chips 估算高度(rpx→px)
    const bodyPx = Math.max(220, winH * 0.7 - headerPx); // 浮层整体 70vh 减去头部
    this.setData({ replBodyH: Math.round(bodyPx) });
  },
  // 浮层搜索框输入
  onReplSearch(e) {
    this.setData({ replKeyword: e.detail.value });
    this.applyReplFilter('both');
  },
  // 浮层分类切换
  onReplCat(e) {
    this.setData({ replCat: e.currentTarget.dataset.cat });
    this.applyReplFilter('both');
  },
  // 按分类 + 关键词过滤候选：结果存入 _replaceFull/_addFull（完整过滤结果），
  // 仅渲染前 REPL_PAGE 项到 replaceFiltered/addFiltered，避免一次性渲染上千项超出节点上限被截断。
  applyReplFilter(scope) {
    const kw = (this.data.replKeyword || '').trim().toLowerCase();
    const cat = this.data.replCat;
    const match = (list) => list.filter(x => {
      if (cat !== '全部' && x.category !== cat) return false;
      if (kw) {
        const n = (x.nameZh || x.name || '').toLowerCase();
        const en = (x.name || '').toLowerCase();
        if (n.indexOf(kw) < 0 && en.indexOf(kw) < 0) return false;
      }
      return true;
    });
    const patch = {};
    if (scope !== 'add' && this._replaceAll) {
      this._replaceFull = match(this._replaceAll);
      patch.replaceFiltered = this._replaceFull.slice(0, REPL_PAGE);
      patch.replaceFullLen = this._replaceFull.length;
    }
    if (scope !== 'replace' && this._addAll) {
      this._addFull = match(this._addAll);
      patch.addFiltered = this._addFull.slice(0, REPL_PAGE);
      patch.addFullLen = this._addFull.length;
    }
    this.setData(patch);
  },
  // 上拉加载更多：把 _replaceFull/_addFull 的后续分片追加进渲染数组（替换/添加浮层共用）
  loadMoreRepl() {
    if (this.data.showReplace && this._replaceFull) {
      const cur = this.data.replaceFiltered.length;
      if (cur >= this._replaceFull.length) return;
      this.setData({ replaceFiltered: this.data.replaceFiltered.concat(this._replaceFull.slice(cur, cur + REPL_PAGE)) });
    } else if (this.data.showAdd && this._addFull) {
      const cur = this.data.addFiltered.length;
      if (cur >= this._addFull.length) return;
      this.setData({ addFiltered: this.data.addFiltered.concat(this._addFull.slice(cur, cur + REPL_PAGE)) });
    }
  },
  // 选择添加目标：向当前训练计划追加该动作（默认 1 组空），写回计划并展开新卡
  selectAdd(e) {
    const id = e.currentTarget.dataset.id;
    const raw = this._libById[id];
    if (!raw) return;
    const newAction = {
      id: raw.id,
      name: raw.name,
      nameZh: raw.nameZh || '',
      category: raw.category || '',
      equip: raw.equip || '',
      image: raw.image ? media(raw.image) : '',
      video: raw.video ? media(raw.video) : '',
      perSetTimer: true,
      sets: presetSets(raw)
    };
    const actions = this.data.actions.slice();
    actions.push(newAction);
    const expandedId = raw.id;
    const total = actions.length;
    const stats = this.decorate(actions, expandedId);
    this.setData({ actions, total, expandedId, showAdd: false, stats });
    // 同步追加到「已选动作」：仅手动勾选来源；计划来源不写 selectedActions
    if (this._woSource !== 'plan') {
      store.addSelected({
        id: raw.id, name: raw.name, nameZh: raw.nameZh || '', category: raw.category || '',
        image: raw.image || '', video: raw.video || '', emoji: raw.emoji || '', equip: raw.equip || '', part: raw.part || ''
      });
    }
    wx.showToast({ title: '已添加动作', icon: 'success' });
  },

  // 最小化当前页面：保存进度 → 真正离开训练页（返回上一页/训练 tab），
  // 悬浮计时窗由 custom-tab-bar 在所有 tab 页显示，点药丸可重新进入恢复训练。
  // 注意：不冻结全局计时（onUnload 也不冻结），离开后计时按真实时间后台继续。
  minimizePage() {
    this.snapshotSession();
    wx.navigateBack({
      fail: () => { wx.switchTab({ url: '/pages/training/training' }); }
    });
  },

  // 顶栏「完成」→ 保存整次训练（有未完成组时确认）
  finishWorkout() {
    const s = this.data.stats;
    if (s.totalSets > 0 && s.doneSets >= s.totalSets) {
      this.saveWorkout(this.data.actions);
      return;
    }
    wx.showModal({
      title: '结束训练',
      content: '还有未完成组，确定保存当前进度？',
      success: (r) => { if (r.confirm) this.saveWorkout(this.data.actions); }
    });
  },

  // 底部「删除训练」→ 放弃并清除本次训练（不保存）、清空全局计时、回到训练选择
  deleteWorkout() {
    wx.showModal({
      title: '删除本次训练',
      content: '将清空全部动作、训练进度与计时，且不会保存。确定删除？',
      confirmText: '删除',
      confirmColor: '#F2545B',
      success: (r) => { if (r.confirm) this._doDeleteWorkout(); }
    });
  },
  _doDeleteWorkout() {
    // 1. 停止并清空全局训练计时（冻结计时 + 清 interval）
    this.pauseWorkoutClock();
    this._woElapsed = 0;
    this.setData({ workoutClock: '00:00' });
    // 2. 关闭可能存在的组间/训练计时弹窗并清其定时器
    this.clearTrainTimer();
    this.clearRest();
    this.setData({ showTrain: false, showRest: false });
    // 3. 清除全局会话（隐藏其它 tab 的悬浮计时窗）
    workoutSession.clear();
    // 4. 清空本次训练计划（selectedActions）
    store.clearSelected();
    // 5. 标记已结束，避免 onUnload/onHide 重新快照恢复会话
    this._finished = true;
    // 6. 回到训练选择页（与「完成」同样的退出路径）
    wx.navigateBack({
      fail: () => { wx.switchTab({ url: '/pages/training/training' }); }
    });
  },

  // 缩略图点击：有视频则放大播放，否则预览原图
  openHero(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    if (a.video) {
      this.setData({ showVideoOverlay: true, overlayVideo: a.video, overlayPoster: a.image });
    } else if (a.image) {
      // a.image 可能是 cloud:// 文件 ID，previewImage 只认 HTTPS，先解析
      resolveUrl(a.image, (u) => wx.previewImage({ current: u, urls: [u] }));
    }
  },
  closeVideoOverlay() { this.setData({ showVideoOverlay: false }); },

  // 每组计时开关（仅当前展开动作）
  togglePerSetTimer(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const actions = this.data.actions.slice();
    const a = Object.assign({}, actions[ai]);
    a.perSetTimer = !a.perSetTimer;
    actions[ai] = a;
    this.setData({ actions });
  },

  // 占位交互（后续可扩展为真实编辑/备注/设置面板）
  editPlan() { wx.showToast({ title: '编辑训练计划', icon: 'none' }); },
  openGear(e) { wx.showToast({ title: '动作设置', icon: 'none' }); },
  // 动作级备注（逐动作感受 / 注意点），落库到 action.note，复盘「训练感受」聚合展示
  editNote(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    wx.showModal({
      title: a.nameZh || a.name,
      editable: true,
      placeholderText: '记录这个动作的感受 / 注意点',
      content: a.note || '',
      success: (r) => {
        if (!r.confirm) return;
        const actions = this.data.actions.slice();
        const na = Object.assign({}, actions[ai]);
        na.note = (r.content || '').trim();
        actions[ai] = na;
        this.setData({ actions });
      }
    });
  },

  saveWorkout(actions) {
    if (!auth.requireLogin()) return;
    this._finished = true;
    workoutSession.clear();   // 训练完成，清除全局会话（隐藏悬浮计时窗）
    const logActions = actions.map(a => ({
      // 关键：带上动作身份字段，否则复盘「滚动/基准」无法跨场次可靠匹配同动作（同名不同器械、自建动作重名会串）
      id: a.id || '',
      category: a.category || '',
      equip: a.equip || '',
      name: a.nameZh || a.name,
      note: (a.note || '').trim(),
      sets: a.sets.length,
      reps: a.sets.length ? (Number(a.sets[a.sets.length - 1].reps) || 0) : 0,
      weight: a.sets.length ? (Number(a.sets[a.sets.length - 1].weight) || 0) : 0,
      setsDetail: a.sets.map(s => ({
        reps: Number(s.reps) || 0,
        weight: Number(s.weight) || 0,
        trainSec: s.trainSec || 0,
        restSec: s.restSec || 0,
        // 保留自觉费力度 RPE（空字符串表示未记录，复盘据此降级）
        rpe: (s.rpe != null && s.rpe !== '') ? Number(s.rpe) : ''
      }))
    }));
    store.saveTrainingLog({ date: todayStr(), actions: logActions });
    store.clearSelected();
    wx.showToast({ title: '训练已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 1000);
  },

  onHide() {
    // 页面被其它页面盖住（仍在栈中）时，刷新会话快照，保证悬浮窗显示最新进度
    if (!this._finished) this.snapshotSession();
  },

  onUnload() {
    this.clearRest();
    this.clearTrainTimer();
    if (this._woTimer) { clearInterval(this._woTimer); this._woTimer = null; }
    try { this._beepTick && this._beepTick.destroy(); } catch (e) {}
    try { this._beepLast && this._beepLast.destroy(); } catch (e) {}
    this._destroyed = true;
    // 未完成离开时保留会话快照（供其它 tab 页悬浮窗显示 + 恢复）；完成态已在 saveWorkout 清除
    if (!this._finished) this.snapshotSession();
  }
});

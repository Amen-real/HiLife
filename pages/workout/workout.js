// pages/workout/workout.js
// 训练执行页（全部动作可滚动列表 + 单卡展开，参考 ui-workout-redesign.html）
// 流程：进入页面全局计时暂停（顶部播放/暂停按钮控制，或点组 ✓ 自动启动）→ 逐动作卡片可展开 → 组数输入 kg/次 → 点 ✓ 完成该组
//   （若开启"每组计时"且未训练过，先跑 5秒准备+60秒训练计时，结束自动标记完成）→ 完成后弹组间/动作间休息
//   → 下一动作自动展开；全部完成保存入库。顶栏"完成"可随时结束并保存。
const store = require('../../utils/store.js');
const auth = require('../../utils/auth.js');
const { media } = require('../../utils/media.js');
const exercises = require('../../utils/exercises.js');
const workoutSession = require('../../utils/workoutSession.js');

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
      warmup: !!s.warmup
    }));
  }
  const n = Math.max(1, Number(a.setsCount) || 1);
  const reps = a.reps != null && a.reps !== '' ? String(a.reps) : '';
  const weight = a.weight != null && a.weight !== '' ? String(a.weight) : '';
  return Array.from({ length: n }, () => ({ reps, weight, trainSec: 0, restSec: 0, warmup: false }));
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
    restBall: { x: 0, y: 0 },
    trainRing: 100,
    restRing: 100,
    // 视频放大覆盖层（参数化，替换原单动作 act.video）
    showVideoOverlay: false,
    overlayVideo: '',
    overlayPoster: '',
    // 动作历史
    showHistory: false,
    // 替换动作
    showReplace: false,
    replaceAi: -1,          // 待替换的动作索引
    replaceTargetId: '',     // 待替换的动作 id
    replaceTargetName: '',   // 待替换的动作名（标题显示）
    // 替换/添加浮层的搜索 + 分类过滤
    replKeyword: '',
    replCat: '全部',
    replCats: ['全部', '胸部', '背部', '肩膀', '腿部', '手臂', '核心'],
    replaceFiltered: [],
    addFiltered: [],
    replaceFullLen: 0,
    addFullLen: 0,
    finished: false,
    // 添加动作
    showAdd: false,
    // 进度条宽度（预计算为 "XX%" 字符串，避免行内 style 的 }}% 解析错误）
    trainFillWidth: '0%',
    restFillWidth: '0%'
  },

  onLoad() {
    const sel = store.get().selectedActions || [];
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
      planName = cats.length === 1 ? cats[0] : '综合训练';
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
    this._topY = Math.round(24 * info.windowWidth / 750);
    const pillW = info.windowWidth * 0.32;
    this._pillW = pillW;
    this.setData({
      trainBall: { x: this._winW + 1, y: this._topY },
      restBall: { x: this._winW + 1, y: this._topY }
    });
    this.initBeeps();
  },

  // 把当前进度快照进全局会话（离开训练页前调用，确保悬浮窗与恢复为最新状态）
  // 仅更新动作/计划类字段；elapsed/running/startTs 由计时模型（markRunning/freeze/getElapsed）管理，不被覆盖
  snapshotSession() {
    const sig = (store.get().selectedActions || []).map(a => a.id).sort().join(',');
    workoutSession.update({
      signature: sig,
      actions: this.data.actions,
      planName: this.data.planName,
      expandedId: this.data.expandedId
    });
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

  // 展开卡底部「+ 新增一组」
  addSet(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const actions = this.data.actions.slice();
    const a = Object.assign({}, actions[ai]);
    a.sets = a.sets.concat([{ reps: '', weight: '', trainSec: 0, restSec: 0, warmup: false }]);
    actions[ai] = a;
    const stats = this.decorate(actions);
    this.setData({ actions, stats });
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
    this.setData({ showTrain: true, trainPhase: 'ready', trainLeft: 5, trainTotal: 5, trainMinimized: false, trainFillWidth: '100%' });
    this.clearTrainTimer();
    this._trainTimer = setInterval(() => {
      const left = this.data.trainLeft - 1;
      if (this.data.trainPhase === 'ready') {
        if (left > 0) {
          this.setData({ trainLeft: left, trainRing: Math.round(left / this.data.trainTotal * 100), trainFillWidth: Math.round(left / this.data.trainTotal * 100) + '%' });
          this.playBeep(left === 1 ? 'last' : 'tick');
          return;
        }
        this.setData({ trainPhase: 'work', trainLeft: 60, trainTotal: 60, trainRing: 100, trainFillWidth: '100%' });
        this._trainWorkStartedAt = Date.now();
        this.playBeep('go');
        return;
      }
      if (left > 0) {
        this.setData({ trainLeft: left, trainRing: Math.round(left / this.data.trainTotal * 100), trainFillWidth: Math.round(left / this.data.trainTotal * 100) + '%' });
        return;
      }
      this.clearTrainTimer();
      this.recordTrainSec(this._trainAi, this._trainSi, 60);
      this.completeSet(this._trainAi, this._trainSi);
    }, 1000);
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
    else restKind = 'done';

    this._afterRest = (restKind === 'done') ? null : { nextIndex, nextSet };
    this._isLastSet = (restKind === 'done');
    this._activeActionIndex = ai;
    this._activeSetIndex = si;

    const stats = this.decorate(actions);
    this.setData(Object.assign(
      { actions, showRest: true, restLeft: this.data.restTotal, restRing: 100, restFillWidth: '100%', restKind, restMinimized: false, actNo: si, showTrain: false, stats }
    ));
    this.startRest();
  },

  startRest() {
    this.clearRest();
    this._restStartedAt = Date.now();
    this._restTimer = setInterval(() => {
      const left = this.data.restLeft - 1;
      if (left <= 0) this.endRest(true);
      else {
        this.setData({ restLeft: left, restRing: Math.round(left / this.data.restTotal * 100), restFillWidth: Math.round(left / this.data.restTotal * 100) + '%' });
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
    if (ai != null && si != null) {
      const realSec = this._restStartedAt ? Math.round((Date.now() - this._restStartedAt) / 1000) : this.data.restTotal;
      const actions = this.data.actions.slice();
      actions[ai] = Object.assign({}, actions[ai]);
      actions[ai].sets = actions[ai].sets.slice();
      actions[ai].sets[si] = Object.assign({}, actions[ai].sets[si], { restSec: realSec });
      this.setData({ actions });
      this._activeActionIndex = null;
      this._activeSetIndex = null;
    }
    if (this._isLastSet) {
      this._isLastSet = false;
      this.setData({ showRest: false });
      this.saveWorkout(this.data.actions);
      return;
    }
    const target = this._afterRest || { nextIndex: 0, nextSet: 0 };
    const newExpandedId = this.data.actions[target.nextIndex] ? this.data.actions[target.nextIndex].id : this.data.expandedId;
    const actions = this.data.actions.slice();
    const stats = this.decorate(actions, newExpandedId);
    this.setData({ showRest: false, restLeft: this.data.restTotal, expandedId: newExpandedId, actions, stats });
  },

  skipRest() { this.endRest(false); },

  minimizeTrain() {
    const p = wx.getStorageSync('hh_train_ball') || { x: this._winW + 1, y: this._topY };
    this.setData({ trainMinimized: true, trainBall: p });
  },
  expandTrain() { this.setData({ trainMinimized: false }); },
  minimizeRest() {
    const p = wx.getStorageSync('hh_rest_ball') || { x: this._winW + 1, y: this._topY };
    this.setData({ restMinimized: true, restBall: p });
  },
  expandRest() { this.setData({ restMinimized: false }); },
  onTrainBallEnd(e) {
    const w = this._winW;
    const nx = e.detail.x < w / 2 ? 0 : w + 1;
    this.setData({ 'trainBall.x': nx });
    wx.setStorageSync('hh_train_ball', { x: nx, y: e.detail.y });
  },
  onRestBallEnd(e) {
    const w = this._winW;
    const nx = e.detail.x < w / 2 ? 0 : w + 1;
    this.setData({ 'restBall.x': nx });
    wx.setStorageSync('hh_rest_ball', { x: nx, y: e.detail.y });
  },

  adjustRest(e) {
    const d = Number(e.currentTarget.dataset.delta);
    let sec = this.data.restLeft + d;
    if (sec < 5) sec = 5;
    if (sec > 600) sec = 600;
    const ring = Math.min(100, Math.round(sec / this.data.restTotal * 100));
    this.setData({ restLeft: sec, restRing: ring, restFillWidth: ring + '%' });
  },
  changeRest(e) {
    const sec = Number(e.currentTarget.dataset.sec);
    const idx = this.data.restOptions.indexOf(sec);
    if (idx < 0) return;
    store.get().restTimer = sec;
    store.persist();
    this.clearRest();
    this.setData({ restTotal: sec, restLeft: sec, restSelected: idx, restRing: 100, restFillWidth: '100%' });
    this.startRest();
  },
  toggleVibrate() {
    const next = !this.data.vibrateOn;
    wx.setStorageSync('hh_vibrate', next);
    this.setData({ vibrateOn: next });
  },

  noop() {},

  // 动作历史
  openHistory() { this.setData({ showHistory: true }); },
  closeHistory() { this.setData({ showHistory: false }); },

  // 替换动作：打开选择浮层（候选 = 全量动作库排除当前动作）
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
        image: x.image ? media(x.image) : ''
      }));
    (store.get().favorites || []).forEach(id => { favs[id] = true; });
    this.setData({
      showReplace: true,
      replaceAi: ai,
      replaceTargetId: a.id,
      replaceTargetName: a.nameZh || a.name,
      replKeyword: '',
      replCat: '全部'
    });
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
    // 同步更新当前训练计划（selectedActions 保持原始相对路径，避免二次 media 包裹）
    store.removeSelected(oldId);
    store.addSelected({
      id: cand.id, name: cand.name, nameZh: cand.nameZh || '', category: cand.category || '',
      image: raw.image || '', video: raw.video || '', emoji: raw.emoji || '', equip: raw.equip || '', part: raw.part || ''
    });
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
        image: x.image ? media(x.image) : ''
      }));
    (store.get().favorites || []).forEach(id => { favs[id] = true; });
    this.setData({ showAdd: true, replKeyword: '', replCat: '全部' });
    this.applyReplFilter('add');
  },
  closeAdd() { this.setData({ showAdd: false }); },

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
    // 同步追加到当前训练计划（selectedActions 保持原始相对路径）
    store.addSelected({
      id: raw.id, name: raw.name, nameZh: raw.nameZh || '', category: raw.category || '',
      image: raw.image || '', video: raw.video || '', emoji: raw.emoji || '', equip: raw.equip || '', part: raw.part || ''
    });
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

  // 缩略图点击：有视频则放大播放，否则预览原图
  openHero(e) {
    const ai = Number(e.currentTarget.dataset.ai);
    const a = this.data.actions[ai];
    if (!a) return;
    if (a.video) {
      this.setData({ showVideoOverlay: true, overlayVideo: a.video, overlayPoster: a.image });
    } else if (a.image) {
      wx.previewImage({ current: a.image, urls: [a.image] });
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
  editNote(e) { wx.showToast({ title: '输入备注', icon: 'none' }); },
  openGear(e) { wx.showToast({ title: '动作设置', icon: 'none' }); },

  saveWorkout(actions) {
    if (!auth.requireLogin()) return;
    this._finished = true;
    workoutSession.clear();   // 训练完成，清除全局会话（隐藏悬浮计时窗）
    const logActions = actions.map(a => ({
      name: a.nameZh || a.name,
      sets: a.sets.length,
      reps: a.sets.length ? (Number(a.sets[a.sets.length - 1].reps) || 0) : 0,
      weight: a.sets.length ? (Number(a.sets[a.sets.length - 1].weight) || 0) : 0,
      setsDetail: a.sets.map(s => ({
        reps: Number(s.reps) || 0,
        weight: Number(s.weight) || 0,
        trainSec: s.trainSec || 0,
        restSec: s.restSec || 0
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

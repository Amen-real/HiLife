// pages/profile/profile.js
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const nutrition = require('../../utils/nutrition.js');
const dateRange = require('../../utils/dateRange.js');
const stats = require('../../utils/trainingStats.js');
// 「今日训练计划」口径的唯一真源（与首页「今日推荐」共用同一份，勿在此另写一套）
const todayPlan = require('../../utils/todayPlan.js');
// 开始训练前过登录门禁（与首页 startPlan / 训练页各写操作同一套）
const auth = require('../../utils/auth.js');
// 「今日未训练提醒」的口径真源：本页只负责开关与文案，判据一律读 utils/reminder.js，
// 文案里的时间阈值也取自它，避免「改了逻辑忘了改文案」两处漂移。
const privacy = require('../../utils/privacy.js');
const reminder = require('../../utils/reminder.js');
// 顶部安全区唯一真源（状态栏高度 + 微信胶囊度量）：Hero 大标题与胶囊同心的行高从这里算
const navMetrics = require('../../utils/navMetrics.js');

// Hero 背景图：明暗两张都随包发布在 static/（packOptions.ignore 为空，static 不参与忽略）。
// 两张严格同几何尺寸（852×560 → 750rpx 宽时折算 493rpx），切主题只换图不换高度，Hero 不跳版。
// <image src> 无法被 CSS 按主题改写，所以由 JS 跟着 theme 换 src（见 onShow / onToggleTheme）。
const BG_LIGHT = '/static/my-bg.jpg';
const BG_DARK = '/static/my-bg-dark.jpg';
// 主题 → 底图（唯一映射点，别在别处再写一遍三元）
function bgOf(themeCls) { return themeCls === 'theme-dark' ? BG_DARK : BG_LIGHT; }

// 备案号（ICP）—— 合规展示位，别删。
// 依据：官方《互联网信息服务备案承诺书》要求「上线时在小程序主体介绍位置（设置-关于两级菜单
// 以内页面底部显著位置或三级专用菜单内）规范标明对应备案编号，并链接至 beian.miit.gov.cn」。
// ⚠️ 号以公众平台「设置 → 基本设置」显示的为准；**拿到号只改这一行**（别写进 wxml）。
// ⚠️ 留空时页脚那一块整体不渲染（不留空壳），因此现在填不填都不影响现有版式。
// 为什么不做成可点击外跳：小程序 web-view 要求把目标域名配成「业务域名」，而业务域名必须上传
//    校验文件证明域名归属 ⇒ beian.miit.gov.cn 不是我们的域名，配不了。故走通行做法：
//    点击 → 复制工信部查询地址 + 弹一句提示。
const ICP_NO = '湘ICP备2026046448';

// 用户数据字段（导出/导入/清除只作用于这些，设备运行配置如 visionBackendUrl 等不纳入）
const DATA_KEYS = [
  'userInfo', 'profile', 'selectedActions', 'trainingPlans', 'activePlanId',
  'weightRecords', 'trainingLogs', 'meals', 'favorites', 'customActions', 'reminderOn'
];

function bmi(w, h) {
  if (!w || !h) return '--';
  const v = Number(w) / Math.pow(Number(h) / 100, 2);
  return v.toFixed(1);
}

/* ===== 「我的」页派生数据用的纯函数（口径与数据页/复盘组件保持一致） ===== */
const APP_VERSION = '1.0.0';
function round1(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 10) / 10 : 0; }
// 一场训练的名字：归属计划仍在库里就用计划名；否则按动作分类
// （单一分类取分类名，多分类记「综合训练」）。与 workout 保存时的命名规则一致，
// 避免同一场训练在两页叫出不同名字。
function logTitleOf(g, log) {
  const acts = (log && log.actions) || [];
  if (log && log.planId) {
    const hit = ((g && g.trainingPlans) || []).filter(x => x && x.id === log.planId)[0];
    if (hit && hit.name) return hit.name;
  }
  const cats = [];
  acts.forEach(a => { if (a && a.category && cats.indexOf(a.category) < 0) cats.push(a.category); });
  return cats.length ? (cats.length === 1 ? cats[0] : '综合训练') : '训练记录';
}
// 一场训练的实际度量：N 个动作 · M 分钟 · K kcal（时长/千卡口径见 utils/trainingStats.js）
function logMetaOf(log) {
  const acts = (log && log.actions) || [];
  const sec = stats.durationSecOfLog(log);
  const kcal = stats.estKcal(stats.trainSecOfLog(log));
  const parts = [];
  if (acts.length) parts.push(acts.length + ' 个动作');
  if (sec > 0) parts.push(Math.max(1, Math.round(sec / 60)) + ' 分钟');
  if (kcal > 0) parts.push(kcal + ' kcal');
  return parts.join(' · ');
}
// 大数字时长：3 小时以上给「3.2h」，不足 1 小时给「45m」
function fmtDur(totalSec) {
  const s = Number(totalSec) || 0;
  if (s <= 0) return '0m';
  if (s < 3600) return Math.round(s / 60) + 'm';
  const h = s / 3600;
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
}
// 累计容量的格式化取 trainingStats.fmtVol（单源）。
// 这里原本有一份逐字相同的副本，注释还写着「与复盘页 fmtVol 同款」——
// 一份口径抄两遍，改一处就漂一处，现已收回。
// 称号：按训练天数分档，给正反馈而非考核
function rankOf(days) {
  const d = Number(days) || 0;
  if (d <= 0) return '新手上路';
  if (d < 7) return '初出茅庐';
  if (d < 30) return '渐入佳境';
  if (d < 100) return '稳定训练者';
  if (d < 365) return '训练达人';
  return '年度铁人';
}
// BMI 分档（中国成人标准）
function bmiBucket(v) {
  if (v < 18.5) return '偏瘦';
  if (v < 24) return '正常';
  if (v < 28) return '超重';
  return '肥胖';
}
// BMI 刻度定位：显示区间 15–35，越界夹到两端避免滑块出框
function bmiMarkStyle(v) {
  const pct = Math.max(2, Math.min(98, (Number(v) - 15) / 20 * 100));
  return 'left:' + pct.toFixed(1) + '%;';
}
// BMI 分档 → 磁贴状态色调（与 bmiBucket 同一档位表，勿另开一套边界）
function bmiToneOf(v) {
  if (!v) return '';
  if (v < 18.5) return 'low';
  if (v < 24) return 'good';
  return 'bad';
}
// 最近两笔体重之差 → 磁贴第三行。tone 按「是否朝目标走」给色，而不是一律「降=绿」：
// 增肌的人涨 0.2kg 是好事，染成警示色会读反。
function weightDeltaOf(all, goalWord) {
  if (!all || all.length < 2) return { show: false, text: '', tone: '' };
  const prev = Number(all[all.length - 2].weight);
  const cur = Number(all[all.length - 1].weight);
  const d = Math.round((cur - prev) * 10) / 10;
  if (!isFinite(d) || d === 0) return { show: false, text: '', tone: '' };
  const down = d < 0;
  const good = (goalWord === '增肌') ? !down : down;
  return {
    show: true,
    text: (down ? '↓ ' : '↑ ') + Math.abs(d) + ' kg',
    tone: good ? 'good' : ''
  };
}

Page({
  data: {
    profile: {},
    loggedIn: false,
    nickname: '',
    avatarText: '衡',
    avatarUrl: '',
    // 备案号：为空串时页脚那块不渲染（见 ICP_NO 的说明）
    icpNo: ICP_NO,
    // Hero 背景图：明/暗两版各自随包发布；加载失败置 bgFailed 隐藏，露出页面底色
    bgUrl: BG_LIGHT,
    bgFailed: false,
    // 状态栏占位高度（navigationStyle=custom 后手动注入）
    statusBarStyle: 'height: 0px',
    // 账户主卡：称号 + 累计三连（days 训练天数 / streak 连续天数 / sessions 总训练次数）
    heroTitle: '新手上路',
    totals: { days: 0, streak: 0, sessions: 0, month: 0, week: 0, weekTarget: 3, dur: '0m' },
    // 我的数据：四格概览 + 解读块
    health: { goal: '未设置', weight: '未记录', height: '未设置', bmi: '--', bmiLabel: '', bmiTone: '' },
    weightDelta: { show: false, text: '', tone: '' },
    hasProfile: false,
    bmi: { show: false, label: '', markStyle: 'left:0%;' },
    goal: {
      show: false, verb: '减', done: 0, total: 0,
      from: '--', to: '--', pct: 0, fillStyle: 'width:0%;', remain: '0'
    },
    // 我的训练：首行 = 今日训练计划（mode: 'todo' 未完成 / 'done' 今日已完成 / 'empty' 空态）
    train: { show: false, mode: 'empty', tag: '', title: '', meta: '' },
    reminderOn: false,
    version: APP_VERSION,
    showDataMgr: false,
    showExportShare: false,
    exportFilePath: '',
    // 深色主题开关（数据真源在 utils/theme.js，此处仅作 switch 的 checked 绑定）
    darkMode: false,
    // 'theme-light' | 'theme-dark'
    theme: 'theme-light'
  },

  onShow() {
    const themeCls = theme.sync() === theme.DARK ? 'theme-dark' : 'theme-light';
    const patch = { theme: themeCls, darkMode: theme.get() === theme.DARK };
    // 底图跟着主题换。只在 src 真的变了时才重置失败旗标 ——
    // 否则每次 onShow 都会把一张已确认加载失败的图重新拉一遍（bgFailed 只决定删不删 <image> 节点，
    // 两种状态都露出页面底色，观感一致，所以这里只需避免无谓重载）。
    const nextBg = bgOf(themeCls);
    if (nextBg !== this.data.bgUrl) {
      patch.bgUrl = nextBg;
      patch.bgFailed = false;
    }
    this.setData(patch);
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4, theme: themeCls });
    }
    // 自定义导航栏：手动补状态栏高度占位 + 状态栏文字随主题
    // （状态栏压在 Hero 底图上：浅色主题是浅底图 → 黑字；深色主题是黑底图 → 白字）
    // （状态栏高度与胶囊度量统一走 navMetrics 单源，别在这里再写一份 fallback）
    this.setData({
      // 状态栏占位：navigationStyle=custom 后顶部交还 WebView，由 .p-sb 消费此高度。
      statusBarStyle: 'height: ' + navMetrics.statusBarHeight() + 'px'
    });
    wx.setNavigationBarColor({
      frontColor: themeCls === 'theme-dark' ? '#ffffff' : '#000000',
      backgroundColor: themeCls === 'theme-dark' ? '#0A0A0A' : '#F7F7F5'
    });
    this.refresh();
  },

  // 背景图加载失败：只隐藏自己，不留破图占位（页面底色即 Hero 底色，观感不塌）
  onBgError() { this.setData({ bgFailed: true }); },

  // 最近一场训练 → 复盘页（逐动作明细 / 趋势都在组件里）
  goReview() { wx.navigateTo({ url: '/pages/review/review' }); },

  // 「查看全部」→ 数据 tab（训练历史 + 体重历史）
  goHistory() { wx.switchTab({ url: '/pages/list/list' }); },

  // 「我的训练」首行点按：今日已完成 → 看这一场的复盘；否则去开始训练。
  // 一行两用，WXML 的 bindtap 又不支持 Mustache 动态事件名（写了会被当字面量而失效），
  // 所以统一挂静态的 onTkTap，在 JS 内按 mode 分支。
  onTkTap() {
    if (this.data.train.mode === 'done') { this.goReview(); return; }
    this.startToday();
  },

  // 开始今日训练：与首页「开始训练」同口径 —— 有计划/手动已选直进训练中页，
  // 都没有则去计划页导入（是否「有安排」问 todayPlan，不在这里重写分支）。
  startToday() {
    if (!auth.requireLogin()) return;
    if (todayPlan.resolveTodayPlan().hasPlan) {
      wx.navigateTo({ url: '/pages/workout/workout' });
      return;
    }
    this.goPlan();
  },

  // 计划页是 tabBar 页 → 只能 switchTab（navigateTo 打不开 tabBar 页，会静默失败）
  goPlan() { wx.switchTab({ url: '/pages/plan/plan' }); },

  // 「关于我们」：版本 + 署名说明（媒体署名同时在页脚常驻，满足授权可见性要求）
  tapAbout() {
    wx.showModal({
      title: '衡砺健身记录 v' + APP_VERSION,
      content: '本地优先的健身记录工具：训练 / 体重 / 饮食数据默认只存本机，可导出备份后换机恢复。\n动作演示媒体 © Gym visual · gymvisual.com',
      confirmText: '知道了',
      showCancel: false
    });
  },

  // 点备案号 → 复制工信部查询地址。
  // 为什么是「复制」而不是打开：小程序 web-view 要求把目标域名配成「业务域名」，
  // 而业务域名必须上传校验文件证明域名归属 ⇒ beian.miit.gov.cn 不是我们的域名，配不了。
  // ⚠️ wx.setClipboardData 是官方隐私接口（「剪贴板」）：用户拒绝授权时它会失败，
  //    所以成功/失败都必须有可见出口，否则就是「点了没反应」（与 _copyPath 同一类坑）。
  copyIcp() {
    const tip = '查询地址：https://beian.miit.gov.cn\n（小程序内无法直接打开外部网站，请复制后在浏览器中访问）';
    const show = (copied) => wx.showModal({
      title: '备案信息查询',
      content: (copied ? '链接已复制\n' : '链接复制失败，请手动记录\n') + tip,
      showCancel: false
    });
    wx.setClipboardData({
      data: 'https://beian.miit.gov.cn',
      success: () => show(true),
      fail: () => show(false)
    });
  },

  // 深色主题开关：切换后即时同步底栏 + 换 Hero 底图；各 tab 页（首页等）在自身 onShow 里读取新值
  onToggleTheme(e) {
    const on = !!(e && e.detail && e.detail.value);
    const t = theme.set(on ? theme.DARK : theme.LIGHT);
    const themeCls = t === theme.DARK ? 'theme-dark' : 'theme-light';
    this.setData({
      darkMode: t === theme.DARK,
      theme: themeCls,
      // 本页原地切主题不会重走 onShow，底图必须在这里一并换（否则 Hero 还是旧主题的那张）
      bgUrl: bgOf(themeCls),
      bgFailed: false
    });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ theme: themeCls });
    }
    wx.showToast({
      title: t === theme.DARK ? '已切换到深色' : '已切换到浅色',
      icon: 'none',
      duration: 1200
    });
  },

  // 今日未训练提醒：本地开关（落 store.reminderOn），由首页消费（见 utils/reminder.js）。
  // 注意这里**不做推送**：真正的推送要服务端下发订阅消息，不在此承诺。
  // 提醒的真实语义是「你今天还没练」而不是「今天是训练日」——
  // 本仓「训练日」已被占用为模板里的 A/B/C 日，且没有「周几训练」的模型，详见 reminder.js 头部注释。
  tapReminder() {
    const on = !this.data.reminderOn;
    store.setReminder(on);
    this.setData({ reminderOn: on });
    if (on) {
      wx.showModal({
        title: '已开启今日未训练提醒',
        content: '晚上 ' + reminder.REMIND_HOUR + ':00 后，若今天有安排但还没练，首页会提示你。仅在小程序内提示，不发系统推送。',
        confirmText: '知道了',
        showCancel: false
      });
    } else {
      wx.showToast({ title: '已关闭今日未训练提醒', icon: 'none', duration: 1200 });
    }
  },

  refresh() {
    const g = store.get();
    const p = g.profile || {};
    const logs = g.trainingLogs || [];

    /* ===== ① Hero 累计三连 + 训练维度小计 ===== */
    // 时长口径：整场总时长优先（durationSec，与训练页计时同源），旧日志退回逐组累加——
    // 单一真源 stats.durationSecOfLog，勿在此重写累加（数据页/复盘页/分享卡同一把尺）
    // 容量口径 = Σ(重量 × 次数)，与复盘页 loadOfLog 一致
    let totalSec = 0;
    let totalVol = 0;
    let sessions = 0;                              // 总训练次数（一场训练 = 一条日志）
    let monthCount = 0;
    let weekCount = 0;
    const trainDates = new Set();                  // 训练日集合（去重）：「训练天数」与「连续天数」共用同一份
    const today = dateRange.todayStr();
    const wr = dateRange.weekRange(today);         // 自然周半开 [周一, 下周一)，与计划页/日期条同源
    const monthPrefix = today.slice(0, 7);
    logs.forEach(l => {
      if (!l) return;
      sessions++;
      if (l.date) {
        trainDates.add(l.date);
        if (l.date.slice(0, 7) === monthPrefix) monthCount++;
        if (dateRange.inRange(l.date, wr.monStr, wr.sunStr)) weekCount++;
      }
      totalSec += stats.durationSecOfLog(l);
      (l.actions || []).forEach(a => {
        const sets = (a.setsDetail && a.setsDetail.length)
          ? a.setsDetail
          : (Array.isArray(a.sets) ? a.sets : []);
        sets.forEach(s => {
          totalVol += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        });
      });
    });
    // 周目标口径：计划 daysPerWeek > profile.weeklyTarget > 默认 3（单一真源在 trainingStats.weekTargetOf）
    const weekTarget = stats.weekTargetOf(p, store.getActivePlan()).target;
    const totals = {
      days: trainDates.size,
      // 连续天数：从今天向前连续有训练的天数。回溯算法与首页「连续打卡」同源，只是集合不同
      streak: dateRange.streakFromDates(trainDates, today),
      sessions,
      month: monthCount,
      week: weekCount,
      weekTarget,
      dur: fmtDur(totalSec),
      vol: stats.fmtVol(totalVol)
    };

    /* ===== ② 我的数据：健康四格 + 体重变化 ===== */
    const ws = store.getWeightStats();
    const latestW = ws.latest;                                   // '72.5' | null
    const latestWn = latestW != null ? Number(latestW) : null;
    const h = (p.height != null && p.height !== '') ? Number(p.height) : null;
    // 目标词归一：历史数据里的「减重」显示为规范词「减脂」（与设置页、营养推荐同词表）
    const goalWord = nutrition.normalizeGoal(p.goal) || '';
    const allW = store.getWeightStats(0).list;                    // 全部体重记录，升序（起点与变化都取这份）
    const health = {
      goal: goalWord || '未设置',
      weight: latestW != null ? latestW : '未记录',
      height: h != null ? h : '未设置',
      // 身高按 cm 校验（>80），避免误填米制时算出一个荒谬的 BMI
      bmi: bmi(latestWn, h > 80 ? h : null),
      bmiLabel: '',
      bmiTone: ''
    };

    // BMI 解读：身高按 cm 校验（>80 防误填米制）
    const bmiVal = (latestWn && h > 80)
      ? Math.round(latestWn / Math.pow(h / 100, 2) * 10) / 10
      : 0;
    const bmiInfo = bmiVal
      ? { show: true, label: bmiBucket(bmiVal), markStyle: bmiMarkStyle(bmiVal) }
      : { show: false, label: '', markStyle: 'left:0%;' };
    if (bmiVal) {
      health.bmiLabel = bmiBucket(bmiVal);
      health.bmiTone = bmiToneOf(bmiVal);
    }
    const weightDelta = weightDeltaOf(allW, goalWord);

    // 距目标：起点取最早一条体重记录（无记录则以当前体重为起点，进度为 0）
    const tw = Number(p.targetWeight);
    let goalInfo = {
      show: false, verb: '减', done: 0, total: 0,
      from: '--', to: '--', pct: 0, fillStyle: 'width:0%;', remain: '0'
    };
    if (tw > 0 && latestWn != null) {
      const startW = allW.length ? Number(allW[0].weight) : latestWn;
      const fromW = (startW > 0) ? startW : latestWn;
      const verb = tw < fromW ? '减' : '增';
      const totalN = Math.abs(fromW - tw);
      const doneN = Math.max(0, Math.abs(fromW - latestWn));     // 反向移动记 0，不出现负进度
      const remainN = Math.abs(latestWn - tw);
      const pct = totalN < 0.05 ? 100 : Math.max(0, Math.min(100, Math.round(doneN / totalN * 100)));
      goalInfo = {
        show: true, verb,
        done: round1(doneN), total: round1(totalN),
        from: round1(fromW), to: round1(tw),
        pct, fillStyle: 'width:' + pct + '%;',
        remain: round1(remainN)
      };
    }

    /* ===== ③ 我的训练：首行 = 今日训练计划 =====
       原先这里显示「最近一场」（可能是几天前的），回答不了「今天练什么 / 练完了吗」。
       现在按今天分三态，口径与首页「今日推荐」共用 utils/todayPlan.js：
         今日已完成 → 显示今天这一场的实际内容（点按看复盘）
         今日未完成但有计划 → 显示今日计划（点按开始训练）
         今天既没安排也没练过 → 落空态（点按去计划页）
       训练日志不落 image 字段，动作图只在内置动作库里（565KB，store 刻意懒加载不入本页）→ 缩略位用品牌图标。 */
    const tp = todayPlan.resolveTodayPlan();
    const todays = logs.filter(l => l && l.date === today);
    // 同日练了多场：取 createdAt 最大的一条（store 写入时带 createdAt）；缺失则取数组首条
    const todayLog = todays.length
      ? todays.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0]
      : null;

    let train = { show: false, mode: 'empty', tag: '', title: '', meta: '' };
    if (todayLog) {
      train = {
        show: true,
        mode: 'done',
        tag: '已完成',
        title: logTitleOf(g, todayLog),
        meta: logMetaOf(todayLog)
      };
    } else if (tp.hasPlan) {
      train = {
        show: true,
        mode: 'todo',
        tag: '今日',
        title: tp.title,
        meta: tp.sub                       // 模板计划时是「方案名 · N 个动作 · 约 M 分钟」
      };
    }
    // 两者都不满足 → show:false，走空态（今天没安排、也没练过）

    // 空态：热量推荐所需的「身高 + 体重 + 目标」三件套缺一即引导完善
    const hasProfile = !!(h > 80 && latestWn && p.goal);

    this.setData({
      profile: p,
      loggedIn: !!g.userInfo.loggedIn,
      nickname: g.userInfo.nickname,
      avatarUrl: g.userInfo.avatar || '',
      avatarText: g.userInfo.loggedIn ? (g.userInfo.nickname || '衡')[0] : '衡',
      heroTitle: rankOf(p.fitnessDays),
      totals,
      health,
      weightDelta,
      hasProfile,
      bmi: bmiInfo,
      goal: goalInfo,
      train,
      reminderOn: !!g.reminderOn
    });
  },

  // Hero 头像圈点击：未登录=登录，已登录=换头像。
  // WXML 的 bindtap 不支持 Mustache 动态事件名（写了会被当成字面量字符串而失效），故由这里分支。
  onIdTap() {
    if (this.data.loggedIn) this.onChooseAvatar();
    else this.wechatLogin();
  },

  // 本地登录：不调用 wx.login / 云函数，生成本地匿名标识作为登录态
  // 同一设备复用稳定 local_uid（不关联真实微信身份，数据仅存本机）
  // uid 生成已抽到 auth.ensureLocalLogin 单源（首启引导页共用），此处只保留交互反馈
  wechatLogin() {
    if (this.data.loggedIn) return;
    auth.ensureLocalLogin();
    wx.showToast({ title: '登录成功', icon: 'success' });
    this.refresh();
  },

  // 「关于与数据」里的账号兜底行：未登录直接登录；已登录展示账号信息。
  // 说明只写实现得了的事：本机账号 + 退出暂存/登录恢复 + 导出导入换机，不承诺云端同步。
  tapAccount() {
    if (!this.data.loggedIn) { this.wechatLogin(); return; }
    wx.showModal({
      title: '账号信息',
      content: '昵称：' + (this.data.nickname || '未填写')
        + '\n登录方式：本机账号（不关联微信身份）'
        + '\n\n数据仅保存在本机；退出登录会暂存，重新登录自动恢复。'
        + '更换设备请用「数据管理 → 导出」生成备份，在新机导入即可恢复全部数据。',
      confirmText: '知道了',
      showCancel: false
    });
  },

  // 头像：从相册/拍照选择，保存到本地持久目录（不依赖微信临时路径，刷新不失效）
  // 先过隐私授权：拒绝后 wx.chooseMedia 只会静默失败（点了没反应），
  // 由 utils/privacy.js 统一给一句人话说明，并留一次重新授权的机会。
  onChooseAvatar() {
    privacy.ensure('更换头像').then((ok) => {
      if (!ok) return;
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const temp = res.tempFiles[0].tempFilePath;
          wx.getFileSystemManager().saveFile({
            tempFilePath: temp,
            success: (r) => {
              const saved = r.savedFilePath;
              store.setUserProfile(undefined, saved);
              this.setData({ avatarUrl: saved });
            },
            fail: () => {
              // 保存失败则退回临时路径
              store.setUserProfile(undefined, temp);
              this.setData({ avatarUrl: temp });
            }
          });
        }
      });
    });
  },
  // 昵称输入实时回显（避免受控 input 光标跳动）
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },
  // 昵称失焦时持久化
  onNicknameBlur(e) {
    store.setUserProfile(e.detail.value, this.data.avatarUrl);
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后健康数据和训练记录将暂时隐藏，重新登录后自动恢复。',
      confirmText: '退出',
      confirmColor: '#F2545B',
      success: (r) => {
        if (r.confirm) {
          store.logout();
          this.setData({ avatarUrl: '' });
          this.refresh();
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      }
    });
  },

  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },

  // 点击「隐私政策」→ 进入隐私政策页查看完整内容
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  /* ===== 数据管理面板：进入 / 关闭 ===== */
  openDataMgr() { this.setData({ showDataMgr: true }); },
  closeDataMgr() { this.setData({ showDataMgr: false }); },
  // 阻止点击面板内容区冒泡到遮罩（避免误关）
  stopTap() {},

  /* ===== 数据管理：导出 / 导入 / 清除 ===== */
  // 导出：写文件 → 弹「转发」面板 → 用户点按钮时在 TAP 回调里调 shareFileMessage（满足手势要求）
  exportData() {
    this.closeDataMgr();
    const g = getApp().globalData;
    const payload = { _app: 'hilife', _ver: 1, _exportedAt: Date.now() };
    DATA_KEYS.forEach(k => { payload[k] = g[k]; });
    const json = JSON.stringify(payload);
    const fs = wx.getFileSystemManager();
    const path = `${wx.env.USER_DATA_PATH}/hilife-backup-${Date.now()}.txt`;
    wx.showLoading({ title: '生成备份...' });
    fs.writeFile({
      filePath: path,
      data: json,
      encoding: 'utf8',
      success: () => {
        wx.hideLoading();
        // 保存路径并弹出转发面板（shareFileMessage 必须在用户 TAP 回调中调用）
        this.setData({ showExportShare: true, exportFilePath: path });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); }
    });
  },

  // 用户点击「转发文件」按钮时直接调用（满足 TAP gesture 要求）
  doShareFile() {
    const path = this.data.exportFilePath;
    if (!path) return;
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: path,
        fileName: 'hilife-backup.txt',
        success: () => {
          this.setData({ showExportShare: false, exportFilePath: '' });
          wx.showToast({ title: '导出成功', icon: 'success' });
        },
        fail: (err) => {
          console.warn('[export] shareFileMessage 失败：', err);
          this.setData({ showExportShare: false, exportFilePath: '' });
          wx.showToast({ title: '转发失败，请重试', icon: 'none' });
        }
      });
    } else {
      // PC 端小程序 / 开发者工具没有 wx.shareFileMessage —— 必须走降级链，
      // 否则「导出」在这类环境里等于不可用（原来只弹一句「不支持转发文件」就结束了，
      // 而下面那个注释写着「导出降级：PC 端另存为；再不行复制文件路径」的 _saveFallback
      // 从未被任何地方调用，属于断掉的降级链）。
      // _saveFallback 内部：先试 wx.saveFileToDisk（另存为），失败或缺失则复制文件路径。
      this._saveFallback(path);
    }
  },

  closeExportShare() { this.setData({ showExportShare: false, exportFilePath: '' }); },

  // 导出降级：PC 端另存为；再不行复制文件路径
  _saveFallback(path) {
    this.setData({ showExportShare: false, exportFilePath: '' });
    if (wx.saveFileToDisk) {
      wx.saveFileToDisk({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到本地', icon: 'success' }),
        fail: () => this._copyPath(path)
      });
    } else {
      this._copyPath(path);
    }
  },

  // 导出降级链的最后一环：复制文件路径。
  // wx.setClipboardData 是官方隐私接口（「剪贴板」），用户拒绝隐私授权时它会失败。
  // 原先这里**只写了 success**，于是导出在「PC 端 / 不支持 shareFileMessage」的环境里
  // 会静默断掉：loading 结束、面板关闭，然后什么都没有，用户以为导出成功了。
  // 路径本身才是这次导出的结果 —— 成败都要让用户看到它，只是文案换一句。
  _copyPath(path) {
    const show = (copied) => wx.showModal({
      title: '导出',
      content: (copied ? '文件已生成，路径已复制：\n' : '文件已生成，但路径复制失败，请手动记录：\n')
        + path + '\n（当前环境不支持直接转发，请在文件管理器中找到该文件手动发送）',
      showCancel: false
    });
    wx.setClipboardData({
      data: path,
      success: () => show(true),
      fail: () => show(false)
    });
  },

  // 导入：从微信会话选择备份 JSON，覆盖用户数据字段（设备配置保持当前设备值）
  importData() {
    this.closeDataMgr();
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'json'],
      success: (res) => {
        const file = res.tempFiles[0];
        const fs = wx.getFileSystemManager();
        wx.showLoading({ title: '导入中...' });
        fs.readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => {
            wx.hideLoading();
            try {
              const data = JSON.parse(r.data);
              if (data._app !== 'hilife') {
                wx.showModal({ title: '导入失败', content: '这不是衡砺健身记录的备份文件', showCancel: false });
                return;
              }
              const g = getApp().globalData;
              // 结构校验：只验 _app 不够 —— 截断/手改的备份文件可能把数组键写成
              // 字符串、把对象键写成 null，直接灌入会让 home/advice 等页 refresh 全崩。
              // 逐键比对「与现有默认值同型」，不同型的整键丢弃（宁少导入不多崩）。
              DATA_KEYS.forEach(k => {
                if (data[k] === undefined) return;
                const cur = g[k];
                const ok =
                  Array.isArray(cur) ? Array.isArray(data[k]) :
                  (cur && typeof cur === 'object') ? !!(data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) :
                  typeof data[k] === typeof cur;
                if (ok) g[k] = data[k];
              });
              g.reminderOn = !!g.reminderOn;
              getApp().persist();
              this.refresh();
              wx.showToast({ title: '导入成功', icon: 'success' });
            } catch (e) {
              wx.showModal({ title: '导入失败', content: '文件解析出错：' + (e.message || e), showCancel: false });
            }
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '读取失败', icon: 'none' }); }
        });
      },
      fail: (e) => {
        // 用户主动取消不打扰；权限被拒/异常必须给一句人话 ——
        // wx.chooseMessageFile 是「选中的文件」隐私接口，拒绝授权时走的就是这条，
        // 静默失败 = 「点了没反应」（与 copyEmail / copyIcp 同一类坑，见 privacy.wxml 的声明）。
        if (e && /cancel/i.test(e.errMsg || '')) return;
        wx.showToast({ title: '未能选择文件', icon: 'none' });
      }
    });
  },

  // 清除：重置全部用户数据 + 登录态，并清掉本地登录标识与退出快照
  clearLocalData() {
    wx.showModal({
      title: '清除本机数据',
      content: '将清除全部训练记录、体重、饮食、计划、收藏等本地数据，且不可恢复。确定继续？',
      confirmText: '清除',
      confirmColor: '#F2545B',
      success: (r) => {
        if (!r.confirm) return;
        this.closeDataMgr();
        const g = getApp().globalData;
        g.userInfo = { loggedIn: false, nickname: '', avatar: '' };
        // 与 utils/store.js logout() 里的重置对象保持完全一致（字段与默认值都对齐），
        // 否则两处默认值会各自漂移：此前此处缺 weeklyTarget/age/activityLevel/intakeOverride
        g.profile = { gender: '', goal: '减脂', targetWeight: null, height: null, currentWeight: null, fitnessDays: 0, weeklyTarget: 3, age: null, activityLevel: 'moderate', intakeOverride: null };
        g.selectedActions = [];
        g.trainingPlans = [];
        g.activePlanId = '';
        g.weightRecords = [];
        g.trainingLogs = [];
        g.meals = [];
        g.favorites = [];
        g.customActions = [];
        g.reminderOn = false;
        g.reminderDismissedOn = '';
        getApp().persist();
        wx.removeStorageSync('local_uid');
        wx.removeStorageSync('uu_fitness_backup');
        wx.removeStorageSync('onboardingDone');   // 清除 = 回到首次打开：下次进首页重新弹首启引导
        // 识别纠错库（含历史修正值）：属用户数据衍生，不清的话旧修正会套到清空后的新记录上。
        // metrics（埋点计数）/ app_theme / hh_*（震动、悬浮球位置）是旁路统计与设备偏好，刻意保留。
        wx.removeStorageSync('uu_fitness_foodkb');
        this.refresh();
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  }
});

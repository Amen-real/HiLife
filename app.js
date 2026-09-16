// app.js
const auth = require('./utils/auth.js');
const store = require('./utils/store.js');

App({
  globalData: {
    // 登录与用户
    userInfo: {
      loggedIn: false,
      nickname: '',
      avatar: ''
    },

    // 健康档案
    profile: {
      gender: '',          // '' | '男' | '女'
      goal: '减脂',        // 减脂 | 增肌 | 塑形 | 保持（词表真源：utils/nutrition.js GOALS）
      targetWeight: null,  // kg
      height: null,        // cm
      currentWeight: null, // kg
      fitnessDays: 0,
      age: null,            // 岁（营养推荐 TDEE 计算用）
      activityLevel: 'moderate', // sedentary|light|moderate|high|athlete（活动量系数）
      intakeOverride: null  // 手动覆盖的每日目标热量（null = 跟随推荐）
    },

    // 今日训练
    selectedActions: [],   // 已选动作对象数组（用户每日自行选择的「今日计划」）
    planDate: '',          // selectedActions 所属日期：跨天自动清空，保证每天重新选择
    restTimer: 90,         // 休息计时（秒）

    // 训练计划
    trainingPlans: [],     // 多套训练计划 { id, name, actions:[{ actionId, name, nameZh, part, category, setsCount, reps, weight }] }
    activePlanId: '',      // 当前计划 id

    // 数据记录
    weightRecords: [],     // { date:'2025-07-23', weight:68.5 }
    trainingLogs: [],      // { date, actions:[{name, sets, reps, weight}] }
    meals: [],             // 已记录饮食 { type, name, calories, protein, carb, fat }

    // 复盘「关键动作」自定义选择：存 actionKey 数组（空数组 = 用自动前 3）
    keyActionPicks: [],

    // 收藏
    favorites: [],         // 收藏的动作 id 数组

    // 用户自建动作（我的动作）
    customActions: [],

    // 设置
    reminderOn: false,          // 「今日未训练提醒」总开关（语义与判据见 utils/reminder.js）
    reminderDismissedOn: '',    // 用户关掉提醒的日期 'YYYY-MM-DD'，跨天自动失效

    // 视觉识别（多模态大模型）后端地址，**故意留空**。
    // 上线链路走云托管（下方 useCallContainer: true），根本不需要这个地址；
    // 只有开发期联调（useCallContainer 置 false）才需要填本地 vision-server。
    // 之所以不再给默认值：局域网地址随机器/网段变化，写进仓库既泄漏内网拓扑，
    // 又会让后来者误以为「192.168.x.x 就是我们的后端」——那是某台开发机的瞬时状态。
    // 联调时就地填 'http://<你的局域网IP>:8000'，**提交前改回空串**。
    visionBackendUrl: '',

    // ===== 微信云托管（生产链路，免备案免域名）=====
    // true: callContainer 调云托管。⚠️ callContainer 有 15s 硬超时（errCode 102002），同步识别必超时，
    //   已改为「异步任务」：POST /task/submit 秒回 taskId → 每 2s GET /task/{id} 轮询（约 90s 上限）。
    //   云托管 hilife-vision 需部署 server/ 最新代码，并在服务设置配环境变量：
    //   LLM_API_KEY（必填，配了走大模型；不配回退 mock）、LLM_MODEL（默认 qwen-vl-plus）、LLM_BASE_URL（默认百炼）。
    // false: 走普通 wx.uploadFile 到 visionBackendUrl（局域网 vision-server，开发联调用）。
    useCallContainer: true,
    // 云托管所在「云开发环境 ID」（云托管是云开发的能力，与上方云存储同环境）
    cloudEnv: 'cloud1-d0g5ihto42b4ed256',
    // 云托管服务名称（部署时在云托管控制台「服务管理」自定义，保持一致即可）
    visionService: 'hilife-vision'
  },

  onLaunch() {
    // 云开发初始化：云存储（cloud:// 文件 ID）渲染前必须先 init
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d0g5ihto42b4ed256', // 云开发环境 ID
        traceUser: true
      });
    } else {
      console.error('当前基础库不支持云开发，请升级到 2.2.3 及以上基础库');
    }

    // 原型：从本地缓存恢复（模拟持久化）
    const saved = wx.getStorageSync('uu_fitness_state');
    if (saved) {
      Object.assign(this.globalData, saved);
    }

    // 每日重置「今日训练计划」：跨天则清空上次选择的动作，要求用户每日自行选择（避免默认沿用上次）
    const now = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    if (this.globalData.planDate !== todayStr) {
      this.globalData.selectedActions = [];
      this.globalData.planDate = todayStr;
      this.persist();
    }

    // 开程序提示登录：未登录时弹一次性引导（「我的」页可随时登录）
    // 关键：onLaunch 内 getApp() 不可靠，必须把已恢复登录态的 this 传入，否则已登录用户也会被误弹
    auth.promptLoginOnLaunch(this);

    // 隐私授权（基础库 2.32.3+ 强制）：首次触发隐私相关接口前，微信弹官方授权窗。
    // 需先在公众平台「设置 → 服务内容声明 → 用户隐私保护指引」填写并发布，否则可能不弹或报错。
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: () => { console.log('[privacy] 用户已同意隐私政策'); },
        fail: () => { console.warn('[privacy] 用户拒绝隐私授权'); },
        complete: () => {}
      });
    }
  },

  // 统一持久化
  persist() {
    wx.setStorageSync('uu_fitness_state', this.globalData);
  }
});

// 暴露 store 便于页面引用
module.exports = { store };

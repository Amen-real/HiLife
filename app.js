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
      goal: '减重',        // 减重 | 增肌 | 塑形 | 保持
      targetWeight: null,  // kg
      height: null,        // cm
      currentWeight: null, // kg
      fitnessDays: 0
    },

    // 今日训练
    selectedActions: [],   // 已选动作对象数组
    restTimer: 90,         // 休息计时（秒）

    // 训练计划
    trainingPlans: [],     // 多套训练计划 { id, name, actions:[{ actionId, name, nameZh, part, category, setsCount, reps, weight }] }
    activePlanId: '',      // 当前计划 id

    // 数据记录
    weightRecords: [],     // { date:'2025-07-23', weight:68.5 }
    trainingLogs: [],      // { date, actions:[{name, sets, reps, weight}] }
    meals: [],             // 已记录饮食 { type, name, calories, protein, carb, fat }

    // 收藏
    favorites: [],         // 收藏的动作 id 数组

    // 用户自建动作（我的动作）
    customActions: [],

    // 设置
    reminderOn: false,

    // 自托管 CalorieScan 后端地址（拍照识别用）；为空则 utils/caloriescan.js 用默认地址
    backendUrl: '',

    // 视觉识别（多模态大模型）后端地址；为空则 utils/foodvision.js 用默认地址
    // 开发期联调（useCallContainer=false 时）填后端局域网/公网地址
    visionBackendUrl: 'http://192.168.110.238:8000',

    // ===== 微信云托管（上线默认，免备案免域名）=====
    // true: 小程序经 wx.cloud.callContainer 调云托管（前端压缩图片→base64，受 100K 限制）
    // false: 走普通 wx.uploadFile 到 visionBackendUrl（需备案域名 + 微信后台配合法域名）
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

    // 开程序提示登录：未登录时弹一次性引导（「我的」页可随时登录）
    // 关键：onLaunch 内 getApp() 不可靠，必须把已恢复登录态的 this 传入，否则已登录用户也会被误弹
    auth.promptLoginOnLaunch(this);
  },

  // 统一持久化
  persist() {
    wx.setStorageSync('uu_fitness_state', this.globalData);
  }
});

// 暴露 store 便于页面引用
module.exports = { store };

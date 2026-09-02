// utils/store.js
// 轻量全局状态管理：读写 getApp().globalData 并统一持久化

function app() {
  return getApp();
}
function g() {
  return app().globalData;
}

// 懒加载内置动作库：仅当「从计划开始训练」触发回查时才 require，避免启动期加载全量库影响首屏性能
let _exercises = null;
function getExercises() {
  if (_exercises === null) {
    try { _exercises = require('./exercises.js'); } catch (e) { _exercises = { library: {} }; }
  }
  return _exercises;
}

const store = {
  /* ---------- 基础 ---------- */
  get() {
    return g();
  },
  persist() {
    app().persist();
  },

  /* ---------- 体重 ---------- */
  addWeight(date, weight, note) {
    const list = g().weightRecords.filter(r => r.date !== date);
    list.push({ date, weight: Number(weight), note: note || '' });
    list.sort((a, b) => a.date.localeCompare(b.date));
    g().weightRecords = list;
    g().profile.currentWeight = Number(weight);
    if (g().profile.targetWeight) {
      const diff = Number(weight) - g().profile.targetWeight;
      g().profile.weightDiff = Number(diff.toFixed(1));
    }
    this.persist();
    return list;
  },
  setWeightNote(date, note) {
    const list = g().weightRecords;
    const rec = list.find(r => r.date === date);
    if (!rec) return;
    rec.note = note || '';
    this.persist();
  },
  getWeightStats(rangeDays) {
    const list = g().weightRecords;
    if (!list.length) return { list: [], max: null, min: null, days: 0, latest: null, change: null };
    let filtered = list;
    if (rangeDays) {
      const today = new Date();
      const from = new Date(today.getTime() - (rangeDays - 1) * 86400000);
      const fromStr = from.toISOString().slice(0, 10);
      filtered = list.filter(r => r.date >= fromStr);
    }
    const weights = filtered.map(r => r.weight);
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    const latest = filtered[filtered.length - 1].weight;
    const first = filtered[0].weight;
    return {
      list: filtered,
      max: max.toFixed(1),
      min: min.toFixed(1),
      days: filtered.length,
      latest: latest.toFixed(1),
      change: (latest - first).toFixed(1),
      down: (latest - first) < 0
    };
  },

  /* ---------- 动作选择（今日训练） ---------- */
  toggleSelect(action) {
    const sel = g().selectedActions;
    const idx = sel.findIndex(a => a.id === action.id);
    if (idx >= 0) {
      sel.splice(idx, 1);
    } else {
      sel.push(action);
    }
    this.persist();
    return sel;
  },
  // 加入本次训练：按 id 去重，已存在则覆盖（确保预置组生效）
  addSelected(action) {
    const sel = g().selectedActions;
    const idx = sel.findIndex(a => a.id === action.id);
    if (idx >= 0) sel[idx] = action;
    else sel.push(action);
    this.persist();
    return sel;
  },
  // 从本次训练移除某个已选动作（按 id）
  removeSelected(id) {
    g().selectedActions = g().selectedActions.filter(a => a.id !== id);
    this.persist();
    return g().selectedActions;
  },
  // 更新某个已选动作的训练参数（patch 合并到该动作对象上，如重建 sets 数组）
  updateSelected(id, patch) {
    const sel = g().selectedActions;
    const idx = sel.findIndex(a => a.id === id);
    if (idx >= 0) {
      sel[idx] = Object.assign({}, sel[idx], patch);
      this.persist();
    }
    return sel;
  },
  isSelected(id) {
    return g().selectedActions.some(a => a.id === id);
  },
  clearSelected() {
    g().selectedActions = [];
    this.persist();
  },

  /* ---------- 用户自建动作 ---------- */
  addCustomAction(action) {
    action.custom = true; // 保证数据层始终带自建标记
    g().customActions.push(action);
    this.persist();
    return g().customActions;
  },
  // 删除自建动作：从「我的动作」库移除，并同步清掉本次训练中残留的该动作
  removeCustomAction(id) {
    g().customActions = g().customActions.filter(a => a.id !== id);
    g().selectedActions = g().selectedActions.filter(a => a.id !== id);
    this.persist();
    return g().customActions;
  },

  /* ---------- 收藏 ---------- */
  toggleFavorite(id) {
    const f = g().favorites;
    const idx = f.indexOf(id);
    if (idx >= 0) f.splice(idx, 1);
    else f.push(id);
    this.persist();
    return f;
  },
  isFavorite(id) {
    return g().favorites.indexOf(id) >= 0;
  },

  /* ---------- 饮食记录 ---------- */
  // meal: { type, name, calories, protein, carb, fat, note? }
  // 内部补全 id/time/note，保证每条记录可唯一定位、可扩展备注（向后兼容旧调用）
  addMeal(meal) {
    const m = Object.assign({
      id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      time: Date.now(),
      note: ''
    }, meal);
    g().meals.push(m);
    this.persist();
    return g().meals;
  },
  // 删除单条饮食记录
  deleteMeal(id) {
    g().meals = g().meals.filter(m => m.id !== id);
    this.persist();
    return g().meals;
  },
  // 修改单条饮食记录：按 id 定位并合并补丁字段（type/name/calories/protein/carb/fat/portion/note）
  updateMeal(id, patch) {
    const meals = g().meals;
    const idx = meals.findIndex(m => m.id === id);
    if (idx >= 0) {
      meals[idx] = Object.assign({}, meals[idx], patch);
      this.persist();
    }
    return meals;
  },
  getTodayCalories() {
    return g().meals.reduce((s, m) => s + (m.calories || 0), 0);
  },

  /* ---------- 健康档案 ---------- */
  updateProfile(patch) {
    Object.assign(g().profile, patch);
    this.persist();
    return g().profile;
  },

  /* ---------- 训练计划 ---------- */
  // plan: { name, actions:[{ actionId, name, nameZh, part, category, setsCount, reps, weight }] }
  addPlan(plan) {
    const p = Object.assign({
      id: 'plan_' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // 周期规划（Phase 2）：可选 cycle 字段，向后兼容旧计划（无 cycle 照常工作）
      cycle: (plan && plan.cycle) || null
    }, plan);
    g().trainingPlans.push(p);
    // 注意：创建计划不再自动设为“使用中”，交由用户在创建成功后确认（避免“创建即默认启用”）
    this.persist();
    return p;
  },
  updatePlan(id, patch) {
    const list = g().trainingPlans;
    const idx = list.findIndex(p => p.id === id);
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() });
      this.persist();
    }
    return list;
  },
  deletePlan(id) {
    g().trainingPlans = g().trainingPlans.filter(p => p.id !== id);
    if (g().activePlanId === id) g().activePlanId = '';
    this.persist();
    return g().trainingPlans;
  },
  setActivePlan(id) {
    g().activePlanId = id;
    this.persist();
    return id;
  },
  getActivePlan() {
    const id = g().activePlanId;
    if (!id) return null;
    return g().trainingPlans.find(p => p.id === id) || null;
  },
  // 计划动作 → 带预置组的训练动作（供「本次训练」使用；组数/次数/重量训练时填写，setsCount 默认 0 → 1 组空）
  // 关键：回查原始动作库补全 image/emoji/equip/video，否则训练/演示页无预览图（之前被写死成空串导致）
  planActionToTrain(pa) {
    const src = this._findSourceAction(pa.actionId) || {};
    const reps = pa.reps != null && pa.reps !== '' ? String(pa.reps) : '';
    const weight = pa.weight != null && pa.weight !== '' ? String(pa.weight) : '';
    const n = Math.max(1, Number(pa.setsCount) || 1);
    // 预置 rpe 字段（默认空），供训练结束记录自觉费力度（RPE）——复盘/滚动对比的数据前提，向后兼容
    const sets = Array.from({ length: n }, () => ({ reps, weight, trainSec: 0, restSec: 0, rpe: '' }));
    return {
      id: pa.actionId,
      name: pa.name,
      nameZh: pa.nameZh || pa.name,
      category: pa.category,
      part: pa.part,
      equip: pa.equip != null ? pa.equip : (src.equip || ''),
      image: pa.image != null ? pa.image : (src.image || ''),
      emoji: pa.emoji != null ? pa.emoji : (src.emoji || ''),
      video: pa.video != null ? pa.video : (src.video || ''),
      sets: sets
    };
  },
  // 按 actionId 回查原始动作：自建动作优先，其次懒加载内置库。用于补全计划动作缺失的图片等展示字段
  _findSourceAction(actionId) {
    if (!actionId) return null;
    const customs = g().customActions || [];
    const hit = customs.find(a => a.id === actionId);
    if (hit) return hit;
    const lib = (getExercises().library) || {};
    for (const key in lib) {
      if (Array.isArray(lib[key])) {
        const f = lib[key].find(a => a.id === actionId);
        if (f) return f;
      }
    }
    return null;
  },
  // 把某计划注入「本次训练」（清空后添加），供首页/计划页「开始训练」调用
  applyPlanToSelected(plan) {
    this.clearSelected();
    (plan.actions || []).map(pa => this.planActionToTrain(pa)).forEach(a => this.addSelected(a));
  },

  /* ---------- 训练日志 ---------- */
  // 每次保存 = 一次独立训练场次（允许同一天多次训练，如"再练一次"），不再按日期合并覆盖
  // 每条记录带唯一 sid + createdAt，供列表/详情按场次精确定位；fitnessDays 按去重日期计训练天数
  saveTrainingLog(log) {
    const list = g().trainingLogs.slice();
    const entry = {
      sid: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      date: log.date,
      createdAt: Date.now(),
      actions: log.actions || []
    };
    list.push(entry);
    // 排序：日期倒序；同日按场次创建时间倒序（最新一次在前）
    list.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    g().trainingLogs = list;
    // 训练天数 = 去重日期数（非场次次数）
    g().profile.fitnessDays = new Set(list.map(l => l.date)).size;
    this.persist();
    return list;
  },

  /* ---------- 设置 ---------- */
  setReminder(on) {
    g().reminderOn = on;
    this.persist();
  },
  // 本地登录：openid 字段在此存放本地匿名标识 local_uid（不关联真实微信身份）
  // 单用户本地模式：若退出时存有数据快照，登录时自动恢复
  login(openid, nickname, avatar) {
    const data = g();
    const backup = wx.getStorageSync('uu_fitness_backup');
    if (backup) {
      // 恢复退出前快照的用户数据
      data.profile = backup.profile || data.profile;
      data.weightRecords = backup.weightRecords || [];
      data.trainingLogs = backup.trainingLogs || [];
      data.meals = backup.meals || [];
      data.trainingPlans = backup.trainingPlans || [];
      data.customActions = backup.customActions || [];
      data.favorites = backup.favorites || [];
      data.activePlanId = backup.activePlanId || '';
      data.selectedActions = backup.selectedActions || [];
      data.userInfo = {
        loggedIn: true,
        openid: openid || '',
        nickname: nickname || (backup.userInfo && backup.userInfo.nickname) || '健身用户',
        avatar: avatar || (backup.userInfo && backup.userInfo.avatar) || ''
      };
      wx.removeStorageSync('uu_fitness_backup'); // 恢复后清除快照
    } else {
      data.userInfo = {
        loggedIn: true,
        openid: openid || '',
        nickname: nickname || '健身用户',
        avatar: avatar || ''
      };
    }
    this.persist();
  },
  // 退出登录：快照用户数据后重置为默认值（数据暂存，重新登录自动恢复）
  logout() {
    const data = g();
    // 快照所有用户产生的数据
    const backup = {
      profile: data.profile,
      weightRecords: data.weightRecords,
      trainingLogs: data.trainingLogs,
      meals: data.meals,
      trainingPlans: data.trainingPlans,
      customActions: data.customActions,
      favorites: data.favorites,
      activePlanId: data.activePlanId,
      selectedActions: data.selectedActions,
      userInfo: { nickname: data.userInfo.nickname, avatar: data.userInfo.avatar }
    };
    wx.setStorageSync('uu_fitness_backup', backup);
    // 重置为默认值，使所有页面显示空状态
    data.profile = { gender: '', goal: '减重', targetWeight: null, height: null, currentWeight: null, fitnessDays: 0 };
    data.weightRecords = [];
    data.trainingLogs = [];
    data.meals = [];
    data.trainingPlans = [];
    data.customActions = [];
    data.favorites = [];
    data.activePlanId = '';
    data.selectedActions = [];
    data.userInfo = { loggedIn: false, openid: '', nickname: '', avatar: '' };
    this.persist();
  },
  // 更新昵称 / 头像（头像昵称填写组件回写）
  setUserProfile(nickname, avatar) {
    const u = g().userInfo;
    if (nickname !== undefined && nickname !== null) u.nickname = nickname;
    if (avatar !== undefined && avatar !== null) u.avatar = avatar;
    this.persist();
  }
};

module.exports = store;

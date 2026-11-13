// utils/workoutSession.js
// 训练中页面的「全局会话」：最小化或离开训练页后，悬浮计时窗仍可在其它 tab 页显示，
// 点击可恢复（resume）未完成的训练。
//
// 持久化（2026-11-13）：内存为主 + 同步落盘。此前纯内存单例，小程序被杀/冷启动后
// 会话即丢（用户训练中误退小程序 → 当场训练进度全没了）。现在每次变更同步写
// storage（数据量小、写入频率 = 每组输入/计时启停，远够不着 1MB 单键红线），
// 冷启动后 load()/has()/getElapsed() 惰性水合恢复。
//
// 跨启动护栏（回应旧注释「避免跨启动误恢复」）：
//   · 新鲜度：updatedAt 超 24h 的落盘会话视为过期，不恢复；
//   · 来源校验仍由调用方做：workout 页 onLoad 用 signature === 来源签名 判断，
//     期间删了计划/换了动作 → 签名不符 → 走新建，不会误恢复；
//   · 计时口径：水合时若 running 且离开间隔 > 30min（已不在训练场景）自动冻结，
//     间隔 ≤ 30min 视为真实休息、墙上时间继续走（wxml 墙上时间模型不变）。
//
// 计时模型采用「墙上时间」：running 时记录 startTs，getElapsed() 按 Date.now()-startTs 实时累加，
// 即使训练页被卸载（interval 清除），悬浮窗仍可通过真实时间继续走表；重新进入训练页自动续跑。
const KEY = 'hh_workout_session';
const FRESH_MS = 24 * 3600 * 1000;        // 落盘会话最大新鲜度：超时作废
const GAP_FREEZE_MS = 30 * 60 * 1000;     // 冷启动恢复时，running 间隔超过此值自动冻结
let session = null;
let hydrated = false;                      // 本次应用会话只从 storage 水合一次
const listeners = [];

// node 直跑环境（守卫/探针 require 本模块）无 wx：持久化全部静默降级
function hasWx() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';
}

// 冷启动水合：读落盘会话，过新鲜度/结构校验后注入内存单例
function ensure() {
  if (hydrated) return;
  hydrated = true;
  if (!hasWx()) return;
  try {
    const raw = wx.getStorageSync(KEY);
    if (!raw || !raw.signature || !Array.isArray(raw.actions) || !raw.actions.length) return;
    if ((Date.now() - (raw.updatedAt || 0)) >= FRESH_MS) return;
    if (raw.running && raw.startTs && (Date.now() - raw.startTs) > GAP_FREEZE_MS) {
      raw.running = false;   // 离开超过 30 分钟视为已离开训练场景：不再补记这段墙上时间
      raw.startTs = null;
    }
    session = raw;
  } catch (e) { /* 落盘损坏/脏数据：当作无会话，静默 */ }
}

// 同步落盘（每次变更后调用；失败静默 —— 持久化是尽力而为，绝不阻塞训练主流程）
function persist() {
  if (!session || !hasWx()) return;
  try {
    wx.setStorageSync(KEY, Object.assign({}, session, { updatedAt: Date.now() }));
  } catch (e) { /* storage 满/异常：静默，内存会话不受影响 */ }
}

function emit() {
  listeners.slice().forEach(cb => { try { cb(session); } catch (e) {} });
}

module.exports = {
  // 保存/覆盖一个可恢复的训练会话（来自 workout 页面，含动作进度与计时）
  save(data) { session = data; persist(); emit(); },
  // 合并更新（保留 running/startTs 等计时字段，不被覆盖）
  update(partial) {
    if (session) session = Object.assign({}, session, partial);
    else session = partial;
    persist();
    emit();
  },
  // 读取当前会话（可能为 null；冷启动首次调用时先从 storage 水合）
  load() { ensure(); return session; },
  // 是否存在可恢复会话
  has() { ensure(); return !!session; },
  // 当前实时累计秒数（running 时按真实时间累加 —— 实现离开页面后后台继续计时）
  getElapsed() {
    ensure();
    if (!session) return 0;
    let base = session.elapsed || 0;
    if (session.running && session.startTs) {
      base += Math.floor((Date.now() - session.startTs) / 1000);
    }
    return base;
  },
  // 开始/继续计时：把 startTs 设为现在、running=true；若已在 running 则先把墙上时间折算进 elapsed 再续
  markRunning() {
    if (!session) return;
    if (session.running && session.startTs) {
      session.elapsed += Math.floor((Date.now() - session.startTs) / 1000);
    }
    session.running = true;
    session.startTs = Date.now();
    persist();
    emit();
  },
  // 暂停计时：冻结 elapsed，running=false（离开后台前若需停表用此）
  freeze() {
    if (!session) return;
    if (session.running && session.startTs) {
      session.elapsed += Math.floor((Date.now() - session.startTs) / 1000);
      session.running = false;
      session.startTs = null;
    }
    persist();
    emit();
  },
  // 仅把 elapsed 同步为实时值（不冻结，startTs 顺延为现在）——供离开页面前保存最新进度
  syncElapsed() {
    if (session && session.running && session.startTs) {
      session.elapsed += Math.floor((Date.now() - session.startTs) / 1000);
      session.startTs = Date.now();
    }
    persist();
    emit();
  },
  // 清除会话（训练完成/放弃时）——内存与落盘一起清，防止已完成训练复活
  clear() {
    session = null;
    if (hasWx()) { try { wx.removeStorageSync(KEY); } catch (e) {} }
    emit();
  },
  // 订阅变化（custom-tab-bar 用于刷新悬浮窗）
  subscribe(cb) {
    listeners.push(cb);
    return function unsubscribe() {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
};

// utils/workoutSession.js
// 训练中页面的「全局会话」：最小化或离开训练页后，悬浮计时窗仍可在其它 tab 页显示，
// 点击可恢复（resume）未完成的训练。仅保存在内存（应用会话内，不落盘，避免跨启动误恢复）。
//
// 计时模型采用「墙上时间」：running 时记录 startTs，getElapsed() 按 Date.now()-startTs 实时累加，
// 即使训练页被卸载（interval 清除），悬浮窗仍可通过真实时间继续走表；重新进入训练页自动续跑。
let session = null;
const listeners = [];

function emit() {
  listeners.slice().forEach(cb => { try { cb(session); } catch (e) {} });
}

module.exports = {
  // 保存/覆盖一个可恢复的训练会话（来自 workout 页面，含动作进度与计时）
  save(data) { session = data; emit(); },
  // 合并更新（保留 running/startTs 等计时字段，不被覆盖）
  update(partial) {
    if (session) session = Object.assign({}, session, partial);
    else session = partial;
    emit();
  },
  // 读取当前会话（可能为 null）
  load() { return session; },
  // 是否存在可恢复会话
  has() { return !!session; },
  // 当前实时累计秒数（running 时按真实时间累加 —— 实现离开页面后后台继续计时）
  getElapsed() {
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
    emit();
  },
  // 仅把 elapsed 同步为实时值（不冻结，startTs 顺延为现在）——供离开页面前保存最新进度
  syncElapsed() {
    if (session && session.running && session.startTs) {
      session.elapsed += Math.floor((Date.now() - session.startTs) / 1000);
      session.startTs = Date.now();
    }
    emit();
  },
  // 清除会话（训练完成/放弃时）
  clear() { session = null; emit(); },
  // 订阅变化（custom-tab-bar 用于刷新悬浮窗）
  subscribe(cb) {
    listeners.push(cb);
    return function unsubscribe() {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
};

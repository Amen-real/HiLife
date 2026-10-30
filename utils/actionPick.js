// utils/actionPick.js
// 「训练中挑选动作」的一次性意图（内存级，与 workoutSession 同语义：不落盘，应用被杀即失效）。
//
// 为什么存在：训练中「添加/替换动作」不再用页内弹窗（真机两次出滚动问题），改为
// 跳转训练 tab 的现成动作库挑选。training 是 tabBar 页，只能 switchTab 进入 ——
// switchTab 会清空页面栈、销毁 workout 页实例（训练进度由 workoutSession 快照保住），
// EventChannel 跨 switchTab 不可用，所以选择结果走本模块交接：
//   workout 页 request() → switchTab 到训练页 → 用户点动作 → training fulfill()
//   → navigateTo 重新进入 workout → onLoad consume() 应用结果。
//
// 红线：同一能力只留一个入口 —— 原页内弹窗（showAdd/showReplace）已随本模块删除。
let intent = null;

module.exports = {
  // 发起挑选：mode='add'（追加到训练）| 'replace'（替换 targetId，保留组数据）
  request(mode, targetId, targetName) {
    intent = { mode: mode, targetId: targetId || '', targetName: targetName || '', picked: null };
  },
  // 训练页读取（不消费，供 onShow 渲染挑选横幅）
  get() { return intent; },
  // 训练页记录用户点选的动作（原始库对象，image/video 保持相对路径，由 workout 端 media() 包裹）
  fulfill(act) { if (intent) intent.picked = act; },
  // workout 页取走并清空（一次性）
  consume() { const r = intent; intent = null; return r; },
  // 用户取消
  cancel() { intent = null; }
};

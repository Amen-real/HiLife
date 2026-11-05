// cloudfunctions/reminderPush/picker.js —— 下发筛选/去重/扣减决策纯函数
//
// ⚠️ 红线：本模块零 wx-server-sdk require（守卫 verify-reminder-cloud.cjs 锁定），必须能 node 直测。
// ⚠️ 判据红线：这里只消费客户端上报的字段（intent/intentDate/lastTrainDate 由客户端
//    utils/reminder.intentToday 算好），云端**不许**复刻任何意图判据。
//
// eligible（与门，全部满足才下发）：
//   u.on === true              总开关开
//   u.hour === hour            档位 == 当前小时（整点触发，档位即小时）
//   u.quota > 0                还有可下发额度（授权 accept 攒的）
//   u.intent === true          当日有提醒意图（客户端算）
//   u.intentDate === today     意图属于今天（跨天自动失效）
//   u.lastTrainDate !== today  今天还没练（练过不打扰）
//   u.lastPushDate !== today   今天还没推过（同日去重）

/**
 * 从候选用户中筛出本档应下发的目标，并产出对应的扣减补丁。
 * @param {Array<object>} users  reminderUsers 文档数组（脏数据容忍：null/非数组不崩）
 * @param {{hour:number, today:string}} ctx  当前小时与「今天」日期串
 * @returns {{targets:Array<object>, patches:Array<object>}}
 *   targets：命中的原文档；patches：与 targets 一一对应的写回补丁（quota-1 + lastPushDate=today）。
 *   补丁恒为 quota:-1，且只对 quota>0 的用户产出 ⇒ 扣减后 quota 不会为负。
 */
function pick(users, ctx) {
  const c = ctx || {};
  const hour = Number(c.hour);
  const today = (typeof c.today === 'string' && c.today) ? c.today : '';
  const targets = [];
  const patches = [];
  (Array.isArray(users) ? users : []).forEach((u) => {
    if (!eligible(u, hour, today)) return;
    targets.push(u);
    patches.push({ id: u._id, openid: u._openid, quota: -1, lastPushDate: today });
  });
  return { targets, patches };
}

function eligible(u, hour, today) {
  return !!u
    && u.on === true
    && u.hour === hour
    && Number(u.quota) > 0
    && u.intent === true
    && u.intentDate === today
    && u.lastTrainDate !== today
    && u.lastPushDate !== today;
}

module.exports = { pick, eligible };

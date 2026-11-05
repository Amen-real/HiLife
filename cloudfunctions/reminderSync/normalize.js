// cloudfunctions/reminderSync/normalize.js —— 上报归一纯函数
//
// ⚠️ 红线：本模块零 wx-server-sdk require（守卫 verify-reminder-cloud.cjs 锁定），
//    必须能被 node 直测。所有判据/口径不许在这里复刻 —— 云端只消费客户端上报值
//    （intent 由 utils/reminder.intentToday 在客户端算好，本模块只做白名单与形态归一）。
//
// payload 白名单：[on, hour, intent, intentDate, lastTrainDate, quotaDelta]，白名单外字段一律丢弃。
// 归一规则：
//   · on        ：只认 boolean；
//   · hour      ：非法（存在但不在 0–23）回落 18；缺省不写（quota 上报不带 hour，不能覆盖用户档位）；
//   · intent    ：boolean 才写，且与 intentDate **成对**（写 intent 必带 intentDate，缺省补 today）；
//   · lastTrainDate：只认 'YYYY-MM-DD' 形态；
//   · quotaDelta：单次只接受 +1，其余（0/负数/>1/非整数/脏值）一律归 0 —— 防篡改钳制。

const DEFAULT_HOUR = 18;
const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;

// 档位归一：0–23 的整数合法，其余回落默认档 18
function normalizeHour(h) {
  const n = Math.floor(Number(h));
  return (isFinite(n) && n >= 0 && n <= 23) ? n : DEFAULT_HOUR;
}

/**
 * 归一客户端上报 payload → upsert 补丁对象。
 * @param {object} payload  客户端 wx.cloud.callFunction 的 data（脏数据容忍：null/数组/缺字段不崩）
 * @param {string} today    云端「今天」日期串 'YYYY-MM-DD'（由薄壳 index.js 的唯一拼串点产出）
 * @returns {object} patch  补丁对象：仅含白名单内、形态合法的字段；quotaDelta 恒存在（0 或 1）
 */
function normalize(payload, today) {
  const p = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const t = (typeof today === 'string' && ISO_RX.test(today)) ? today : '';
  const patch = {};

  // on：只认 boolean（关 = 仅停用，额度保留 —— 决策③）
  if (typeof p.on === 'boolean') patch.on = p.on;

  // hour：字段存在但非法 → 回落 18；字段缺省 → 不写（避免 {quotaDelta:1} 上报覆盖用户档位）
  if (p.hour !== undefined && p.hour !== null && p.hour !== '') patch.hour = normalizeHour(p.hour);

  // intent + intentDate 成对：写 intent 必带 intentDate（显式合法则用显式值，否则补 today）；
  // 只报 intentDate（不带 intent）也允许（形态合法时透传）
  if (typeof p.intent === 'boolean') {
    patch.intent = p.intent;
    patch.intentDate = (typeof p.intentDate === 'string' && ISO_RX.test(p.intentDate)) ? p.intentDate : t;
  } else if (typeof p.intentDate === 'string' && ISO_RX.test(p.intentDate)) {
    patch.intentDate = p.intentDate;
  }

  // lastTrainDate：只认日期串形态；空串/脏值不写（云端保留原值）
  if (typeof p.lastTrainDate === 'string' && ISO_RX.test(p.lastTrainDate)) {
    patch.lastTrainDate = p.lastTrainDate;
  }

  // quota 增量钳制（防篡改红线）：typeof 必须是 number 且值恰为 1 才接受；
  // 其余（0/负数/>1/非整数/字符串 '1'/boolean true/脏值）一律归 0
  const qd = p.quotaDelta;
  patch.quotaDelta = (typeof qd === 'number' && qd === 1) ? 1 : 0;

  return patch;
}

module.exports = { normalize, normalizeHour, DEFAULT_HOUR, ISO_RX };

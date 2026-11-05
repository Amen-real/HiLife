// cloudfunctions/reminderSync/index.js —— 薄壳：只做 IO（openid / DB / serverDate），归一在 normalize.js
const cloud = require('wx-server-sdk');
const { normalize } = require('./normalize.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLL = 'reminderUsers';

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 云端「今天」日期串（'YYYY-MM-DD'）—— 本文件唯一拼串点。
// 微信云开发容器固定 UTC+8，但为免疫宿主时区漂移，统一用 UTC 毫秒 + 8h 偏移后取 UTC 分量。
function todayStr(now) {
  const d = now instanceof Date ? now : new Date();
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}

// 首次建档的默认文档（客户端不传 openid，_openid 由云开发自动写入；这里再显式存一份便于查询）
function defaultDoc(openid, patch) {
  return {
    _openid: openid,
    on: patch.on !== undefined ? patch.on : false,
    hour: patch.hour !== undefined ? patch.hour : 18,
    quota: patch.quotaDelta || 0,
    intent: patch.intent !== undefined ? patch.intent : false,
    intentDate: patch.intentDate || '',
    lastTrainDate: patch.lastTrainDate || '',
    lastPushDate: '',
    updatedAt: db.serverDate()
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, reason: 'no-openid' };

  const patch = normalize(event || {}, todayStr());
  const coll = db.collection(COLL);
  // ⚠️ QA Bug2（2026-11-05）：原 where().get()+add() 非原子 —— tapReminder/saveWorkout
  // 背靠背两次 callFunction 并发查空各自 add，会产生重复文档（影子文档带 on:true/quota>0
  // 会被 reminderPush 选中重复下发）。改法：文档 _id 直接用 openid，天然幂等 ——
  // 并发查空时两次 doc(openid).set 落的是同一个 _id，后写覆盖前写，永不产生影子文档。
  const docRef = coll.doc(OPENID);
  let existing = null;
  try {
    const got = await docRef.get();
    // doc().get() 命中时返回 { data: 单文档对象 }；文档不存在时抛错走 catch
    existing = (got && got.data && got.data._id) ? got.data : null;
  } catch (e) {
    existing = null;
  }

  if (existing) {
    // 已有档案：只 upsert 白名单字段 + quota 原子增量 + serverDate 时间戳
    const upd = {};
    ['on', 'hour', 'intent', 'intentDate', 'lastTrainDate'].forEach(k => {
      if (patch[k] !== undefined) upd[k] = patch[k];
    });
    if (patch.quotaDelta) upd.quota = _.inc(patch.quotaDelta);
    upd.updatedAt = db.serverDate();
    await docRef.update({ data: upd });
    return { ok: true, updated: true };
  }

  // 建档：set 语义 = 不存在则创建（_id = openid）；并发下同 _id 幂等
  await docRef.set({ data: defaultDoc(OPENID, patch) });
  return { ok: true, created: true };
};

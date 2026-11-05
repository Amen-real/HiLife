// cloudfunctions/reminderPush/index.js —— 薄壳：只做 IO（环境变量 / DB / openapi send），决策在 picker.js
const cloud = require('wx-server-sdk');
const { pick } = require('./picker.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLL = 'reminderUsers';
// 订阅消息落地页：训练 tab（tabBar 页，冷启动可直达；见 docs/deploy-reminder.md 的实测说明）
const JUMP_PAGE = 'pages/training/training';

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 云端「今天」/ 当前小时 —— 各本文件唯一拼串点（UTC 毫秒 + 8h 偏移后取 UTC 分量，免疫宿主时区）
function beijingNow(now) {
  const d = now instanceof Date ? now : new Date();
  return new Date(d.getTime() + 8 * 3600 * 1000);
}
function todayStr(now) {
  const t = beijingNow(now);
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}
function nowHour(now) {
  return beijingNow(now).getUTCHours();
}

// 订阅消息卡片字段 —— 与 docs/deploy-reminder.md 的模板申请建议一一对应：
// thing1 提醒文案（≤20 字）/ time2 提醒时刻 / thing3 状态副语（≤20 字）
function cardData(hour) {
  return {
    thing1: { value: '今天还没训练，练一场吧' },
    time2: { value: pad2(hour) + ':00' },
    thing3: { value: '衡砺健身记录 · 训练提醒' }
  };
}

exports.main = async () => {
  // 模板 ID 走环境变量 TMPL_ID：未配置 = 安全空转（不查库、不下发）
  const tmplId = process.env.TMPL_ID || '';
  if (!tmplId) return { ok: true, skipped: 'TMPL_ID 未配置，安全空转' };

  const now = new Date();
  const hour = nowHour(now);
  const today = todayStr(now);

  // 候选池：总开关开 且 还有额度（精筛交给 picker 纯函数）
  const got = await db.collection(COLL).where({ on: true, quota: _.gt(0) }).limit(1000).get();
  const { targets, patches } = pick(got.data || [], { hour, today });

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: tmplId,
        page: JUMP_PAGE,
        data: cardData(hour)
      });
    } catch (e) {
      // 下发失败（如 43101 用户拒收 / 额度耗尽）：静默跳过 —— 不扣 quota、不写 lastPushDate
      console.warn('[reminderPush] send fail openid=' + u._openid,
        (e && (e.errMsg || e.errCode || e.message)) || e);
      failed++;
      continue;
    }
    // 只有 send 成功才扣额度 + 写 lastPushDate（补丁由 picker 纯函数产出，薄壳只执行）
    try {
      const p = patches[i];
      await db.collection(COLL).doc(p.id).update({
        data: { quota: _.inc(p.quota), lastPushDate: p.lastPushDate, updatedAt: db.serverDate() }
      });
      sent++;
    } catch (e) {
      console.warn('[reminderPush] 扣额度失败 openid=' + u._openid,
        (e && (e.errMsg || e.errCode || e.message)) || e);
    }
  }

  return { ok: true, hour, today, candidates: targets.length, sent, failed };
};

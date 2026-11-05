// utils/reminderCloud.js —— 订阅消息提醒的「云端唯一通道」
//
// 红线（守卫 verify-reminder-cloud.cjs 锁定）：
//   · 页面不得直接 wx.cloud.callFunction / wx.requestSubscribeMessage，全部经本模块；
//   · 所有出口 try/catch + console.warn 静默：任何云端失败不 throw、不 toast、
//     不阻塞本地训练与提醒条（云端不可用 = 本地一切照旧）；
//   · intent 判据只调 utils/reminder.intentToday（唯一真源），本模块不复刻任何判据逻辑；
//   · 云端档案数据不进本地存储（wx.setStorageSync 单键 1MB 红线）。
//
// quota 语义（决策③④）：accept = +1、成功下发 = -1（云端做）、拒绝授权不变、关开关不动 quota。

const dateRange = require('./dateRange.js');
const reminder = require('./reminder.js');

const SYNC_FN = 'reminderSync';

function warn(tag, e) {
  console.warn('[reminderCloud] ' + tag, (e && (e.errMsg || e.errCode || e.message)) || e);
}

/**
 * 纯函数：globalData + 事实 → 上报快照。
 * intent 由唯一真源 reminder.intentToday 计算（与时刻线无关的意图判据）。
 * @param {object} gd    getApp().globalData（读 reminderOn / reminderHour / reminderDismissedOn）
 * @param {object} facts 当天事实：{ hasPlan, trainedToday, weekDone, weekTarget }（缺省安全归 false/0）
 * @returns {{on:boolean, hour:number, intent:boolean, intentDate:string, lastTrainDate:string}}
 */
function buildSnapshot(gd, facts) {
  const g = gd || {};
  const f = facts || {};
  const today = dateRange.todayStr();
  const intent = reminder.intentToday({
    enabled: !!g.reminderOn,
    hasPlan: !!f.hasPlan,
    trainedToday: !!f.trainedToday,
    dismissedOn: g.reminderDismissedOn || '',
    weekDone: f.weekDone,
    weekTarget: f.weekTarget,
    today: today
  });
  return {
    on: !!g.reminderOn,
    hour: reminder.normalizeHour(g.reminderHour),
    intent: intent,
    intentDate: today,
    // 最近一次训练日期：今天练过 → 今天；否则上报空串（云端按形态校验，空串不覆盖原值）
    lastTrainDate: f.trainedToday ? today : ''
  };
}

// 上报出口：callFunction 带 fail 静默回调；wx.cloud 不可用（未 init/低版本）直接跳过
function callSync(payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    warn('wx.cloud 不可用，跳过上报（静默）');
    return;
  }
  wx.cloud.callFunction({
    name: SYNC_FN,
    data: payload,
    fail: (e) => warn('reminderSync 上报失败（静默）', e)
  });
}

/**
 * 上报状态快照（fire-and-forget）：开关变更 / 选档 / 首页刷新 / 关闭提醒 / 完成训练后调用。
 * 任何异常只 console.warn，绝不 throw（红线）。
 * @param {object} gd    getApp().globalData
 * @param {object} facts 同 buildSnapshot
 */
function reportState(gd, facts) {
  try {
    callSync(buildSnapshot(gd, facts));
  } catch (e) {
    warn('reportState 异常（静默）', e);
  }
}

/**
 * 订阅消息授权（攒额度）。⚠️ 合规红线：只能在用户点击的同步调用栈内调用
 * （接线点：profile.tapReminder 开启分支、workout.saveWorkout 完成训练，守卫锁定）。
 *   · tmplId 为空（模板未申请）→ 直接 return，不弹窗（安全空转）；
 *   · 用户 accept（含勾选「总是保持」的静默 accept）→ 上报 { quotaDelta: 1 } 攒额度；
 *   · 拒绝 / 失败 → 静默，不动额度。
 * @param {object} gd getApp().globalData（读 reminderTmplId）
 */
function requestGrant(gd) {
  try {
    const tmplId = (gd && gd.reminderTmplId) || '';
    if (!tmplId) return;                       // 模板未申请：不弹窗（安全空转）
    if (!wx.requestSubscribeMessage) return;   // 低版本基础库：不弹窗
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        try {
          if (res && res[tmplId] === 'accept') callSync({ quotaDelta: 1 });
        } catch (e) {
          warn('授权成功回调异常（静默）', e);
        }
      },
      fail: (e) => warn('requestSubscribeMessage 失败/被拒（静默，不动额度）', e)
    });
  } catch (e) {
    warn('requestGrant 异常（静默）', e);
  }
}

module.exports = { buildSnapshot, reportState, requestGrant };

// utils/privacy.js
// 隐私授权：统一「需要时才请求 + 被拒绝要给得出人话」的唯一入口。
//
// 背景（基础库 2.32.3+）：调用相册 / 摄像头等隐私接口前，必须先取得用户对
// 《用户隐私保护指引》的同意。微信给了两条路：
//   1) 什么都不写：微信会在**首次真正调用隐私接口时**自动弹官方弹窗。
//   2) 自己想控制时机：用 requirePrivacyAuthorize 提前拉起来。
// 所以 app.js 原先在 onLaunch 里那句 requirePrivacyAuthorize 不只是多余，而是**更差**：
//   用户在冷启动、还没做任何操作时就被弹一个授权窗，既突兀、又说不清在为哪件事授权。
//   已移除，交回平台在「点拍照/选图」那一刻弹 —— 上下文清楚，同意率也更高。
//
// 但平台只负责弹窗，不负责解释。用户一旦拒绝，隐私接口就只是失败：
// 三处 wx.chooseMedia（食物识别拍照、饮食页拍照、换头像）在拒绝后表现为
// **点了完全没反应**——既没结果也没提示。本模块把这件事翻译成人话，
// 并在用户回心转意时给一次重新授权的机会。
//
// 用法：
//   const privacy = require('../../utils/privacy.js');
//   privacy.ensure('拍照识别食物').then((ok) => {
//     if (!ok) return;              // 用户明确不授权：已经给过说明，这里安静退出
//     wx.chooseMedia({ ... });      // 真正的调用
//   });
//
// 三条设计取舍：
//   · 只在**确实需要**授权时才弹窗。已同意过（needAuthorization=false）直接放行，不打扰。
//   · 拿不到隐私设置（老基础库 / getPrivacySetting 失败 / requirePrivacyAuthorize 抛错）
//     一律**放行**：宁可走平台自己的报错路径，也不要用我们自己都不确定的状态
//     去阻断一个本来能用的功能。
//   · 重新授权**只给一次**。连弹两次以上就成了骚扰；用户第二次拒绝就是明确表态。

function api(name) {
  return typeof wx !== 'undefined' && typeof wx[name] === 'function';
}

// 拉起官方授权窗。canRetry=false 时不再给第二次机会，避免弹窗循环。
function authorize(label, done, canRetry) {
  let settled = false;
  const finish = (v) => { if (!settled) { settled = true; done(v); } };

  try {
    wx.requirePrivacyAuthorize({
      success: () => finish(true),
      fail: () => {
        // 已经按成功结算过就别再动了 —— settled 存在的意义就是「只结算一次」。
        // 少了这一句，若平台先给 success 再给 fail（真机不会，但状态机得受得住），
        // 用户会在**授权成功**的情况下被弹一个「你刚刚拒绝了隐私授权」。
        if (settled) return;
        if (!api('showModal')) { finish(false); return; }
        wx.showModal({
          title: '需要你的授权',
          content: '你刚刚拒绝了隐私授权，「' + label + '」暂时用不了。\n是否重新授权？',
          confirmText: '重新授权',
          cancelText: '暂不',
          success: (m) => {
            // 用户点了「重新授权」且还有机会 → 再拉一次官方弹窗（这是最后一次）
            if (m && m.confirm && canRetry) { settled = false; authorize(label, done, false); return; }
            finish(false);
          },
          fail: () => finish(false)
        });
      }
    });
  } catch (e) {
    // 拉不起来就别阻断：让真正的隐私接口自己去报错，至少行为不比不接这个模块更差
    finish(true);
  }
}

// 返回 Promise<boolean>：true = 可以继续调用隐私接口；false = 用户拒绝，调用方应安静退出。
function ensure(label) {
  const name = label || '该功能';
  return new Promise((resolve) => {
    if (!api('requirePrivacyAuthorize')) { resolve(true); return; }

    // 有 requirePrivacyAuthorize 却没有 getPrivacySetting（理论上不该发生）→ 直接请求
    if (!api('getPrivacySetting')) { authorize(name, resolve, true); return; }

    wx.getPrivacySetting({
      success: (r) => {
        if (!r || !r.needAuthorization) { resolve(true); return; }
        authorize(name, resolve, true);
      },
      // 问不到就别阻断（老基础库 / 接口异常）
      fail: () => resolve(true)
    });
  });
}

module.exports = { ensure };

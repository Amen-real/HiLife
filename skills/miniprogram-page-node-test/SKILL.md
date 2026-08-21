---
name: miniprogram-page-node-test
description: 在 Node 里用 mock 运行环境对微信小程序 Page 逻辑做集成测试（无需开发者工具），用于验证计算/分流/数据聚合类页面逻辑。当要测试某个 .js 页面（onLoad/setData/事件 handler）的真实运行时行为、又不想开微信开发者工具时调用。
agent_created: true
---

# 小程序 Page 逻辑 Node 集成测试

微信小程序页面逻辑（Page({...})）依赖 `getApp()`、`wx`、`Page()`、以及框架注入的 `this.setData`，无法直接在 node 跑。用一份轻量 mock 即可在 node 里真实触发 `onLoad`、调用 handler、断言 `data`。

## 关键坑：setData 必须合并进 `this.data`
真实框架里 `setData(obj)` 是把 `obj` 合并进 `this.data`，**不是**覆盖 `this`。很多 mock 写成 `Object.assign(this, obj)` 会错——页面代码读的是 `this.data.xxx`，不是 `this.xxx`。正确写法：

```js
opts.setData = function (obj, cb) { Object.assign(this.data, obj); if (cb) cb(); };
```

`rebuild()` 这类函数常在 `setData({...}, () => this.applyMode())` 里用回调触发下一步计算，所以 mock 必须支持第二个回调参数并立即执行。

## 标准 harness 骨架

```js
const path = require('path');
const GD = { /* 完整 globalData：trainingLogs/trainingPlans/activePlanId/profile... */ };
global.getApp = () => ({ globalData: GD, persist() {} });
global.wx = { getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {}, switchTab: () => {} };
let PAGE = null;
global.Page = function (opts) {
  opts.setData = function (obj, cb) { Object.assign(this.data, obj); if (cb) cb(); };
  PAGE = opts;
};
require(path.resolve(__dirname, '../pages/review/review.js')); // 触发 Page(opts) 捕获

// 改数据后重新加载
GD.trainingLogs = [...]; GD.activePlanId = 'p1';
PAGE.onLoad();
console.log(PAGE.data.mode, PAGE.data.week);

// 模拟事件 handler
PAGE.switchMode({ currentTarget: { dataset: { mode: 'single' } } });
```

## 适用场景
- 验证"按数据自动分流/默认模式"类逻辑（如复盘页：记录数<2 → 基准，否则周）。
- 验证复杂聚合（按周/动作分组、趋势、决策规则）不抛异常且输出合理。
- 回归测试：改了 store 字段后，确认页面仍能跑通。

## 不适用
- 真机/视觉渲染、WXSS、`<icon>` 等组件表现——这些必须靠微信开发者工具。
- 涉及 `wx.request`/`wx.cloud` 网络调用——需额外 mock 返回值。

## 注意
- 被测页 `require('../../utils/store.js')` 会链式 require `exercises.js`（纯 JS，node 可加载），无需额外处理。
- 测试脚本放 `scripts/` 下（与本项目 `probe-exercises.cjs`/`validate-presets.cjs`/`test-review.cjs` 一致），用 `node scripts/test-xxx.cjs` 运行；不可用 `node --check` 跑（它只查语法不跑逻辑）。

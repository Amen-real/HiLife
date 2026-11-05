# 订阅消息提醒（reminderSync / reminderPush）部署说明

> 架构：本地优先 + 云端薄档案。客户端 `utils/reminderCloud.js` 上报快照 → 云函数 `reminderSync` 归一落库 → 云函数 `reminderPush` 定时筛选下发。判据唯一真源在 `utils/reminder.js`（`intentToday`），云端不复刻任何判据。

---

## 一、部署步骤

### 1. 建集合（一次性）

云开发控制台 →（环境 `cloud1-d0g5ihto42b4ed256`）→ 数据库 → 新建集合：

- **`reminderUsers`**（权限选默认「仅创建者可读写」即可；云函数端有管理权限，不受此限）

> **文档 `_id` = openid，天然幂等**：`reminderSync` 建档走 `doc(openid).set()`（不存在则创建），同一用户永远只有一个文档 —— 并发上报（如开开关后背靠背完成训练）不会产生重复/影子文档。

> **容量边界**：`reminderPush` 单次查询 `limit(1000)` 无分页，即单次触发最多处理 1000 个候选用户。当前用户量级下够用；超过 1000 活跃提醒用户时需补分页拉取（**此边界不在本次实现范围**，届时优先做）。

### 2. 部署云函数

微信开发者工具 → 资源管理器中分别右键：

- `cloudfunctions/reminderSync` → **上传并部署：云端安装依赖（不上传 node_modules）**
- `cloudfunctions/reminderPush` → **上传并部署：云端安装依赖（不上传 node_modules）**

### 3. 定时触发器

`cloudfunctions/reminderPush/config.json` 随部署自动生效：

```json
{ "triggers": [{ "name": "reminder-hourly", "type": "timer", "config": "0 0 * * * * *" }] }
```

7 段 cron（秒 分 时 日 月 星期 年）= **每小时整点**触发一次。可在云开发控制台「云函数 → reminderPush → 触发器」查看/调整；改 `config.json` 后需重新部署 reminderPush。

### 4. 环境变量 TMPL_ID

云开发控制台 → 云函数 → `reminderPush` → 配置 → 环境变量，添加：

| 键 | 值 |
|---|---|
| `TMPL_ID` | 订阅消息模板 ID（见下节申请；**未配置 = 安全空转**，不查库不下发） |

---

## 二、订阅消息模板申请（一次性）

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → **功能 → 订阅消息 → 公共模板库**；
2. 搜索并选用「健身 / 运动打卡提醒」类模板；
3. 字段建议（与 `reminderPush/index.js` 的 `cardData()` 一一对应）：

| 字段 | 类型 | 内容建议 | 说明 |
|---|---|---|---|
| `thing1` | thing（≤20 字） | 今天还没训练，练一场吧 | 提醒文案 |
| `time2` | time | 18:00 | 提醒时刻 |
| `thing3` | thing（≤20 字） | 衡砺健身记录 · 训练提醒 | 状态副语 |

4. 提交后等待审核通过，复制**模板 ID**；
5. 填写两处（缺一不可）：
   - `app.js` → `globalData.reminderTmplId`
   - 云函数 `reminderPush` 环境变量 `TMPL_ID`（填完需在控制台「保存并重新部署」）

> 两处任一为空时整条链路安全空转：客户端不弹授权窗、云函数不下发，无报错。

---

## 三、真机验证步骤

1. 开发版/体验版真机打开小程序，进「我的」→ 打开「今日未训练提醒」→ 弹出订阅授权窗 → 点**允许**；
2. 云开发控制台 → 数据库 → `reminderUsers`：应出现一条记录，`on:true`、`quota:1`；
3. 确认今天该档位条件满足（`intent:true`、`intentDate=今天`、没练过）；为便于测试可临时把该文档 `hour` 改为临近的下一个整点；
4. 等整点触发（或控制台「云函数 → reminderPush → 云端测试」手动运行一次）；
5. 预期：微信「服务通知」收到训练提醒卡片；点击卡片冷启动落到**训练 tab**；数据库该文档 `quota` 减 1、`lastPushDate=今天`；
6. 完成一场训练保存后再触发：`lastTrainDate=今天`、`intent:false` → 不再下发（`lastTrainDate` 去重生效）。

## 四、18 点档实测时区

- 微信云开发容器固定运行在 **UTC+8**，与客户端一致；两个云函数的「今天 / 当前小时」均按 **UTC 毫秒 + 8h 偏移后取 UTC 分量** 拼串，天然免疫宿主时区漂移（各文件内唯一拼串点）；
- 部署后请在 18:00–18:05 实测一次 18 点档：确认 `reminderPush` 返回的 `hour=18` 且 18 档用户被命中；若出现漂移（不预期发生）优先检查容器时区配置。

## 五、常见问题

| 现象 | 原因与处理 |
|---|---|
| 日志出现 `43101` | 用户未订阅 / 订阅额度耗尽。属预期：**静默跳过、不扣 quota、不写 lastPushDate** |
| 一直不下发 | 依次检查：TMPL_ID 是否已配 → `reminderUsers` 里 `on/quota/intent/intentDate/hour` 是否满足 → 触发器是否生效 |
| 点击卡片没落到训练 tab | 训练页是 tabBar 页，主流基础库支持冷启动直达；若个别版本异常，备选方案是新增非 tab 中转页（当前未建，避免无用页面进包） |
| 客户端开/关提醒没反应 | 云链路全静默（红线）：本地开关行为不受云端影响；排查 `reminderSync` 云函数日志即可 |

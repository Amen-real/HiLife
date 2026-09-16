# 衡砺健身记录 · 系统架构文档

> 版本：v1.0 ｜ 生成日期：2026-08-19 ｜ 适用项目：HiLife 微信小程序（原生）  
> 本文档描述小程序整体架构、功能模块划分、各模块实现功能、数据模型、核心工具层、云端后端与上线合规要点。

---

## 1. 项目概览

**产品定位**：一款个人健身记录工具，覆盖「训练（动作库 / 计划 / 执行）/ 饮食（AI 卡路里识别）/ 体重 / 历史报表」四大场景，面向个人主体（无微信支付）上线。

**核心特征**

- 原生微信小程序（WXML / WXSS / JS），无前端框架，主包 ≤ 2MB（源素材已云端化、本地 `assets/` 被 `packOptions.ignore` 排除）。
- 状态采用轻量 `store` 模式，统一读写 `app.globalData` 并落本地缓存（`wx.setStorageSync`）。
- 媒体与 AI 视觉后端均迁至**微信云开发（CloudBase）**：云存储 `cloud://` 免备案承载动作图 / 饮食图 / 演示 GIF；云托管（容器）承载多模态视觉识别模型，免服务器域名白名单。

---

## 2. 技术栈

| 层     | 技术                                  | 说明                                                 |
| ----- | ----------------------------------- | -------------------------------------------------- |
| 前端    | 原生小程序（WXML/WXSS/JS）                 | `style: v2`，自定义 tabBar，全局 `app.wxss` 设计 token      |
| 状态    | `utils/store.js` + `app.globalData` | 单例全局数据 + 统一 `persist()` 持久化                        |
| 缓存    | `wx.setStorageSync`                 | 本地序列化全量状态（本地单用户模式，非云数据库）                           |
| 媒体    | 微信云存储 `cloud://`                    | `utils/media.js` 原样拼前缀 + `resolveUrl()` 临时 URL     |
| AI 后端 | 微信云托管（CloudBase Container）          | `wx.cloud.callContainer` 调 `hilife-vision` 服务跑视觉模型 |
| 开发期后端 | FastAPI/uvicorn（本地 Windows）         | 地址由联调者在本机填 `app.js` 的 `globalData.visionBackendUrl`，**不入库**（随机器/网段变化） |
| 视觉模型  | 第三方多模态大模型（Qwen-VL / MiMo 等）         | 由云托管容器内的服务端调用                                      |
| 构建/工具 | Node `.cjs` / Python 脚本             | 图标生成、字号 token 化、云存储上传                              |

---

## 3. 系统架构（分层）

```
┌─────────────────────────────────────────────────────────┐
│                     表现层 (Presentation)                  │
│  pages/* (14 页)  • components/{icon,weight-modal}          │
│  custom-tab-bar (底部导航 + 悬浮训练计时窗)                  │
└───────────────┬───────────────────────────┬───────────────┘
                │ 读取/写入                   │ 订阅
                ▼                            │
┌───────────────────────────┐     ┌──────────────────────────┐
│  状态层 (State)            │     │  会话层 (Session)         │
│  app.globalData           │     │  utils/workoutSession.js  │
│  utils/store.js (CRUD)    │     │  内存悬浮计时 (跨页恢复)    │
└───────────────┬───────────┘     └──────────────────────────┘
                │ 调用
                ▼
┌─────────────────────────────────────────────────────────┐
│               服务 / 工具层 (Service & Utils)              │
│  media · foodvision · caloriescan · openfoodfacts ·       │
│  report · auth · mock · exercises(动作库)                  │
└───────────────┬───────────────────────┬───────────────────┘
                │ callContainer/uploadFile│ getTempFileURL
                ▼                         ▼
┌────────────────────────┐   ┌─────────────────────────────┐
│  微信云托管 (容器)       │   │  微信云存储 (对象存储)        │
│  hilife-vision 视觉识别  │   │  images/ · images/food/      │
│  (第三方大模型网关)      │   │  videos/ (演示 GIF)          │
└────────────────────────┘   └─────────────────────────────┘
```

---

## 4. 功能模块与实现功能

### 4.1 首页 `pages/home`

- **今日训练计划**：渲染 `store.selectedActions`（每日自选），空态引导「去选择」跳计划页。
- **健康概览**：打卡完成度环（`ring-pct`）、今日卡路里、体重趋势等。
- **打卡日历**：`.cal-modal` 日历弹窗（含显式关闭 ✕ + 翻页箭头），按日回看记录。
- **每日重置**：`app.js` `onLaunch` 比对 `planDate`，跨天自动清空 `selectedActions`。

### 4.2 训练库与动作选择 `pages/training` + `pages/action-detail` + `pages/plan`

- **动作库浏览**：按部位（胸部/背部/肩膀/腿部/手臂/核心/其他）分类，支持搜索、筛选。
- **动作详情** `action-detail`：英雄图（`<image>` 渲染 `cloud://`）+ 演示 GIF + 分步说明 + 收藏按钮；`previewImage` 经 `resolveUrl()` 转临时 HTTPS。
- **训练计划** `plan`：创建/编辑多套计划（名称 + 动作 + 组数/次数/重量）；创建成功弹确认、不自动启用；「设为当前」注入 `selectedActions` 并跳首页。

### 4.3 训练执行 `pages/workout` + `utils/workoutSession.js` + `custom-tab-bar`

- **训练中**：逐动作计时（「墙上时间」模型）、组数/次数/重量录入、组间休息浮层、`deleteWorkout` 删除本次训练（清空计时 + 会话 + 计划）。
- **悬浮训练窗**：离开训练页后 `custom-tab-bar` 顶部显示实时计时窗，`workoutSession` 订阅刷新；点击恢复未完成任务（会话仅存内存，不跨启动）。

### 4.4 记录 `pages/list` + `pages/train-detail` + `pages/weight-record`

- **记录列表** `list`：训练历史 / 体重历史，含日期筛选器（与体重历史对称交互）。
- **训练详情** `train-detail`：单场次动作组明细（按 `sid` 精确定位）。
- **体重录入** `weight-record` + `components/weight-modal`：记录/编辑体重，自动算 `weightDiff`。

### 4.5 饮食 AI 识别 `pages/advice` + `pages/food-scan` + `pages/food-vision` + 工具层

- **饮食总览** `advice`：当日热量/蛋白/碳水/脂肪汇总，历史饮食记录。
- **食物识别** `food-scan`：三种入口
  - 条码 / 名称搜索 → `utils/openfoodfacts.js`（商品营养库）；
  - 拍照识别 → `utils/foodvision.js`（视觉识别）；
  - 开发期拍照后端 → `utils/caloriescan.js`。
  - 加载态用「内容镜像骨架屏」替代原生 spinner（含拍照识别 `loading` 态）。
- **识别结果** `food-vision`：食物名、热量、置信度、营养结构，确认后写入 `store.addMeal`。

### 4.6 我的 `pages/profile` + `pages/settings` + `pages/favorites` + `pages/privacy`

- **我的** `profile`：本地登录（头像昵称填写）、健康档案（性别/目标/身高/体重）、收藏入口、数据管理（导出训练数据 + 转发文件）、隐私政策入口、媒体署名块。
- **设置** `settings`：训练提醒开关、视觉后端地址配置（`useCallContainer` / `visionBackendUrl`）。
- **收藏** `favorites`：查看已收藏动作（回查 `customActions` + `exercises.library`），红心取消收藏。
- **隐私政策** `privacy`：六段隐私说明页；`app.js` `onLaunch` 接入 `wx.requirePrivacyAuthorize`。

---

## 5. 数据模型

### 5.1 `app.globalData`（持久化于 `uu_fitness_state`）

| 字段                                                                                                   | 类型        | 说明                                                           |
| ---------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| `userInfo`                                                                                           | obj       | 本地匿名登录态（nickname/avatar/loggedIn）                            |
| `profile`                                                                                            | obj       | 健康档案 + `fitnessDays`（去重训练天数）                                 |
| `selectedActions`                                                                                    | arr       | 今日自选动作（跨天清空）                                                 |
| `planDate`                                                                                           | str       | `selectedActions` 所属日期，跨天重置依据                                |
| `trainingPlans` / `activePlanId`                                                                     | arr / str | 多套计划 + 当前计划 id                                               |
| `weightRecords`                                                                                      | arr       | `{date, weight}`，按日期排序                                       |
| `trainingLogs`                                                                                       | arr       | 每场 `{sid, date, createdAt, actions[]}`，按场次定位                 |
| `meals`                                                                                              | arr       | `{id, time, type, name, calories, protein, carb, fat, note}` |
| `favorites` / `customActions`                                                                        | arr       | 收藏动作 id / 用户自建动作                                             |
| `reminderOn` / `backendUrl` / `visionBackendUrl` / `useCallContainer` / `cloudEnv` / `visionService` | mixed     | 设置与云端配置                                                      |

### 5.2 `utils/store.js` 方法分类

- **体重**：`addWeight` / `getWeightStats`
- **动作选择**：`toggleSelect` / `addSelected` / `removeSelected` / `updateSelected` / `isSelected` / `clearSelected`
- **自建动作**：`addCustomAction` / `removeCustomAction`
- **收藏**：`toggleFavorite` / `isFavorite`
- **饮食**：`addMeal` / `deleteMeal` / `updateMeal` / `getTodayCalories`
- **计划**：`addPlan`（不再自动激活）/ `updatePlan` / `deletePlan` / `setActivePlan` / `getActivePlan` / `planActionToTrain` / `applyPlanToSelected` / `_findSourceAction`
- **训练日志**：`saveTrainingLog`（按场次、可同日多次）
- **账户**：`login`（恢复快照）/ `logout`（快照备份）/ `setUserProfile`

---

## 6. 核心工具模块 `utils/`

| 文件                  | 职责                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.js`          | 全局状态读写 + 统一持久化，所有数据 CRUD 入口                                                                                                                 |
| `exercises.js`      | 内置动作库（1295 条，按部位分类；含 `image`/`video` 带哈希后缀路径）                                                                                               |
| `media.js`          | `MEDIA_MODE='cloud'`：`media(p)` 原样拼 `cloud://<env>.<suffix>/<rel>`；`resolveUrl()` 用 `wx.cloud.getTempFileURL` 解析为临时 HTTPS（供 `previewImage`） |
| `workoutSession.js` | 训练悬浮会话：内存计时（墙上时间）、订阅广播、跨页恢复                                                                                                                 |
| `foodvision.js`     | 视觉识别：双模式——`callContainer`（云托管，图压 480px/q20→base64，受 100K 限制）或 `uploadFile`（开发后端）                                                            |
| `caloriescan.js`    | 开发期拍照识别后端调用（`wx.uploadFile` 传原图）                                                                                                            |
| `openfoodfacts.js`  | 商品营养库（条码/名称查营养）                                                                                                                             |
| `report.js`         | 训练报表：周/月/年滚动周期，本期 vs 上期组数·时长对比；部位由动作名回查库得                                                                                                   |
| `auth.js`           | 登录门禁：写入类操作前 `requireLogin()`；`promptLoginOnLaunch`（`onLaunch` 必须传入 `this` 防误弹）                                                              |
| `mock.js`           | 示例饮食数据 / 饮食图（`images/food/*.jpg`）引用                                                                                                         |

---

## 7. 媒体资源方案（已定案）

- **最终方案 = 微信云存储 `cloud://`**（弃用 R2 / OSS）：免 ICP 备案、免 downloadFile/uploadFile 域名白名单，与云开发后端同体系。
- **路径约定**：业务数据（`exercises.js` / `mock.js`）已存完整带哈希后缀路径——动作图 `images/<id>-<hash>.jpg`、演示 GIF `videos/<id>-<hash>.gif`、饮食图 `images/food/<name>.jpg`。`media()` **原样拼前缀、不做目录改写**，故上传文件名必须与业务数据一字不差。
- **渲染约束**：`<image>` 可直接渲染 `cloud://`；但 `wx.previewImage` 仅认 HTTPS，需先 `resolveUrl()`。GIF 必须用 `<image>`（原生 `<video>` 播不了 GIF）。
- **云存储权限**：必须设「所有用户可读，仅创建者可写」，否则终端用户看不到媒体。
- **上传脚本**：`upload-to-storage.cjs`（CloudBase CLI 把 `assets/images`→`images/`、`assets/videos`→`videos/`）。

---

## 8. 云端后端

### 8.1 云存储（对象存储）

承载静态媒体（动作图 / 饮食图 / 演示 GIF），文件 ID 形如 `cloud://cloud1-d0g5ihto42b4ed256.636c-.../images/0001-xxx.jpg`。

### 8.2 云托管（容器）视觉识别

- 服务名 `hilife-vision`，由 `globalData.useCallContainer` 切换：
  - **true（上线默认）**：`wx.cloud.callContainer` 调 `/analyze`，前端压缩图→base64→JSON，免备案、免服务器域名。受云托管 100K 请求体限制，前端压到 ~480px / quality 20。
  - **false（开发/自有服务器）**：`wx.uploadFile` 传原图到 `visionBackendUrl`（需备案域名 + 微信后台配合法域名）。
- 容器内服务端调用第三方多模态大模型（如阿里云百炼 Qwen-VL / 小米 MiMo），返回结构化营养结果。

---

## 9. 关键业务流程

1. **每日计划重置**：`app.onLaunch` 比对 `planDate` 与今天 → 不同则 `selectedActions=[]` 并 `persist()`，强制用户每日自选。
2. **训练执行与悬浮计时**：训练页写 `workoutSession.save()` → tabBar 订阅显示计时窗；最小化/切 tab 后按真实时间续跑；完成/删除 `clear()`。
3. **食物识别入库**：拍照 → `foodvision.analyzeImage` → `food-vision` 展示 → 确认 → `store.addMeal` → 饮食总览汇总刷新。
4. **隐私合规**：`app.onLaunch` 调 `wx.requirePrivacyAuthorize`；公众平台需发布「用户隐私保护指引」（体重/饮食照片属个人信息）。

---

## 10. 上线合规要点

- **账号**：AppID `wx0d4d9fe07646ea15`，个人主体（无微信支付），健身/运动记录类目可用。
- **隐私**：发布隐私保护指引；`requirePrivacyAuthorize` 弹授权；「我的」加隐私政策页。
- **域名白名单**：云开发（云托管/云存储）由平台代备，无需自行备案；若切回自有服务器需备案域名 + 配置 request/uploadFile/downloadFile 合法域名。
- **提审路径**：开发者工具上传 → 体验版真机自测 → 提交审核 → 发布。
- **成本预警**：云开发免费期有配额上限（函数调用/存储/CDN），到期转按量；视觉模型 API 按次计费不在免费额度内，需持续关注。

---

## 11. 项目目录结构

```
HiLife/
├── app.js / app.json / app.wxss         # 全局逻辑 / 路由配置 / 设计 token
├── custom-tab-bar/                      # 自定义底部导航 + 悬浮训练计时窗
├── components/
│   ├── icon/                           # base64 内联图标（scripts/gen-icons-data.cjs 生成）
│   └── weight-modal/                   # 体重录入弹窗
├── pages/                              # 14 个页面（见 §4）
├── utils/                              # 状态 / 动作库 / 媒体 / 视觉 / 报表 / 登录 等
├── scripts/                            # gen-icons-data.cjs / fs-tokenize.py 等
├── assets/                             # 源素材（被 packOptions 排除，不进主包）
├── upload-to-storage.cjs               # 云存储上传脚本
├── check-missing-gifs.cjs              # 媒体缺口核对脚本
└── CDN-DEPLOY-CHECKLIST.md / DESIGN.md / OVERVIEW.md / README.md
```

---

*文档基于当前代码（提交 `39f2b4d`）梳理。如需细化某模块（如视觉识别服务端实现、UI 设计系统），可另出专项文档。*

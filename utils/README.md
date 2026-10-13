# utils/ —— 领域逻辑层

小程序里**所有不该长在页面里的逻辑**都在这一层。页面只做「渲染 + 编排」，**不计算、不判口径**。

三条最常见的越界（都出过事故，改代码前先看这里）：

1. **口径只准有一份**。同一句话（比如「本周」「连续几天」「今日该练什么」）在两个页面各写一遍，改一处忘另一处必然漂移。⇒ 每类口径都有唯一真源，见下表。
2. **日期只走 `dateRange.js`**。禁 `toISOString()`（UTC 会把本地 00:00 推后 8 小时 ⇒ 「近 N 天」多吞一天，见 P0-0）。禁 `new Date(isoStr)`（按 UTC 解释）。本地构造一律 `dateRange.parseISO`。
3. **页面里禁出现字面量阈值**。阈值属于模型（如 `muscleStatus.js` 的 `FATIGUED_AT`），页面只消费结果。守卫会扫页面里的 `0.xx` 小数。

---

## 一、唯一真源一览（禁建第二份实现）

| 领域 | 唯一真源 | 消费方 | 守卫 |
| --- | --- | --- | --- |
| 日期 / 自然周 / 连续天数 | `dateRange.js` | 全站 | `verify-date-range-boundary`(74) / `verify-training-review` |
| 每日热量与营养素 | `nutrition.js`（`GOALS` + `normalizeGoal`） | advice / home | `verify-goal-vocab` |
| 今日训练计划 | `todayPlan.js`（`resolveTodayPlan`） | home / profile | `verify-today-plan` |
| 训练统计 / verdict / 建议回填 | `trainingStats.js` | review / list | `verify-training-review` |
| 肌群疲劳三态 | `muscleStatus.js`（`muscleStatusOf`） | action-detail | `verify-muscle-status`(137) |
| **「练完之后」回放**（`now` = 该场次结束时刻） | `sessionAfter.js`（`afterStateOf`） | training-review（list / review 两页共用） | `verify-session-after`(67) |
| target → 图集 slug 映射 | `bodymap.js` 的 `SLUG` | action-detail / shareCard / muscleStatus | `verify-muscle-status[C]` |
| 顶部安全区 / 胶囊避让 | `navMetrics.js` | 全部自定义导航页 | `verify-top-inset`(54) |
| 隐私授权门禁 | `privacy.js`（`privacy.ensure`） | 三处选图 | `verify-privacy-auth`(70) |
| 用户可见失败文案 | `foodvision.js` 的 `userMessage()` | 识别全链路 | `verify-vision-result`(142) |
| 识别失败分档 / 可重试 | `foodvision.js` 的 `USER_TEXT` + `RETRYABLE` | 同上 | `verify-vision-result[E4]` |
| 本地埋点 | `metrics.js` | food-scan | — |
| 本地食物知识库 | `foodkb.js` | food-scan | `verify-foodkb` |
| 提醒口径 | `reminder.js` | 设置 / training | `verify-reminder` |

**已知刻意的「两处不同」**（勿合并）：
`todayPlan.resolveTodayPlan()` 回答「今天该练什么」（激活计划优先）；
`workout.js resolveWorkoutSource()` 回答「我接下来练什么」（手动已选优先）。

---

## 二、纯度分层

- **纯函数**（不 require wx / store / app，可被 node 直接单测）：
  `dateRange` · `muscleStatus` · `sessionAfter` · `todayPlan` · `trainingStats` · `nutrition` · `planRotation` · `bodymap` · `metrics` · `foodkb`
- **有状态 / 依赖宿主**：`store`（读写 `getApp().globalData`）· `theme` · `auth` · `privacy` · `media` · `reminder` · `workoutSession`（**仅内存，不落盘**）

⇒ 新增逻辑前先问：**它需要宿主吗？** 不需要就写成纯函数，永远能进守卫、永远不被真机依赖绑住。

---

## 三、按文件

### 生成物（勿手改）
- **`exercises.js`**（413KB）—— 动作库，压缩行式，由 `scripts/gen-exercises-compact.cjs` 生成。
  ⚠️ **改它之前必读下方「动作 id 契约」**。
- **`bodymap-data.js`**（61KB）—— 解剖图路径数据，源自 `react-native-body-highlighter`（MIT）。

### 其余文件
| 文件 | 职责 | 注意 |
| --- | --- | --- |
| `store.js` | 全局状态 + 持久化 | 所有日期换算走 `dateRange`；内含 1MB 单键上限风险 |
| `foodvision.js` | 识别调用 + **失败分档唯一真源** | 服务端 message 含 `LLM_API_KEY` 等，**禁弹给用户** |
| `media.js` | 媒体路径解析（`MEDIA_MODE`） | 三模式：cloud / cdn / local |
| `shareCard.js` | 分享卡版式（**纯函数产出绘制指令**） | 守卫可在 node 穷举「没有越界元素」 |
| `navMetrics.js` | 胶囊几何 | 测不到胶囊时退化为 112px（宁可多留） |
| `privacy.js` | 授权门禁 | `requirePrivacyAuthorize` / `getPrivacySetting` **只准出现在此** |
| `auth.js` | 登录门禁 | 阅读类操作不受限 |
| `theme.js` | 深浅主题切换 | token 全在 `app.wxss`，此处只同步状态 |
| `workoutSession.js` | 未完成训练的全局会话 | 墙上时间模型；**不落盘** |
| `planRotation.js` | 计划轮转 / 分组 | 零依赖小模块 |

---

## 四、动作 id 契约（2026-10-13 补）

`exercises.js` 的真实形态（实测，非推测）：

- **1295 条动作**，6 个中文分类组，id 全唯一无重复；
- **id = 4 位零填充字符串**（`"0009"`），范围 **1~5201且高度稀疏** —— 是上游编号，**不是自增序列**，因此**不可假定连续、不可用 `id+1` 取下一条**；
- ⚠️ **媒体路径含内容哈希**：`image = /images/{id}-{hash}.jpg`、`video = /videos/{id}-{hash}.gif`。

由此得到三条契约：

1. **id 一经分配即永久。** 删除走 tombstone，**不复用编号** —— 历史训练记录按 id 引用动作，编号复用会让旧记录指向别的动作。
2. **改动动作内容必须显式 review。** 内容变了 ⇒ hash 变 ⇒ **媒体路径变**。这不是「顺手改个名字」，它会改掉这条动作在历史记录里的图片与 GIF 地址。
3. **重跑生成链前后必须验证**：`node scripts/verify-exercises-compact.cjs`
   它按位置逐位比对 **10 个字段（含 `image` / `video`，即 hash）× 1295 个动作**，能抓住字段改动、steps 增删、动作删除、换位、分类顺序变化。
   ⚠️ 更新顺序**不能反**：先更新指纹再验证，等于把尺子改成跟被测物一样长。

数据确实要改时：**先 verify 通过 → 再跑 `gen-exercises-fingerprint.cjs` 更新指纹 → 再跑 verify 确认**。

---

## 五、加新文件时的规矩

- 优先写成**纯函数**并放进本目录，让守卫能在 node 里穷举它的性质；
- 若它是某类口径的真源，**在文件头注释里写清「谁在用 + 为什么不能合并」**（照 `todayPlan.js` 的写法）——这是本 README 里最有用的一类信息；
- 若它有跨模块的约束（禁某写法 / 禁某位置），把它写进**对应守卫**，而不是只写注释 —— 注释会被忽略，守卫不会；
- 主包余量约 413KB。新增文件前先想清楚它是**必须打进主包的**还是**只在守卫/工具链里用的**（后者放 `scripts/`，该目录不打包）。
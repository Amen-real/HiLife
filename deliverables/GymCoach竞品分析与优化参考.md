# GymCoach 竞品分析 · HiLife 可参考的优化升级项

> 分析对象：<https://github.com/gymcoach-app/gymcoach>（MIT，2026-05-27 建库，最近推送 2026-10-09，40★ / 17 fork / 40 open issues，TypeScript）
> 定位原文：*"Self-hosted workout tracker with an AI coach that knows your training. Bring your own LLM. Strength + cardio, offline PWA, one-command Docker install. A free, open-source alternative to Strong, Hevy and Fitbod."*
> 本文只写**可核验的事实**（代码 / README / package.json / Prisma schema 实证）与**对 HiLife 的可落地性**，不写愿景。

---

## 一、环境：技术栈全貌

| 层 | GymCoach 选型 | 版本 |
| --- | --- | --- |
| 前端框架 | Next.js App Router + React | next 15.5.19 / react 19 |
| 语言 | TypeScript strict | 5.6.3 |
| 样式 | Tailwind CSS + shadcn/ui（Radix 无头组件） | tw 3.4.15 |
| 数据库 | PostgreSQL + Prisma ORM（`@prisma/adapter-pg` 驱动适配器） | PG16 / prisma 7.8 |
| 认证 | JWT（`jose`）存 httpOnly cookie + `bcrypt` 密码哈希；**每条路由都校验归属** | jose 5.10 |
| 离线 | Dexie（IndexedDB）**先写本地** → 后台同步服务端；Wake Lock 保屏 | dexie 4.4 |
| PWA | `@ducanh2912/next-pwa` | 10.2.9 |
| 多语言 | next-intl（en / fr / ru，消息目录可扩展） | 4.13.2 |
| 图表 | Recharts | 3.8.1 |
| 表单 | react-hook-form + zod | 7.74 / 3.25 |
| AI | 可插拔 `lib/llm`：Anthropic SDK / OpenRouter / `codex-lb`，由 `LLM_PROVIDER` 环境变量切换 | sdk 0.98 |
| MCP | `@modelcontextprotocol/sdk`（让 ChatGPT 等外部代理读写训练数据） | 1.29 |
| 测试 | Vitest 4（单元/组件 + 真实 PG 集成）+ Playwright 1.49（E2E） | — |
| 部署 | docker-compose ×4（dev/prod/selfhost/test），GHCR 预构建镜像，启动时自动迁移 | — |

**架构一句话**：Next.js 同时出 UI 和 API routes；数据落 PG；`lib/` 是一堆**无 IO 纯函数**，统计全部在服务端算。

---

## 二、逻辑：它怎么组织代码

### 2.1 分层（这是最值得学的一点）

```
app/          页面 + API 路由（只管编排）
components/   React 组件（shadcn/ui 在 components/ui）
lib/          纯函数领域模块 ← 全部逻辑在这，无 DB 无时钟
  stats.ts              e1RM / 容量 / ISO 周 / 停训检测 / 一致性 / 有氧周聚合
  progression.ts        双进阶 + 就绪度自调节 + 计划减载
  deload.ts / warmup.ts / plates.ts / supersets.ts / cardio.ts / records.ts
  coach-context.ts      AI 上下文的"人话摘要"
  set-shorthand.ts      "100x8@9" 简写解析
  gym-loads.ts          器械约束下的重量取整
prisma/       schema + migrations + seed
```

**纪律**：每个 `lib/xxx.ts` 旁边都有**同名 `xxx.test.ts`**（`stats.test.ts` 26KB vs `stats.ts` 24KB —— 测试比实现还大）。注释里到处是 `issue #133` 这种可追溯编号，迁移注释统一写 `backward-safe additive column`（新列可空、旧行不受影响）。

### 2.2 数据模型要点（Prisma schema 实证）

- **`Set` 是唯一的事实表**：`weight / reps / rir / durationSec / distanceM / avgHr / maxHr / track(JSON) / isWarmup / isDropSet / notes`。
  - **有氧复用同一张表**：`durationSec != null` 即判定为有氧，按约定存 `weight=0 / reps=1` 以不动 NOT NULL 列；`stats.ts` 里每个聚合都显式 `isCardioSet()` 跳过 ⇒ **有氧数据绝不污染举铁指标**。
  - **器械快照**：`gymEquipmentId` + `equipmentNameSnapshot` + `equipmentLoadSnapshot(JSON)` —— 器械被删/改档不改写历史。
  - `Session.gymId` 在开练时**冻结**，中途换健身房不影响进行中与历史训练。
- **`User.bodyweight` 是"当前值"单点**，历史在 `BodyweightEntry` 表；写一条会同步 `User.bodyweight`，删最新一条会回填到新的最新值。
- **单位只在边缘转换**：库内一律 kg / cm，`User.unit` 只影响展示层。
- **`User.coachNote`**：用户写给 AI 教练的自由文本（≤500 字符），"肩膀不舒服，推胸轻一点"这类，输入侧可改。
- 每张表都有 `@@index([userId, ...])`；`Exercise` 有 `@@unique([userId, name])`。

### 2.3 算法清单（公式与常数，逐条可核）

| 算法 | 实现 |
| --- | --- |
| **e1RM** | Epley：`weight × (1 + reps/30)`；`weight<=0 || reps<=0` 返回 0 |
| **反算目标次数重量** | `estimateRepMax = e1RM / (1 + targetReps/30)`（同一组映射回自身次数时等于原重量） |
| **best1RM** | 跳过 warmup 与 cardio，**包含 drop set** |
| **容量** | `setVolume = weight × reps`，排除 warmup 与 cardio |
| **自重动作有效负荷** | `usesBodyweight && bodyweight>0` 时 `effectiveWeight = bodyweight + 附加重量`；未填体重则原样返回（向后安全） |
| **ISO 周** | `YYYY-Www`，周一 00:00 **UTC**，全程用 UTC getter（issue #160：三次 review 指出本地时区隐患后才改） |
| **停训检测** | `STALL_LOOKBACK_SESSIONS=3`，`STALL_TOLERANCE=0.005`（0.5%）；窗口内没有任何一次超过窗口前最佳 e1RM × (1+0.5%) 即判定停滞；数据少于 lookback 不判 |
| **容量带 MEV/MRV** | `WEEKLY_SETS_MEV=10`，`WEEKLY_SETS_MRV=20`（**周工作非热身组数**）；可按肌肉被用户覆盖；`resolveVolumeBand` 校验 `mev>=1 && mrv>mev` ⇒ 手改库也造不出倒挂区间 |
| **容量分区** | `<MEV` 低于 / `>MRV` 高于 / 其余区间内（两端闭） |
| **周频率** | 每个肌肉组一周内**不同日历天**数（同一天两组算一次） |
| **有氧参考线** | `WEEKLY_CONDITIONING_TARGET_MIN=150`（WHO 指南，仅展示） |
| **一致性/连续周数** | 12 周零填充窗口；**本周未达标不断连**（只不延长） |
| **双进阶** | 上一轮**所有**在工作重量上的组都达到 `targetRepsMax` ⇒ 复合 `+2.5kg` / 孤立 `+1kg`；否则保持重量追次数。**drop set 用 `s.weight === workingWeight` 过滤掉** |
| **就绪度自调节** | `READINESS_RECENCY_HOURS=36`；`readiness<=2` 保持重量、`<=1` 减 10%；`soreness>=4` 保持、`>=5` 减 10%；`READINESS_DELOAD_FRACTION=0.1` |
| **减载不叠加** | 计划减载与就绪度减载是**同一次 10%**，取大的单次，永不叠加 |
| **安全方向** | 就绪度**只能保持或降低，绝不能抬高**（防止用户刷签到骗加重） |

### 2.4 AI 层设计（对 HiLife 最可直接迁移）

1. **不发原始行，只发紧凑结构化 payload**：profile + 近期 session + 当前 program + 每个动作的进阶序列。
2. **三层用法**：周报 debrief（markdown + 可选结构化建议）、流式聊天、一句话生成 program。
3. **Zod 校验后才允许改 program** —— AI 输出的任何结构都先过 schema。
4. **系统提示打 prompt caching 标记**，多轮聊天不重复发送。
5. **"What your coach sees" 卡**：`summarizeCoachPayload()` **只重塑 payload 已有的字段，绝不从原始行重新推导** ⇒ 用户看到的卡片与 AI 实际读到的东西**不可能漂移**。
6. **没有 key 也能用**：内置 `demo` provider 返回罐头响应；不配 `LLM_API_KEY` 时仍是一个干净快速的记录器。

### 2.5 安全与工程细节

- 上传目录：`mimeType` 用**魔数嗅探**（jpeg/png/webp 白名单，不信客户端声明）；文件 `0o600`、按用户目录 `0o700`；每次读写前把存储路径**重新解析**（含 symlink）确认仍在 uploads 目录内。
- MCP 写操作：每次写都要确认；`capability index` 工具告诉客户端有哪些工具、能否写；器械回填有**可审计的撤销**。
- `lib/rate-limit.ts`。

---

## 三、客观对比：不强比，也不妄自菲薄

**GymCoach 有、HiLife 没有的**

| 领域 | GymCoach | HiLife 现状 |
| --- | --- | --- |
| 力量量化 | e1RM 曲线、百分比加载表、PR 板、停滞检测、减载建议 | 只有 `EST_KCAL_PER_MIN=8` 等粗估；趋势纵轴限"量级型指标" |
| 容量管理 | 周组数 MEV/MRV 带 + 肌肉热力图 + 周频率 | 无 |
| 进阶逻辑 | 双进阶 + 就绪度自调节 + 停训回归校准 | 有"建议回填"走 `store.updatePlan`，但**无原因解释、无自动调节** |
| 饮食 | **完全没有** | ✅ AI 拍照识别 + kcal 推荐全链路（BMR/TDEE/目标系数） |
| 动作媒体 | free-exercise-db 静态图，无解剖高亮 | ✅ 1324 张演示图 + 肌肉解剖 SVG 路径高亮 |
| 有氧 | 时长/距离/心率/TCX-GPX-FIT 导入/有氧解耦 | 无 |
| 身体数据 | 体重史 + 13 部位皮尺 + 进步照片（本地，安全做得细） | 只有体重 |
| 离线 | IndexedDB 先写 + 后台同步 | 只存本机（`wx.setStorageSync` 单键 1MB） |
| AI 教练 | 周报/聊天/计划生成 + "看到什么"卡 | 只有食物识别 |
| 工程 | 每模块同名测试、CI 六层 | ✅ 18 个守卫 + 注入自检（方向一致，更偏静态不变量） |
| 合规 | 自托管，不需要 | ✅ 隐私指引/备案/对比度守卫体系（GymCoach 完全不涉及） |
| 多语言 | en/fr/ru | 仅中文 |
| 主题 | next-themes | ✅ 深浅双主题 + 对比度铁律 |

**结论**：GymCoach 强在**力量训练的量化与自动化建议**；HiLife 强在**饮食侧、动作媒体、微信生态合规与工程质量**。两者几乎不重叠 —— 所以这不是"抄一个 App"，而是"把它的训练量化层补到 HiLife 上"。

---

## 四、可参考的优化项（按优先级）

### P0 —— 1.0 前就该做（低成本、直接补短板）

#### P0-0 ⚠️ 对照过程中发现 HiLife 自身一个真实缺陷（已逐行验证，非推测）—— ✅ 已修（2026-10-12）

**位置**：`utils/store.js:60`，`getWeightStats(rangeDays)`。

```js
const today = new Date();
const from = new Date(today.getTime() - (rangeDays - 1) * 86400000);
const fromStr = from.toISOString().slice(0, 10);   // ← UTC
filtered = list.filter(r => r.date >= fromStr);      // r.date 是本地时区写的
```

**写入侧**（`pages/weight-record/weight-record.js:229`）用的是本地 getter：

```js
const d = new Date();
const ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());  // 本地
```

⇒ **写用本地、读用 UTC，两侧时区不一致。**

**后果（UTC+8 实算）**：本地 00:00–08:00 之间打开"近 N 天"，`toISOString()` 会落回前一天，
窗口因此**多吞一天更旧的记录**。以 `rangeDays=7` 在本地 10-12 07:00 为例：`from` 正确应为 `2026-10-06`，
实际得到 `2026-10-05` ⇒ 统计出 8 天而不是 7 天，`days` / `first` / `change` 全部偏掉。08:00 之后恢复正常。

**这正是 GymCoach issue #160 修的那类"潜伏的本地时区偏移"**（他们被三次 review 指出后才改）。
但 HiLife 是单设备 App、**主体口径本来就对**（`utils/dateRange.js:8` 明确「按本地时区解析/格式化，避开 UTC 偏移导致的跨天」；
全仓 `toISOString` 仅此一处）⇒ **不该照搬它的 UTC 方案，该修的是这一处混用**。

**修法（已落地，且比原计划的 1 行更彻底 —— store.js 从此不再自己碰 Date）**：

```js
const dateRange = require('./dateRange.js');                                    // 顶部引入单源
// …
const fromStr = dateRange.shiftDaysISO(dateRange.todayStr(), -(rangeDays - 1)); // 纯日期串算术
filtered = list.filter(r => r.date >= fromStr);
```

原计划是 `dateRange.fmtDate(from)`（保留 `new Date()` 的毫秒减法）；实际实现改用
`shiftDaysISO(todayStr(), …)` 走**纯字符串日期算术**，连 `new Date()` 都不出现在函数体内 ——
毫秒减法在跨夏令时的时区上会差一小时，字符串算术没有这个面。`utils/dateRange.js` 是全仓日期口径单源，此处直接复用。

**守卫（已落地）**：`scripts/verify-profile.cjs` 新增 `[D]` 段，用**假钟**驱动【真实 `utils/store.js`】：
把全局 `Date` 固定到本地 03:00（UTC+8 下这正落在旧缺陷触发的 00:00–08:00 窗口内），
播种「边界前一天 / 边界当天 / 今天」三笔记录，断言窗口**恰好**只含后两笔（D1–D5）；
另配 D6 静态禁词（函数体内不许再出现 UTC 序列化）—— 因为假钟的判别力依赖宿主时区，
在西时区/UTC 的机器上旧写法碰巧也对，这条禁词让回归在任何机器上都能红。

验证方式不是"跑一遍看绿"，而是**先把 `store.js` 改回缺陷版确认尺子能看见被测物**：
缺陷版下 D1/D2/D3/D4b/D5/D6b/D6c 共 7 条精确变红（D1 报出窗口多吞 `2026-10-05` 一整天），
还原后 128/0 通过，全量 18 个守卫 0 失败。

> 这不是从 GymCoach 抄来的功能，而是**读它的 issue 历史时反查出来的自家缺陷** —— 也是这次对照最直接的产出。

#### P0-1 把 e1RM 加进统计单源

- **GymCoach 做法**：`estimate1RM = weight × (1 + reps/30)`，`best1RM` 跳 warmup/cardio、含 drop set。
- **HiLife 落地**：在 `utils/trainingStats.js` 旁新增单源（或并入），导出 `estimate1RM(weight, reps)` / `best1RM(sets)`。**兼容现有红线**：e1RM 是量级型指标，可用于趋势纵轴（红线只禁 RPE）。
- **成本**：纯函数 ~30 行 + 守卫断言。**风险**：无。
- **连带价值**：没有 e1RM 就没有 PR 判定、没有百分比加载表、没有停滞检测 —— 这是后面几项的地基。

#### P0-2 双进阶建议带上"为什么"

- **GymCoach 做法**：所有在工作重量上的组都到 `targetRepsMax` ⇒ 复合 +2.5kg / 孤立 +1kg；否则保持重量；drop set 过滤；返回 `SuggestionReason` 枚举（`no-history / same-as-last / progression / readiness-hold / readiness-deload / planned-deload`）。
- **HiLife 落地**：现有"建议回填"走 `store.updatePlan` 已经是对的，**缺的是 reason + 一句人话**。加 `reason` 字段并在计划卡片显示"上次 3 组都做到 12 次上限 → 本次 +2.5kg"。
- **成本**：小。**风险**：低。
- **为什么 P0**：正中 HiLife 红线「UI 每个开关必须能追溯到一条真实能力调用 / 文案只写实现得了的事」—— 现在的建议是黑盒。

#### P0-3 "AI 看到了什么"卡（直接治食物识别的体感）

- **GymCoach 做法**：`summarizeCoachPayload()` 只重塑 payload 已有字段，**绝不从原始行重新推导** ⇒ 卡片与 AI 实际输入不可能漂移。
- **HiLife 落地**：在 `pages/food-scan` 结果页加可展开区块，展示：识别出的 items、每个的置信度、走的 provider/model、`isRetryable(err)` 的结论。**必须遵守**：服务端 message 含 `LLM_API_KEY`，禁弹给用户（现有红线）—— 这张卡只能放"用户可见文案"那一层。
- **成本**：小～中。**风险**：中（要小心不泄漏运维信息）。
- **为什么 P0**：memory 里真机反馈"拍照识别很慢 / 经常识别不出来"的四条根因里，**感知与归因**占两条。这张卡是现成的解法。

#### P0-4 训练记录"复制为文本"降级通道

- **GymCoach 做法**：`workout-text.ts`，一键把 recap 放剪贴板。
- **HiLife 落地**：`utils/shareCard.js` 已有画布能力；复制文本是**不需要相册权限**的降级路径。分享卡走 `saveImageToPhotosAlbum`（隐私接口，被拒就断），文本复制走 `setClipboardData`（同样被隐私管，但已有 fail 出口）。两条都在，断一条还有一条。
- **成本**：很小。**风险**：低。

### P1 —— 1.0 后第一个版本（中成本、高体感）

#### P1-1 停训回归校准（return-to-training）

- **GymCoach 做法**：检测到真实停训后，**第一节课自动减轻**：更少工作组、更高目标 RIR、从长期历史推导保守起始重量，之后恢复正常自调节。**新增动作不算停训，不动它**。
- **为什么重要**：用户停训后回来第一节课就被打脸，是健身 App 最常见的流失点之一。HiLife 现在完全没有这层。
- **HiLife 落地**：`dateRange.js` 已有自然周与连续天数口径，停训检测可以直接复用；"保守起始重量"可从历史最佳 e1RM 反算（依赖 P0-1）。
- **成本**：中。**风险**：中（判定阈值要可调，且必须与 `todayPlan.resolveTodayPlan()` 单源协调，别在调用方重写）。

#### P1-2 容量带 + 肌肉热力图（复用现成解剖图）

- **GymCoach 做法**：`WEEKLY_SETS_MEV=10 / MRV=20`（周工作非热身组数），可按肌肉覆盖；`classifyWeeklySets` 三分区；前后 silhouettes 按上周各组工作集数染色。
- **HiLife 落地**：`bodymap.bodyPaths()` 已经是纯路径解剖图（红线：禁引图片，版式/对比度/越界可在 node 穷举）—— **这就是现成的热力图载体**，染色只需要把 `fill` 按区间换。新增纯函数 `weeklySetsByMuscleGroup()`，与 `trainingStats.js` 同源。
- **成本**：中。**风险**：低～中（要加肌肉组→路径的映射，注意解剖图路径集合与训练肌肉组词表是否一致）。
- **合规注意**：不新增数据收集，纯本机计算。

#### P1-3 可打印训练单

- **GymCoach 做法**：生成 A4 空白重量/次数/RIR 格纸，健身房手填后回来录入。
- **HiLife 落地**：小程序内生成图片 → 保存相册。**完全复用现有能力**（`shareCard.js` 画布 + `saveImageToPhotosAlbum` 链路 + 隐私 fail 出口都已就绪）。
- **成本**：中。**风险**：低（复用已验证的链路）。

#### P1-4 就绪度自调节（readiness check-in）

- **GymCoach 做法**：开练前可选 soreness/readiness 打分；36 小时内的签到才生效；`readiness<=2` 保持重量、`<=1` 减 10%； soreness `>=4` 保持、`>=5` 减 10%；**只能保持或降低，绝不能抬高**；计划减载与就绪度减载是同一次 10%，永不叠加。
- **HiLife 落地**：HiLife Phase 1.5 已做 RPE 1–10 每组输入，缺的是"开练前"这个时间点的自评。可做成训练开始前的一次性弹层。
- **成本**：中。**风险**：中（UI 要多一个入口，需遵守"通道数 = 能力数"与"空配置必须翻译成人话"）。
- **注意**：RPE 与 RIR 可换算（`RIR = 10 − RPE`），显示时可换算但**不要改已定稿的数据模型**。

#### P1-5 存储按域拆键（治 1MB 单键上限）

- **GymCoach 的启发**：它的本地层是 IndexedDB（Dexie），**结构化、可按 session 增量写**，而不是一个塞满全量状态的单键。
- **HiLife 的真实问题**：不是"同步"，而是 `wx.setStorageSync` 单键 1MB 上限 + `trainingLogs/meals` 只增不减 ⇒ 迟早静默写失败。这是 memory 里**唯一「不做就一定出事」的项**。
- **落地**：按域拆键（已是 C1 计划），进一步把 `trainingLogs` 按月份分片；`meals` 设裁剪阈值。
- **成本**：中。**风险**：高（动存储 = 动数据迁移，必须先做导出/导入往返验证）。

### P2 —— Later（想清楚再做）

| 项 | GymCoach 做法 | HiLife 判断 |
| --- | --- | --- |
| 身体测量（13 部位皮尺） | `BodyMeasurement` 表，cm 存储，边缘转换 | 可做，挑 3–5 个部位（腰/胸/臂/大腿）即可，不新增隐私面 |
| 进步照片 | 本地文件 + 魔数嗅探 + 0o600/0o700 + 路径重解析防 symlink | **若做必须照抄这套安全**；HiLife 已有 chooseMedia + saveFile 链路，成本中等 |
| 器械库存约束加载 | Gym/GymEquipment 模型 + `gym-loads.ts` 取整 | 重功能，1.0 后；HiLife 无此模型 |
| 有氧（心率/解耦/FIT 导入） | TCX/GPX/FIT 导入 + 有氧解耦 | **不建议跟**：工程量巨大，且会新增「选中的文件」隐私面与解析风险 |
| 多语言 | next-intl，en/fr/ru | 1.0 后；备案与合规语境都是中文，优先级低 |
| MCP 连接器 | 外部 AI 读写训练数据 + capability index + 审计撤销 | 小程序内跑不了 MCP server。等价物是**版本化带 schema 的导出格式**，1.0 后再议。⚠️ 用户数据离开设备必须单独授权 |
| 时区口径 | issue #160 后 `isoWeekKey` 全程 UTC getter | ⚠️ **已核实，HiLife 不该照搬**：单设备 App 的本地时区就是用户时区，`dateRange.js` 用本地 getter 是对的。但反查出 **`store.js:60` 一处真实的 UTC/本地混用缺陷**，见 P0-0（**已修 + 假钟守卫**） |
| AI 计划生成 | 一句话 → JSON program，Zod 校验 + 预览可编辑 | HiLife 已有 `todayPlan.resolveTodayPlan()` 单源；若要加 AI 生成，**必须复用该单源，禁第二份实现** |

---

## 五、明确不跟的项（以及为什么）

1. **Next.js / Prisma / PostgreSQL 整套** —— HiLife 是微信小程序原生栈，1.0 前不做云 DB。但要注意：**GymCoach 的统计全在服务端纯函数里算**，这恰好验证了 HiLife 现在的方向（`trainingStats.js` / `todayPlan.js` 抽成无 IO 单源）是对的 —— 将来上云 DB 只需换数据来源，逻辑不动。这条是"确认现有路线"，不是"要改"。
2. **Dexie 先写 + 后台同步** —— HiLife 没有服务端可同步；对应问题已转化为 P1-5 的拆键。
3. **有氧文件导入（FIT/TCX/GPX）** —— 二进制解析 + 新增隐私接口 + 主包体积，收益不匹配。
4. **多语言** —— 与备案、隐私指引的中文语境冲突，1.0 后再说。

---

## 六、建议节奏

| 阶段 | 内容 | 前置 |
| --- | --- | --- |
| **Now（1.0 前，随备案等待期）** | ~~P0-0 时区缺陷~~ ✅ 已修 → P0-1 e1RM 单源 → P0-2 双进阶 + reason → P0-3 "AI 看到什么"卡 → P0-4 复制为文本 | 无（都是纯函数/展示层） |
| **Next（1.0 后 v1.1）** | P1-1 停训回归校准、P1-2 容量带 + 肌肉热力图、P1-3 可打印训练单 | P1-2 依赖 P0-1 |
| **Later（v1.2+）** | P1-4 就绪度、P1-5 存储拆键、身体测量、进步照片 | P1-5 需先做导出/导入往返验证 |
| **并行必修** | ① ICP 备案（全链路唯一阻塞；P0-0 时区缺陷已修） ② B7 隐私政策三处口径待拍板 | — |

---

## 七、一句话总结

GymCoach 值得抄的不是它的技术栈，而是三件事：**① 领域逻辑全部拆成无 IO 纯函数 + 同名测试共置；② 把"为什么"（reason / MEV-MRV / 就绪度阈值）全部写成具名常数并展示给用户；③ AI 只吃紧凑结构化 payload，且把"AI 看到了什么"原样展示给用户。** 对 HiLife 而言，第 ②③ 条正好补上它最缺的"训练量化 + 可解释性"，而第 ① 条它已经做到了。

**第四条，也是这次最意外的收获**：读竞品不要只读 README 和 feature list —— **它的 issue / CHANGELOG 里藏着它踩过的坑**。GymCoach 的 issue #160（本地时区偏移，三次 review 才揪出）让我反查出 HiLife 自己 `store.js:60` 一处真实的 UTC/本地混用缺陷（P0-0，**已修，并用假钟守卫钉住**）。看别人怎么修 bug，比看别人做了什么功能更值钱。

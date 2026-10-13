# openGym 竞品分析 · HiLife 可参考的优化升级项

> 分析对象：<https://github.com/DuarteSantos8/openGym>（AGPL-3.0，2026-07-18 建库，最近推送 2026-10-12，**10235★ / 1256 fork / 123 open issues**，JavaScript）  
> 定位原文：*"Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets, warm-ups, cardio), see which muscles are trained, fatigued or detrained, import from FitNotes/Strong/Hevy, passkey login"*  
> 分析日期：2026-10-13。素材来自仓库元数据、根目录与各层 README、`package.json`、`api/coach/adapters/index.js`、`api/coach/cadence.js`、`api/coach/warmup.js`、`mcp/README.md`、`catalogue/README.md`、`frontend/scripts/fatigue-monotonic-probe.mjs`、前端 `src/lib/` 清单。  
> 本文只写**可核验的事实**与**对 HiLife 的可落地性**，不写愿景。⚠️ `recovery.js` / `muscles.js` / `onerm.js` 三份实现体因体积超限未取到正文（探针脚本已完整暴露其对外契约，故契约层不缺失，只差实现细节）；凡属推断处均已标注。

---

## 一、环境：技术栈全貌

| 层 | openGym 选型 | 版本 / 备注 |
| --- | --- | --- |
| 前端框架 | React + Zustand + React Router | react 19.2.7 / zustand 5.0.14 / react-router-dom 7.18.2 |
| 语言 | **JavaScript**（ESM），非 TS | 与 HiLife 同栈 |
| 构建 | Vite + PWA | vite 8.1.5 |
| 移动壳 | Capacitor（android / ios / app / core / filesystem / local-notifications / share） | 7.6.8 |
| 后端 | Node 原生 HTTP（`api/server.js`，**157KB 单文件**）+ undici | ESM，`gym-api` v1.4.1 |
| 认证 | **Passkey**（`@simplewebauthn/server`）+ 密码 | 13.1.1 |
| 推送 | web-push（Web Push / VAPID） | 3.6.7 |
| AI | **可插拔 adapter 架构**：fixture / claude / codex / anthropic / openai / gemini / compatible；`@anthropic-ai/claude-agent-sdk` 是 **optionalDependency** | 0.3.223 |
| 动作库 | `catalogue/` 每动作一个 JSON，**1324 条**，源自 ExerciseDB（MIT） | 20 语言 i18n |
| 媒体 | `still/<id>.webp` 180px + `clip/<id>.mp4` | Gym visual 授权，**不开放** |
| MCP | 只读 stdio 桥，9 工具 | `mcp/README.md` |
| 测试 | `node --test`（后端）+ vitest（前端）+ 一个**零依赖属性化探针** | — |
| 部署 | docker-compose + Helm chart + Kubernetes manifests + GitLab CI（43KB） | — |
| 许可 | **AGPL-3.0** | — |

**架构一句话**：React 前端 + Node 单体后端 + 静态动作目录；`frontend/src/lib/` 是一批**无 IO 纯函数**，所有数字都在前端算；后端只做存储、Passkey、推送与 AI 编排。

**与 HiLife 的关键差异**：HiLife 是**微信小程序**（无服务器渲染、无 PWA、无 Capacitor 壳、无用户账号体系），openGym 是**自托管 Web + 移动壳**。⇒ **凡是依赖「服务器 / 账号 / 后台任务」的设计，HiLife 都不能照搬**；可借鉴的几乎全在**纯函数层、测试层、目录治理层**。这条判断是下面所有筛选的第一道闸。

---

## 二、逻辑：它怎么组织代码

### 2.1 前端 `src/lib/` 是一批纯函数，每个配同名测试

清单里每个 `xxx.js` 旁边都有 `xxx.test.js`：

| 文件 | 大小 | 职责 |
| --- | --- | --- |
| `recovery.js` | — | **疲劳/恢复模型**：`fatigueOf(history, now)` 按肌肉返回疲劳度，`FATIGUE_SCAN_MS` 定义扫描窗 |
| `muscles.js` | — | 肌肉归组与状态判定（trained / fatigued / detrained 三态） |
| `onerm.js` | — | 1RM 估算（Epley / Brzycki 一类） |
| `history.js` | — | 历史编辑（导入 FitNotes/Strong/Hevy、增删改） |
| `effort.js` | — | RPE / 强度 |
| `accent.js` / `bodymap.js` | — | 配色 / 肌肉 SVG 路径 |
| `coach.js`(33KB) / `coach-local.js` / `coach-insights.js` | — | AI 教练前端侧 |
| `coach-parity.test.js` | — | **UI 与 MCP 数字一致性**的专测 |
| `exercise-muscle-map.json`(40KB) / `exercises-data.js`(1.17MB) | — | 动作↔肌肉映射与动作数据 |
| `catalogue-v13-ids.json` | — | **目录版本间的 ID 稳定映射** |

⚠️ `body-paths.js` 94KB 与 HiLife 的 `bodymap.bodyPaths()`（纯路径、禁引图片）是同一思路，且两边动作图**同源于 ExerciseDB 1324 条**。

### 2.2 疲劳模型：单调性被当成不变量来测（最值得学的一点）

`frontend/scripts/fatigue-monotonic-probe.mjs` 是**零三方依赖**的属性化测试，用确定性 LCG（seed `0x5eed1234`，`Math.imul(seed,1664525)+1013904223`）生成 100 份随机历史，对每份按 45 天逐小时推进 1080 个时间点：

```js
import { FATIGUE_SCAN_MS, fatigueOf } from '../src/lib/recovery.js'
// 100 随机历史 × 1080 小时 = 1,080,000 次比较
if (comparisons !== 1080000) throw new Error(...)
if (current - previous > 1e-12) throw new Error('fatigue increased ...')
```

外加两条**历史编辑不变量**：
1. 扫描窗外的导入，不改变当前疲劳值；
2. 删除「最近一场训练」**永不增加**疲劳。

并且它在注释里**诚实声明了失效边界**：疲劳锚点与 acute:chronic 比率依赖历史，删除中段记录可能触发重算（被删记录降低了它的锚点）—— 即**只断言能断言的，不假装覆盖了全部**。

### 2.3 Coach：多 provider 的「一个文件 + 一行配置」

`api/coach/adapters/index.js` 里：

```js
const ADAPTERS = { fixture, claude, codex, anthropic, openai, gemini, compatible }
```

README 的原话（要点）：**「加一个 provider = 这里一个文件 + `config.PROVIDERS` 一行，代码库其他地方——routes、jobs、payload、validation、UI——都不知道配了哪个」**；claude adapter **无条件注册但 SDK 懒加载**，默认镜像上 `check()` 报运行时缺失、`isConnected()` 于是把 Coach 整体从 `/api/config` 里藏掉。

⭐ **`fixture` 假 provider 随镜像一起发布**，理由写得很清楚：CI 靠它跑，同时让实例主**在决定是否接真账号之前，先看完整 Coach 回路**（intake → proposal → apply → revert）。

### 2.4 cadence：定时推送里最见功力的一段

`api/coach/cadence.js`（周度复盘）：

- 触发条件两类：`everyWorkouts`（次数达标即触发）/ `weekly`（周几 + 时刻，**用用户自己的时区**）。
- ⭐ **slot 用自己的时区偏移解析，不使用「现在」的偏移**；DST 切换日与「被跳过的小时」都处理，且**解析两次**（第一次得到偏移，再用该偏移复算）。
- `cache.consent.agreedAt` — 同意即跑、撤销即停。
- 60 秒 tick；caps 满 / 在途任务 / provider 挂了 / 本周没练 ⇒ **全部静默跳过**。
- 注释里那句设计原则值得抄进 HiLife 的文案纪律：**「为报告没有消息而存在的通知，正是人们关掉通知的方式」**（no-news notifications are how people turn off notifications）。

配套 `api/coach/warmup.js` 用**本地模型前缀缓存保温**：`OLLAMA_NUM_PARALLEL=1` 单活槽、启动时 + 每 30 分钟各跑一次、`TIMEOUT_MS=10min`；实测**冷启 402s vs 热 26s**（约 15 倍）。

### 2.5 MCP：只读桥，且数字与 UI 同源

`mcp/README.md` 的核心设计（这是全仓最值得 HiLife 学的一条）：

- 只读 stdio 桥，**无新容器 / 无新认证 / 无遥测**；9 个工具：`list_routines` `get_routine` `preview_session` `get_week_plan` `list_workouts` `get_workout` `get_bodyweight` `estimate_1rm` `muscle_balance`。
- ⭐ **所有数字由前端同一批纯函数算出**（`frontend/src/lib/*.js`）⇒ 「我的卧推 1RM 多少」这个答案与 Stats 屏**完全一致**，不存在第二份实现。
- i18n 因 Vite 的 `import.meta.glob` 不是 Node 安全 ⇒ **拆成 `i18n-core.js`（纯）+ `i18n.js`（React 侧）**。
- 58 用例来自 `demoSeed.js`（公开 demo 用的同一份确定性夹具），「今天」用 `vi.useFakeTimers` **钉死**。
- Roadmap：Phase 1 只读 9 工具 → 1.5 加 `preview_session`（策略给出的下一组处方、**开组行、每个数字来自计划/确认重量/历史哪一个**）→ Phase 2 读写（长驻 token 来自管理后台 `./data/tokens.json` + 针对 web UI 读-改-写的写锁）→ Phase 3 streamable HTTP。

### 2.6 catalogue：ID 永久稳定

每动作一个 JSON（id 永久编号、name、bodyPart、equipment、target、secondaryMuscles、category、description、instructions 4–7 步）。README 明确四条规则：**自己写、不做医疗建议、媒体不开放、不许喂 AI 工具**；PR 上跑 `validate.mjs`。

### 2.7 HiLife 侧实测基线（读本仓源码得到，用于对照）

> 以下不是推断，是直接解 `utils/exercises.js` / `utils/bodymap*.js` 得到的事实。**它改变了后面几条建议的可行性判断。**

- **动作库真实规模 = 1295 条**（不是常被引用的「1324」——1324 是上游数据集总量，HiLife 只落了 1295 条）。实测：`_R` 共 6 个中文分类组（胸部/背部/肩膀/腿部/手臂/核心），1295 行、**id 全唯一无重复**。
- **ID 形态 = 4 位零填充字符串**（`"0009"`、`"3294"`），实测范围 **1 ~ 5201**，且**高度不连续**。⇒ ID 是**上游稀疏编号**，不是 HiLife 自增序列。
- ⚠️ **图片/GIF 路径由「id + 内容 hash」拼成**：`image = "/images/{id}-{hash}.jpg"`、`video = "/videos/{id}-{hash}.gif"`（hash 形如 `A9qxk2F`，7 位 base32）。实测首行即 `["3294","A9qxk2F","archer push up","射手俯卧撑",…]`。**含义：改一次动作内容 ⇒ hash 变 ⇒ 媒体路径变。** 这正是 openGym 用 `catalogue-v13-ids.json` 锁死 ID 想防的那类事故，而 HiLife 现在**连 hash 稳定性守卫都没有**。
- **target 词表 18 个值**（`_T`）：pectorals / serratus anterior / lats / spine / upper back / traps / delts / quads / calves / glutes / hamstrings / adductors / abductors / triceps / biceps / forearms / abs / levator scapulae。**equip 14 类**（`_E`），已是中文。
- **解剖图 slug 与 target 不是一套词**：图集（react-native-body-highlighter）slugs = chest / obliques / abs / biceps / triceps / neck / trapezius / deltoids / adductors / quadriceps / knees / tibialis / calves / forearm / hands / ankles / feet / head / hair / gluteal / hamstring（前后视图各自一份）。`utils/bodymap.js` **已维护 target→slug 的映射表**（含 6 个近似归并，如 `serratus anterior → chest`）。
  ⭐ **这条对 P0-1 是好消息：疲劳模型不需要新建映射，直接复用 `bodymap.js` 的既有映射即可，落在纯函数里、零 UI 改动。**

---

## 三、能力对比矩阵（openGym vs HiLife）

| 能力 | openGym | HiLife 现状 | 差距性质 |
| --- | --- | --- | --- |
| 训练记录（组/次/重量/时长/距离） | ✅ 完整，支持 superset / warm-up / drop set / 有氧同表 | ✅ 有组次重量、RPE | **已对等** |
| RPE / 自觉强度 | ✅ `effort.js` | ✅ 每组 1–10 | 已对等 |
| 1RM 估算 | ✅ `onerm.js` | ⚠️ 未见专门单源（复盘用 verdict 比共同动作） | **可补** |
| **肌肉疲劳 / 恢复 / 停训三态** | ✅ `recovery.js` + `muscles.js` 核心卖点 | ✅ **纯函数已就绪**（`muscleStatusOf`，78 断言 + 8 变异体全被抓住）⬜ **但页面零消费** | **能力已建、未见用户** |
| 肌肉解剖图 | ✅ `body-paths.js` 94KB 纯路径 | ✅ `bodymap.bodyPaths()` 纯路径（**红线已立**） | 已对等（HiLife 更小更聚焦） |
| 动作库 | ✅ 1324 条 JSON + 20 语言 + mp4 演示 | ✅ **1295 条**（实测）+ 1324 张 180×180 演示图；压缩行式格式 220KB | 素材同源，**ID 治理落后**（见 P1-2） |
| 目录 ID 跨版本稳定 | ✅ `catalogue-v13-ids.json` + README 明文「id 永久编号」 | ⚠️ **守卫已完备**（10 字段含 image/video × 1295 动作按位置比对，实测 PASS），仅**契约未成文** | 低（补注释即可） |
| 第三方数据导入 | ✅ FitNotes / Strong / Hevy | ⚠️ 仅自身 JSON 导出/导入 | 中（1.0 后再议） |
| 体重趋势 | ✅ | ✅（**2026-10-12 刚修过时区缺陷**） | 已对等 |
| 热量推荐 | ⚠️ 未见（体重趋势 + 复盘为主） | ✅ Mifflin-St Jeor 全链路 | **HiLife 领先** |
| AI 拍照识别热量 | ❌ 无 | ✅ 视觉大模型 + 知识库纠错 | **HiLife 领先** |
| AI 教练 | ✅ 多 provider 架构 + 计划提案/应用/回滚 | ⚠️ 仅「建议回填」（幂等 + 闸门双向） | 可借鉴**架构**，不必做功能 |
| 定时推送 | ✅ cadence（时区严谨 + 无事不发） | ⚠️ 无推送（单页模式无订阅消息） | **不可照搬（无服务器）** |
| 账号 / Passkey / 多设备 | ✅ 自托管账号 | ✅ 本机匿名标识（1.0 前不做云同步，用户已拍板） | **有意不做** |
| PWA / 移动壳 | ✅ Capacitor Android/iOS | N/A（小程序即容器） | 不可照搬 |
| MCP / 外部代理读写 | ✅ 只读 9 工具 + Roadmap 读写 | ❌ 无 | 不建议（主包预算 + 无服务器） |
| 主题 | ⚠️ 未见深色 | ✅ 深浅双主题 + 对比度门禁 | **HiLife 领先** |
| 视觉打磨与设计系统 | ⚠️ 自托管工具级 | ✅ 荧光绿品牌系统 + 守卫 18 脚本 | **HiLife 领先** |

**结论一句话**：openGym 在**「纯函数领域建模 + 属性化测试 + 目录治理」**三层领先 HiLife；HiLife 在**「热量/识别/主题/视觉」**四层领先。⇒ 该抄的是工程方法，不是功能清单。

---

## 四、可借鉴项（按「投入 / 收益」排序）

### P0-1 · 把「疲劳/恢复/停训」做成纯函数 + 单调性属性化探针 ★最高价值

**openGym 事实**：`fatigueOf(history, now)` 按肌肉返回疲劳度，扫描窗 `FATIGUE_SCAN_MS`；性质「时间前移，疲劳单调不增」被 1,080,000 次比较守住；零三方依赖，确定性 LCG。

**为什么适配 HiLife**：这是 HiLife **最大的功能缺口**，且现成地基全在——`bodymap.bodyPaths()` 已是纯路径（红线已立）；`bodymap.js` **已有 target→slug 映射表**（实测）；`exercises.js` 每条动作带 `target` + `steps`；`trainingLogs` 有完整时间戳。**不需要新数据、不需要新映射表，只需要新纯函数。**

**落地形状**（严格对齐 HiLife 既有纪律）：
1. 新建 `utils/muscleStatus.js`（**唯一真源**，`fatigueOf(logs, now)` 返回逐 slug `{trained, fatigued, detrained}` + 强度）；**直接复用 `bodymap.js` 的 target→slug 映射，禁另建一份**（单源红线）；页面只渲染不计算。
2. 输入侧用 `exercises.js` 的 `target`（18 值词表）⇒ 经映射落到 ~21 个图集 slug。⚠️ **有 6 个 target 在图集里无同名 slug**（如 `serratus anterior → chest`），这类近似归并会**让疲劳度被算到邻近肌群上**——守卫必须显式断言这 6 条的归并结果，否则「疲劳」会悄悄失真。
3. 沿用 HiLife 现成的计数口径红线：**训练天数按去重日期**，连续天数走 `dateRange.streakFromDates(set, today)`，**日期一律本地日期串、禁 `toISOString()`**（P0-0 时区缺陷的教训）。
4. 新守卫 `scripts/verify-muscle-status.cjs`：照抄探针形态 —— 确定性 LCG + 逐小时推进 + 断言单调不增 + 断言「删最近一场永不增加疲劳」+ **断言比较次数等于预期值**（防止探针自己空转报绿）；再加一条**本地 00:00–08:00 边界断言**（HiLife 独有过敏点，openGym 没有这条）。

**收益**：解剖图从「静态高亮」升级为「有决策价值的训练状态屏」，这是 openGym 10235★ 的核心卖点之一。
**成本**：约 1 个纯函数文件 + 1 个守卫脚本，**零 UI 框架改动、零主包压力**（纯 JS 约 8–12KB）。

### P0-2 · 每个 lib 配同名测试 + 「零依赖属性化探针」形态 ★最高性价比

**openGym 事实**：`src/lib/xxx.js` ↔ `xxx.test.js` 一一配对；属性化探针**不引第三方属性测试库**，自己写 LCG，脚本名 `fatigue-monotonic-probe.mjs`，并挂进 `package.json` 的 `test:fatigue-probe`。

**HiLife 现状**：守卫脚本（`verify-*.cjs`）已经很接近，但**缺「性质」这一层**——现有断言多是「某文件包含某串」的结构断言，缺少「某函数在一万个输入下满足某性质」的行为断言。`wx-miniprogram-node-test` skill 已能 stub `Page`/`Component`/`wx` 跑真实处理器，底座齐了。

**落地**：新增性质型守卫时统一采用「LCG + 固定迭代数 + 断言迭代数」形态，并写进**守卫通则第 ⑦ 条**（MEMORY.md §4）。同时把 `scripts/verify-*.cjs` 逐个补 `scripts/_out/` 产物约定（已有）。

**收益**：把「我以为对」变成「一万个输入下都对」，且对纯函数几乎零边际成本。

### P1-1 · cadence 的时区严谨处理 → 迁移成日期口径守卫

**openGym 事实**：slot **用自己的偏移**解析而非「现在」的；DST 切换/跳过的小时都处理；**解析两次**。

**对 HiLife 的意义**：这不是「抄功能」，是**抄一条已经被现实验证过的纪律**。HiLife 刚在 `store.js:60 getWeightStats` 上踩过 UTC vs 本地日期的坑（`86e306a`），而 openGym 用 4 行代码把这类错误提前挡掉。⇒ 把「**任何时刻→本地日期串的换算必须是纯函数、必须有跨 00:00 与跨月边界的断言**」写进 MEMORY.md §3 的单源口径红线，并对 `dateRange.js` 补一组边界断言（月末 31→1、闰年 2/29、跨年 12/31→1/1）。

### P3-1 · 动作目录 ID 契约成文 ⚠️ 本节判断已由复核推翻并更正

**openGym 事实**：`catalogue/README.md` 里每动作一个 JSON、**id 永久编号**；`catalogue-v13-ids.json` 维护**目录版本间的 ID 映射**；PR 跑 `validate.mjs`。⇒ 意图很明确：**动作 ID 是跨版本的永久契约**。

**HiLife 实测现状（这是本节的价值所在）**：
- 1295 条动作，id 为 4 位零填充字符串，范围 **1~5201 且高度稀疏**（上游编号，非自增）；
- ⚠️ **媒体路径 = `/images/{id}-{hash}.jpg` + `/videos/{id}-{hash}.gif`，hash 是 7 位内容哈希** ⇒ **改动任何动作内容都会让它的媒体路径变化**；
- `utils/exercises.js` 首行写着「**由 `scripts/gen-exercises-compact.cjs` 生成，勿手改**」—— 也就是说这是一条**可重跑的生成链**，重跑时 hash 会随内容漂移；
- ⇒ **风险假设**：历史训练记录按动作 id 引用；若重跑生成链导致 id 重排或 hash 漂移，**用户的旧记录会指向错误或 404 的动作**。

> ### ⚠️ 2026-10-13 复核：上一版这个判断**是错的**，本节已更正
>
> 写这份分析时我grep 了 `verify-*.cjs`，只看到文件名里没有 "catalogue"，就断言「全仓无任何守卫」。**这是拿「名字没出现过」当「能力不存在」——正是守卫通则③。** 复核后的事实：
>
> | 我以为缺的 | 实际已有的 |
> |---|---|
> | id 唯一断言 | ✅ `scripts/scan-exercises-invariants.cjs` 有 `ids` Set + `dupIds` |
> | hash 漂移检测 | ✅ `scripts/verify-exercises-compact.cjs` + `scripts/exercises-fingerprint.json`：`FIELDS = ['id','name','nameZh','category','equip','target','image','imageLocal','video','steps']` 逐字段哈希，**image/video（即 hash）在列** |
> | id 重排 / 换位 | ✅ 同上**按位置逐位比对**（注释明写「换位抓不到」的历史教训已修） |
> | 「自己跟自己比」的假绿 | ✅ 已修：不用 `git show HEAD`，改用**随代码提交的固定指纹**（注释原文：原先那个写法「提交后自动退化成安慰剂」） |
> | 媒体文件是否真存在 | ✅ `scripts/check-storage-coverage.cjs`，零凭据 HEAD 请求，2606/2606 实测通过 |
>
> 实测运行：`按位置比对 1295/1295，digest 4002260c641c2798 ✓ PASS（10 字段 × 1295 动作，含顺序）`。
>
> **⇒ 结论翻转：这一项不是「新增守卫」，而是「已有守卫且设计得比我的提案更好」**（它连「更新指纹与验证的顺序不能反」都写进了注释 —— 先更新指纹再验证等于把尺子改成跟被测物一样长）。**降级为 P3，实质动作只剩补一条契约注释。**
>
> **留下的真实缺口只有两个，都不是「哈希」问题**：
> 1. **契约未成文**：`gen-exercises-compact.cjs` 与 `exercises.js` 的注释里**没有任何一句写「id 一经分配即永久、hash 变更须显式 review」**。守卫能抓住「变了」，但没人知道「什么情况下是允许变的」。⇒ 补注释（10 分钟）。
> 2. **可达性检查依赖网络、故意不进 `run-all-guards.cjs`**（脚本注释明写）。⇒ 这是**设计决策而非漏洞**，但意味着它只在有人手动跑时生效；建议挂到上线前清单的必跑项（已有，需确认没被漏掉）。

### P1-3 · 假 provider 随镜像发布 —— 落到 HiLife 的形态

**openGym 事实**：`fixture` 假 provider 随镜像发布，CI 靠它跑，实例主在接真账号前就能看完整回路；并**诚实标注**哪些能力因此「看起来可用其实没接」。

**HiLife 可借的形态**：识别链路已有 `MEDIA_MODE` 这类模式开关，但**没有 fixture provider**。⇒ 建议：`server/app.py` 增一个 `VISION_MODE='fixture'`，让 CI / 本地联调 / 提审前的自测能跑通「拍照→识别→纠错→入库→复盘」整条回路，而不必真调大模型（省钱、且不会把 `LLM_API_KEY` 泄漏风险带进测试路径）。
⚠️ **红线**：fixture 必须**只在显式开关下启用**，且**绝不作为生产兜底**（HiLife 已立「禁 mock 兜底」）。这正是 openGym 值得学的地方——它把假实现摆在**明面上**而不是藏在兜底分支里。

### P2-1 · 目录 README 当规范载体

**openGym 事实**：`catalogue/README.md` 写死四条规则（自己写 / 不做医疗建议 / 媒体不开放 / 不许喂 AI 工具），PR 跑 `validate.mjs`。

**对 HiLife 的价值**：HiLife 的纪律目前散在 MEMORY.md / 记忆日志 / 守卫脚本里。⇒ 在动作目录与 `utils/` 各补一份短 README，把「禁第二份实现 / 禁取末组快照 / 日期禁 UTC / 小字一律 `--n-700`」等**就近写在文件旁边**。这直接服务于「抽共享 util 后他套集体变红 = 按原意改指新源」这条通则——因为新人不必翻记忆也知道意图。

### P2-2 · 1RM 估算收进纯函数

`onerm.js` 是 HiLife 复盘里缺的一环（现在只有 verdict 比共同动作）。⇒ 若做，走 `utils/onerm.js` 纯函数 + 守卫断言，且**只在复盘页展示、不得反写计划**（`store.updatePlan` 单源红线不变）。

---

## 五、明确不跟的项（附理由）

| openGym 做法 | 不跟原因 |
| --- | --- |
| **定时推送 cadence** | HiLife 无服务器、1.0 前不做云 DB 同步；且单页模式无订阅消息位。且 openGym 自己的教训（「无事而发的通知 ⇒ 用户关掉通知」）说明**通知是负担不是价值**。 |
| **Passkey / 多用户账号体系** | 用户已拍板 1.0 前不做云同步，登录＝本机匿名标识。跟了就得改 `privacy.wxml` 的存储口径并把 `verify-profile C10` 禁词扫描扩过去。 |
| **PWA / Capacitor Android·iOS 壳** | 小程序即容器，另开壳等于两套发布链。 |
| **MCP 读写（Phase 2/3）** | 主包余量 433KB，且引入长驻 token + 写锁语义，与「文案只写实现得了的事」冲突。**只读 MCP 亦暂不做**（无服务器、无容器）。 |
| **AGPL-3.0** | 与 HiLife 的分发路径不兼容，**任何代码借鉴都必须是「读思路、不抄实现」**。 |
| **1324 条动作全量 JSON 塞进前端（`exercises-data.js` 1.17MB）** | HiLife 主包只剩 433KB，**绝不能把动作全表打进包**。openGym 是 Web 应用有 CDN，HiLife 没有——这是最容易被误抄的一条。 |
| **自己写 1324 条动作 + 20 语言 i18n** | 与 HiLife 现有 1324 张图同源，重做无收益。 |

---

## 六、一页行动清单（2026-10-13 复核重排）

> **本轮复核的三个方法论收获，比清单本身更重要**：
> 1. **「grep 不到文件名」≠「能力不存在」**——上一版把已有守卫当成缺口（守则③）。
> 2. **优先级必须按「实测剩下的缺口」排，不是按「分析时印象中的缺口」排**——本清单已按此重排。
> 3. **每项都标了「实测状态」**，未核实的一律标 ⬜ 而不是默认该做。

### 已完成（2 项）
| 优先级 | 动作 | 状态 |
| --- | --- | --- |
| P0-1 | `utils/muscleStatus.js` 纯函数 | ✅ `b6e4e36`，10998B / 主包 +11KB |
| P0-2 | 性质型守卫 + 变异测试 | ✅ 同上，`verify-muscle-status.cjs` 78 断言；通则①已补「变异测试」写法 |
| **P0-3** | **接入页面** | ✅ 已落`pages/action-detail`「当前状态」区块；守卫 78 → **131 断言**（新增 [F] 接线节）。⚠️ **落地时推翻了原接法**：解剖图上禁做多色编码（两两对比仅 1.06~1.34:1，是载体限制），改走文字芯片；`bodyPaths` 加 `colorOf` 回调而非叠加绘制（`drawBody` 每次 `clearRect`） |

### P1（3 项，均为「纪律补齐」而非新功能）
| 优先级 | 动作 | 实测状态 | 成本 |
| --- | --- | --- | --- |
| P1-1 | `dateRange` 边界断言 | ✅ **已完成**：`scripts/verify-date-range-boundary.cjs`，**74 断言**（六节：round-trip+本地午夜 / 闰年含400 规则 / 月末年末含不存在日期 / streak跨闰日 / weekRange 跨年周 / 单源静态扫）。**实现一条没改**。⚠️ 变异测试暴露两类「测不出来」：**同解实现**（手写 `Date.UTC` 与现实现结果完全一致 ⇒ 必须靠形态断言）与**防御代码**（死循环上限正常路径到不了）。详见参考卷 R13 | — |
| P1-2 | 「性质型守卫 + 必须配变异测试」写进守卫通则 | ✅ 已完成（2026-10-13，通则①已补「最优做法 = 变异测试」） | — |
| P1-3 | fixture 模式（显式开关、**禁兜底**） | ✅ **已完成**：`server/fixture.py` + `VISION_MODE=fixture`（默认关）；判定顺序 = **显式开关 > LLM > 真实模型**；`/health` 如实上报 `fixture:true`。守卫 `verify-vision-fixture.cjs` **56 断言**，变异测试 5 个全被抓住（含「抢兜底位」「except 回退」两个最危险的）。⚠️ 关键设计：**`mock` 恒 False + 独立 `fixture` 标记** —— 客户端「凡 mock:true 一律拒绝」的防线是对的、不许为 fixture 放宽。详见参考卷 R14 | — |

### P2（3 项，可批量后一次做）
| 优先级 | 动作 | 实测状态 |
| --- | --- | --- |
| P2-1 | `utils/onerm.js` 纯函数（1RM 估算） | ⬜ 实测**全仓无任何 1RM 实现**（`grep -i '1RM\|onerm\|Epley\|Brzycki'` 零命中）。⚠️ 价值低于原估：openGym 有它是因为它的用户群练力量举，HiLife 主体是**热量 + 记录 + 拍照识别**，1RM 对「减脂增肌」用户是弱需求 ⇒ **建议降为不做**，除非你要做力量举垂类 |
| P2-2 | `utils/README.md`（纪律就近） | ✅ **已完成**：15 条唯一真源一览表（含实测断言数）+ 纯度分层 + 三条最常见越界 + 已知刻意的两处不同。数字全部实测核对，非凭记忆 |
| P3-1 | 动作 id 契约成文 | ✅ **已完成，且不止成文**：契约写在 README / `exercises.js` / `gen-exercises-compact.cjs` **三处**（生成器侧也要写，否则改生成器的人看不到），并新增 `verify-exercise-id-contract.cjs` **34 断言**把契约变成可执行。⭐ **「成文」只是第一步 —— 注释会被跳过，必须有守卫真的盯住** |
| ~~P2-1~~ | ~~`utils/onerm.js`~~ | ⛔ **建议砍掉**（openGym 有它因用户群练力量举；HiLife 主体是热量+记录+拍照识别，1RM 对「减脂增肌」是弱需求） |

### P3（原 P1-2，已降级后仍完成）
⚠️ 原判断「全仓无守卫」是**错的**（拿「文件名里没有 catalogue」当「能力不存在」＝守则③）。实际 `verify-exercises-compact` + `scan-exercises-invariants` + `check-storage-coverage` 四项早已覆盖。现已**额外**补上「契约成文 + 契约守卫」。

### ⚠️ 明确不做（复核后新增一条）
| 项 | 理由 |
| --- | --- |
| `scripts/verify-catalogue-ids.cjs`（原 P1-2 提案） | **重复造轮子**。原提案想验的 id 唯一 / hash 漂移 / 换位 / 假绿，四项现有守卫全覆盖。新建脚本只会造成「两份尺子」，而两份尺子必然漂移 —— 这违反单源红线 |

### 主包预算纪律（对以上每一项都成立）
`utils/exercises.js` 已 220KB、`bodymap-data.js` 61KB、`muscleStatus.js` 11KB，**当前余量 422 KB**。⇒ 新增只能是**纯函数 + 守卫脚本**；基线快照与映射表一律落 `scripts/`（该 folder 与 `.cjs` 后缀均已在 `packOptions.ignore`），**不得进主包**。

### 一句话排序
##✅ 清单全部完成（P0-1/0-2/0-3 · P1-1/1-3 · P2-2 · P3-1），唯一被砍的是 1RM（建议不做）。
> 落地过程本身产出了 6 条长期纪律与 3 条环境坑，全部写进 `.workbuddy/memory/`（参考卷 R11–R15）。

## 附：素材与抓取说明

- **openGym 侧来源**：仓库元数据 API、根目录清单、`catalogue/README.md`、`mcp/README.md`、`api/coach/adapters/index.js`、`api/coach/cadence.js`、`api/coach/warmup.js`、`frontend/scripts/fatigue-monotonic-probe.mjs`、`api/package.json`、`frontend/package.json`、`frontend/src/lib/` 目录清单。
- **openGym 侧未取到正文**：`frontend/src/lib/recovery.js`、`muscles.js`、`onerm.js`、`api/server.js`（157KB）—— 受抓取通道响应体积上限限制。`recovery.js` 的对外契约已由探针脚本完整暴露；其余三份的实现细节在本文中**未被引用为事实**。
- **HiLife 侧为直接实测**（非记忆、非推断）：解 `utils/exercises.js` 的 `_R` 得 1295 条 / 6 组 / id 唯一 / 范围 1~5201 / 媒体路径含内容 hash；解 `utils/bodymap-data.js` 得 slug 词表；读 `utils/bodymap.js` 得既有 target→slug 映射。
- **推断标注**：凡「建议…」「可以做…」处均为建议而非现状陈述；凡称 openGym 或 HiLife 事实处均可回溯到上述来源。
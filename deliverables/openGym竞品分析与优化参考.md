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
| **肌肉疲劳 / 恢复 / 停训三态** | ✅ `recovery.js` + `muscles.js` 核心卖点 | ⚠️ 仅「训练过」高亮 | **最大功能缺口** |
| 肌肉解剖图 | ✅ `body-paths.js` 94KB 纯路径 | ✅ `bodymap.bodyPaths()` 纯路径（**红线已立**） | 已对等（HiLife 更小更聚焦） |
| 动作库 | ✅ 1324 条 JSON + 20 语言 + mp4 演示 | ✅ **1295 条**（实测）+ 1324 张 180×180 演示图；压缩行式格式 220KB | 素材同源，**ID 治理落后**（见 P1-2） |
| 目录 ID 跨版本稳定 | ✅ `catalogue-v13-ids.json` + README 明文「id 永久编号」 | ❌ **无契约声明、无版本映射、媒体路径含内容 hash** | **可补（低成本高价值）** |
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

### P1-2 · 动作目录 ID 永久契约 + 内容 hash 稳定性守卫 ★实测发现隐患

**openGym 事实**：`catalogue/README.md` 里每动作一个 JSON、**id 永久编号**；`catalogue-v13-ids.json` 维护**目录版本间的 ID 映射**；PR 跑 `validate.mjs`。⇒ 意图很明确：**动作 ID 是跨版本的永久契约**。

**HiLife 实测现状（这是本节的价值所在）**：
- 1295 条动作，id 为 4 位零填充字符串，范围 **1~5201 且高度稀疏**（上游编号，非自增）；
- ⚠️ **媒体路径 = `/images/{id}-{hash}.jpg` + `/videos/{id}-{hash}.gif`，hash 是 7 位内容哈希** ⇒ **改动任何动作内容都会让它的媒体路径变化**；
- `utils/exercises.js` 首行写着「**由 `scripts/gen-exercises-compact.cjs` 生成，勿手改**」—— 也就是说这是一条**可重跑的生成链**，重跑时 hash 会随内容漂移；
- 全仓**无任何守卫**断言 id 唯一 / 媒体路径存在 / 版本间 id 稳定。

⇒ **真实风险**：历史训练记录按动作 id 引用；若某次重新生成动作库导致 id 重排或 hash 漂移，**用户的旧记录会指向错误或 404 的动作**。这属于「静态守卫完全看不见、只有真机才暴露」的一类问题。

**落地**：
1. `scripts/verify-catalogue-ids.cjs`：断言 ① id 全唯一；② id 4 位零填充且范围不回退（与一份基线 `scripts/_out/` 侧快照比对——⚠️ **快照落 `scripts/`，不进主包**）；③ 每条动作的 `image`/`video` 路径在磁盘或存储侧存在（可复用 `scripts/check-storage-coverage.cjs` 的零凭据校验思路）。
2. 在 `gen-exercises-compact.cjs` 顶部与 `exercises.js` 头部注释补一条**契约**：id 一经分配即永久，删除走 tombstone 不复用；**hash 变更必须显式 review**（因为它会改媒体路径）。
3. 守卫断言数与运行方式对齐现有 18 脚本口径。

**收益**：把「重跑一次生成脚本可能静默改坏历史记录引用」变成 CI 里的一条红。

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

## 六、一页行动清单

| 优先级 | 动作 | 落点 | 预估 |
| --- | --- | --- | --- |
| **P0** | `utils/muscleStatus.js` 纯函数（trained/fatigued/detrained） | 新文件 | 8–12KB |
| **P0** | `scripts/verify-muscle-status.cjs`（LCG 属性化 + 单调性 + 删最近一场不变量 + 本地 00:00 边界 + 断言迭代数） | 新守卫 | 与现有守卫同量级 |
| **P0-2** | 把「性质型守卫」形态写进守卫通则第 ⑦ 条 | MEMORY.md §4 | 1 行 |
| **P1** | `dateRange.js` 补月末/闰年/跨年边界断言 | 既有守卫 | ~15 断言 |
| **P1** | `scripts/verify-catalogue-ids.cjs`（id 唯一/不回退/媒体路径可达；基线快照落 `scripts/`，**不进包**）+ 生成脚本补 id 永久契约 | 新守卫 + 生成器注释 | 中 |
| **P1** | `server/app.py` 增 `VISION_MODE='fixture'`（显式开关、禁兜底） | 后端 | 小 |
| **P2** | `utils/` 与动作目录各补一份短 README（纪律就近） | 文档 | 小 |
| **P2** | `utils/onerm.js` 纯函数，仅复盘页展示、不反写计划 | 新文件 | ~4KB |

⚠️ **主包预算纪律（针对本表）**：`utils/exercises.js` 已 220KB、`bodymap-data.js` 已 61KB，主包余量 433KB。**以上任何新增都必须是纯函数 + 守卫脚本**；基线快照与映射表一律落 `scripts/`（该 folder 与 `.cjs` 后缀均已在 `packOptions.ignore` 中），**不得进主包**。

**与 openGym 的差异化定位（建议保持）**：HiLife = **「会算热量 + 会拍照认饭 + 视觉考究的本地训练记录器」**；openGym = **「自托管的肌肉疲劳管理台」**。两条路可以并行借鉴工程方法，但产品叙事不必趋同——HiLife 独有的 kcal 推荐链与 AI 识别，正是 openGym 完全没有的。

---

## 附：素材与抓取说明

- **openGym 侧来源**：仓库元数据 API、根目录清单、`catalogue/README.md`、`mcp/README.md`、`api/coach/adapters/index.js`、`api/coach/cadence.js`、`api/coach/warmup.js`、`frontend/scripts/fatigue-monotonic-probe.mjs`、`api/package.json`、`frontend/package.json`、`frontend/src/lib/` 目录清单。
- **openGym 侧未取到正文**：`frontend/src/lib/recovery.js`、`muscles.js`、`onerm.js`、`api/server.js`（157KB）—— 受抓取通道响应体积上限限制。`recovery.js` 的对外契约已由探针脚本完整暴露；其余三份的实现细节在本文中**未被引用为事实**。
- **HiLife 侧为直接实测**（非记忆、非推断）：解 `utils/exercises.js` 的 `_R` 得 1295 条 / 6 组 / id 唯一 / 范围 1~5201 / 媒体路径含内容 hash；解 `utils/bodymap-data.js` 得 slug 词表；读 `utils/bodymap.js` 得既有 target→slug 映射。
- **推断标注**：凡「建议…」「可以做…」处均为建议而非现状陈述；凡称 openGym 或 HiLife 事实处均可回溯到上述来源。
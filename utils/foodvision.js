// utils/foodvision.js
// 拍照/选图 → 视觉识别 → 结构化营养结果
//
// 两种调用模式（由 globalData.useCallContainer 切换）：
//   1) 云托管 callContainer 模式（上线默认）：压缩图片→base64→JSON，
//      wx.cloud.callContainer 调用，免备案、免服务器域名。
//      受云托管 100K 请求体限制，前端会把图压到 ~480px / quality 20。
//   2) uploadFile 模式（开发/自有服务器）：wx.uploadFile 传原图到 visionBackendUrl。

function getCfg() {
  const app = getApp();
  const g = (app && app.globalData) || {};
  return {
    useCC: !!g.useCallContainer,
    env: g.cloudEnv || '',
    service: g.visionService || 'hilife-vision',
    // 空串 = 未配置。**不再兜底任何写死的地址**：原先这里和 app.js 各写死一个局域网 IP，
    // 而且互不同网段 —— 两个「默认值」互相矛盾，谁也不知道真正的后端到底在哪。
    // 地址随机器/网段变化，留在仓库里只会泄漏内网拓扑并误导后来者；改为空，由 analyzeByUpload 明确报错。
    url: (g.visionBackendUrl && g.visionBackendUrl.trim()) || ''
  };
}

/* ---------- 失败对象的统一形状 ---------- */
// 服务端返回的 { code, message } 里，message 是**给运维排查**的人话（含「去配哪个环境变量」），
// 绝不能直接弹给用户；跨端只认 code，由 userMessage() 翻成用户可见文案。
// 兼容 FastAPI 的两种包法：{detail:{code,message}} 与 {detail:"..."}。
function visionError(code, message) {
  const e = new Error(message || code || '识别失败');
  e.code = code || 'VISION_FAILED';
  return e;
}

function parseBody(data) {
  if (data && typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return null; }
}

function fromServer(d) {
  const det = (d && typeof d.detail === 'object') ? d.detail : d;
  const code = (det && det.code) || (d && d.code) || 'VISION_FAILED';
  const msg = (det && det.message) || (d && d.message)
    || (d && typeof d.detail === 'string' ? d.detail : '');
  return visionError(code, msg);
}

// 用户可见文案的唯一真源。改文案只改这里，页面只管 err 传进来。
//
// ⚠️ 这里必须覆盖**服务端说过的每一个 code** —— 守卫 scripts/verify-vision-result.cjs [D]
// 会从服务端源码里抽出所有 code 反查，漏一个就按红。
// 分档原则：**「我们的问题」不要包装成「你的照片不行」**。
// 旧实现只有两档，于是上游 401/429/超时、任务丢失全落进 VISION_FAILED，
// 用户拿到的永远是「换一张更清晰的照片再试试」—— 他重拍一百次也没用，
// 体感就是「这功能经常识别不出来」。分档之后每一档都指向一个可执行的动作。
const USER_TEXT = {
  // ① 服务端配置/上游问题：用户做什么都没用，别让他反复重拍
  VISION_NOT_READY: '照片识别暂时不可用，请稍后重试，或手动填写热量。',
  VISION_AUTH: '照片识别暂时不可用，请稍后重试，或手动填写热量。',
  VISION_MODEL: '照片识别暂时不可用，请稍后重试，或手动填写热量。',
  VISION_UPSTREAM: '识别服务暂时不可用，请稍后重试，或手动填写热量。',
  // ② 上游忙 / 额度受限：稍后重试有效，但别让用户以为是自己照片的问题
  VISION_QUOTA: '识别服务当前繁忙（额度受限），请稍后重试，或手动填写热量。',
  VISION_TIMEOUT: '识别用时过长，请检查网络后重试，或手动填写热量。',
  // ③ 任务在服务端丢失（实例重启/缩容）——客户端会自动重提一次，走到这里说明重提也没成
  VISION_TASK_LOST: '识别服务繁忙，请再试一次，或手动填写热量。',
  // ④ 引擎跑了但这次没成：可能是照片或网络 → 引导重拍
  VISION_FAILED: '没能认出这道菜，换一张更清晰的照片再试试。'
};

function userMessage(err) {
  const code = err && err.code;
  if (code && USER_TEXT[code]) return USER_TEXT[code];
  const raw = String((err && (err.errMsg || err.message)) || '');
  if (/timeout|超时/i.test(raw)) return '识别超时，请检查网络后重试。';
  // 未映射的失败照实记一笔，方便排查；但只给用户一句通用话术
  if (raw) console.warn('[vision] 未映射的失败：', raw);
  return '识别失败，请稍后重试。';
}

// 「再试一次」到底有没有意义 —— 页面据此决定失败弹窗要不要给「重试」按钮。
//
// 为什么必须分开：给用户一个**注定失败**的重试，比不给他更伤 —— 他会连点几次、
// 每次等满 70s，最后判定「这功能就是坏的」。密钥失效 / 模型没开通 / 额度用尽
// 都属于「你再点一百次也一样」，那就不该出现重试按钮，只能引导手动填写。
// ⚠️ 新增 code 时必须在这里表态（守卫 scripts/verify-vision-result.cjs 有一张对照表）。
const RETRYABLE = {
  VISION_FAILED: true,      // 这次没认清，换一张/再跑一次都可能好
  VISION_TIMEOUT: true,     // 上游或网络慢，重试是标准动作
  VISION_TASK_LOST: true,   // 任务丢了，重提正好补上（客户端已自动重提一次）
  VISION_UPSTREAM: true,    // 上游抖动/5xx，通常自愈
  VISION_NOT_READY: false,  // 服务端没启用引擎：用户做什么都没用
  VISION_AUTH: false,       // 密钥失效：用户做什么都没用
  VISION_MODEL: false,      // 模型名错/未开通：用户做什么都没用
  VISION_QUOTA: false       // 限流或额度用尽：重试只会更糟
};

function isRetryable(err) {
  return !!(err && RETRYABLE[err.code]);
}

// 把临时图片压缩到 100K 以内并读成 base64（云托管 callContainer 限制）
function compressToBase64(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: tempFilePath,
      quality: 20,
      compressedWidth: 480,
      success: (r) => {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: r.tempFilePath,
          encoding: 'base64',
          success: (res) => resolve('data:image/jpeg;base64,' + res.data),
          fail: reject
        });
      },
      fail: reject
    });
  });
}

// 云托管模式：异步任务（callContainer 有 15s 硬超时，同步识别必超时 102002）
//   1) POST /task/submit（JSON base64，压缩图 <100K）→ 立即返回 {taskId}
//   2) GET  /task/{id} 轮询 → {status: processing|done|error, result}
//
// ── 轮询节奏（2026-09-29 改，2026-10-15 收紧）──
// 原先固定 2s 一轮、30 轮：模型 4s 出结果也要等到第 3 轮（≈6s），平均白等 1s、最坏 2s。
// 改为首轮 0.6s、每轮 +0.7s、2s 封顶后，2026-10-15 再收紧到 **首轮 0.4s、每轮 +0.5s、
// 1.5s 封顶**：glm-5.3-flash 常见耗时 3~6s，每轮多花一次 callContainer 往返（开销极小），
// 换取结果就绪后平均少等 ~1s。上限仍由总时长窗口兜底。
const POLL_FIRST_MS = 400;
const POLL_STEP_MS = 500;
const POLL_MAX_MS = 1500;
// 总窗口**必须大于**服务端单次上游超时（server/vision_llm.py 的 REQ_TIMEOUT = 50s），
// 否则服务端还在算、客户端已经弹「识别超时」，用户永远拿不到「到底为什么慢」的那个 code。
const POLL_DEADLINE_MS = 70000;
const POLL_MAX_TRIES = 60;        // 兜底，防止轮询间隔被 stub 成 0 时死循环
const SUBMIT_RETRY_MS = 800;      // 提交失败后的重试间隔

function analyzeByCallContainer(tempFilePath, cfg) {
  return compressToBase64(tempFilePath).then((b64) => runTask(cfg, b64, true));

  // 一次完整尝试 = 提交 + 轮询；allowResubmit 控制「任务丢失时再提交一次」。
  function runTask(cfg2, b64, allowResubmit) {
    return submitTask(cfg2, b64)
      .then((taskId) => pollTask(cfg2, taskId))
      .catch((err) => {
        // 任务在服务端丢了（实例重启 / 缩容 / 多实例——见 server/app.py 的 TASKS 说明）。
        // 识别是**只读**的，重提不会产生重复记录，代价只是一次调用费；相比让用户
        // 以为「识别不出来」再自己去重拍，显然划算。**只重提一次**，不放大成本。
        if (allowResubmit && err && err.code === 'VISION_TASK_LOST') {
          console.warn('[vision] 任务在服务端丢失（实例可能重启/缩容），自动重提一次');
          return runTask(cfg2, b64, false);
        }
        throw err;
      });
  }
}

// 提交识别任务。网络层失败**重试 1 次**：云托管冷启动时第一枪很容易直接超时，
// 而第二枪几乎立刻就好 —— 不重试的话用户看到「识别失败」，实际上根本没跑起来。
function submitTask(cfg, b64) {
  return new Promise((resolve, reject) => {
    if (typeof wx.cloud === 'undefined' || !wx.cloud.callContainer) {
      reject(new Error('wx.cloud.callContainer 不可用，请确认已 wx.cloud.init 且基础库 >= 2.13.1'));
      return;
    }
    const once = (attempt) => {
      wx.cloud.callContainer({
        config: { env: cfg.env },
        path: '/task/submit',
        method: 'POST',
        header: { 'X-WX-SERVICE': cfg.service, 'content-type': 'application/json' },
        data: { image: b64 },
        success: (res) => {
          const d = parseBody(res.data);
          // 服务端 5xx 时 wx.cloud.callContainer 同样走 success 回调 —— 不看 statusCode
          // 就会把 503 的错误体当成正常返回，最后以一句莫名其妙的「提交识别任务失败」收场。
          if (res.statusCode >= 400) { reject(fromServer(d)); return; }
          if (d && d.taskId) { resolve(d.taskId); return; }
          reject(visionError('VISION_FAILED', (d && d.message) || '提交识别任务失败'));
        },
        fail: (err) => {
          if (attempt === 0) { setTimeout(() => once(1), SUBMIT_RETRY_MS); return; }
          reject(err);
        }
      });
    };
    once(0);
  });
}

// 轮询任务结果：首轮 0.4s、每轮 +0.5s、1.5s 封顶，总窗口 70s。
function pollTask(cfg, taskId) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let tries = 0;
    const expired = () => tries >= POLL_MAX_TRIES || (Date.now() - startedAt) >= POLL_DEADLINE_MS;
    const nextDelay = () => Math.min(POLL_FIRST_MS + (tries - 1) * POLL_STEP_MS, POLL_MAX_MS);
    const tick = () => {
      tries++;
      wx.cloud.callContainer({
        config: { env: cfg.env },
        path: '/task/' + taskId,
        method: 'GET',
        header: { 'X-WX-SERVICE': cfg.service },
        success: (res) => {
          const d = parseBody(res.data);
          if (res.statusCode >= 400) { reject(fromServer(d)); return; }
          if (d && d.status === 'done') { resolve(d); return; }
          // 引擎不可用/识别失败/任务丢失都走这里，带着 code 让 userMessage() 翻成人话
          if (d && d.status === 'error') { reject(visionError(d.code, d.message)); return; }
          if (expired()) { reject(visionError('VISION_TIMEOUT', '轮询到达客户端窗口上限')); return; }
          setTimeout(tick, nextDelay());
        },
        fail: (err) => {
          // 单次网络抖动容忍，不立即失败
          if (expired()) { reject(err); return; }
          setTimeout(tick, nextDelay());
        }
      });
    };
    tick();
  });
}

function analyzeByUpload(tempFilePath, cfg) {
  return new Promise((resolve, reject) => {
    const base = (cfg.url || '').replace(/\/+$/, '');
    // 空地址必须在这里拦住：wx.uploadFile({ url: '/analyze' }) 会当成相对地址发出去，
    // 失败回调只丢回一句「请求失败」，排查成本极高。这里直接把「该配哪一项」说出来。
    if (!base) {
      reject(new Error('未配置视觉识别后端地址：开发联调请在 app.js 的 globalData.visionBackendUrl 填入 vision-server 地址；生产请使用 useCallContainer 模式'));
      return;
    }
    wx.uploadFile({
      url: base + '/analyze',
      filePath: tempFilePath,
      name: 'image', // 与服务端 multipart 字段名一致
      formData: {},
      success: (res) => {
        const data = parseBody(res.data);
        // wx.uploadFile 对 4xx / 5xx 同样走 success 回调 —— 必须自己看 statusCode，
        // 否则 503 的错误体会被当成识别结果一路传到「加入记录」。
        if (res.statusCode >= 400) { reject(fromServer(data)); return; }
        if (!data) { reject(visionError('VISION_FAILED', '返回数据解析失败')); return; }
        resolve(data);
      },
      fail: reject
    });
  });
}

// tempFilePath: wx.chooseMedia 返回的临时文件路径
//
// 返回 Promise<服务端统一合约>。**两条模式返回的字段并不完全相同**，读之前先看清：
//
//   共同字段：
//     name: str                          // 菜名（可能是泛称「识别到的食物」）
//     items: [{ name, weight_g, calories }]
//     total_weight_g / total_calories: int
//     confidence: float|null             // 0–1
//     mock: bool                         // **恒 false**：服务端已无 mock 兜底（2026-09-28 移除）。
//                                        // 页面若仍读到 true，说明服务端违约 → 一律按「引擎异常」阻断，
//                                        // 绝不能把示例数据写进饮食记录。
//
//   ⚠️ **失败一律以 reject 表达，且 err.code 是跨端唯一的失败标识**（文案见上方 USER_TEXT）：
//     VISION_NOT_READY  服务端没启用引擎（没配 LLM_API_KEY 等）——用户重拍没用
//     VISION_AUTH       上游鉴权失败（密钥无效/无权限）
//     VISION_MODEL      上游拒绝该模型（名字写错 / 该模型未开通）
//     VISION_UPSTREAM   上游连接失败或 5xx
//     VISION_QUOTA      上游 429：限流 / 额度用尽
//     VISION_TIMEOUT    上游超时，或客户端轮询到达窗口上限
//     VISION_TASK_LOST  任务在服务端丢了（实例重启/缩容）——已自动重提一次
//     VISION_FAILED     引擎跑了但这次没成（解析失败/照片不清）——可引导重拍
//   区别「我们的问题」与「你的照片问题」是这套 code 的全部意义：分错了，用户就会
//   拿着一条他改不动的错误反复重拍。
//   服务端 err.message 是给运维排查的（可能含「去配哪个环境变量」），**不要弹给用户**；
//   页面只调 userMessage(err) 取用户可见文案，那里是唯一真源。
//
//   仅 LLM 路径（云托管 → server/vision_llm.py）额外有：
//     protein / carb / fat: int          // 三大营养素，只有这条路给
//     provider: str                      // 形如 "llm:qwen-vl-max"
//
//   仅 CalorieScan 路径（server/analyzer.py）额外有：
//     success: bool（恒 true，失败以 HTTP 异常表达）、note: str
//     ⚠️ **没有** protein/carb/fat ⇒ 这三项会是 null，页面必须按「未知」而不是 0 展示。
//     ⚠️ 局域网 uploadFile 模式（POST /analyze）**只走这一条**，接不到 LLM
//        （见 server/app.py:76）—— 所以联调时看不到蛋白质/碳水/脂肪是正常的。
//
//   两条路径都**没有** `foods` 字段。曾有一版注释把它写成 `{ foods, total, ... }`，
//   结果 `pages/food-vision` 照着错口径写成 `r.foods.map(...)`，任何一条服务端路径都
//   拿不到数据（该页同时也没有任何入口，属双重死代码）。**改合约先改这里。**
function analyzeImage(tempFilePath) {
  const cfg = getCfg();
  const p = cfg.useCC ? analyzeByCallContainer(tempFilePath, cfg) : analyzeByUpload(tempFilePath, cfg);
  // mock 结果一律当**失败**处理。服务端已无 mock 兜底（2026-09-28 移除），这里再兜一道：
  // 示例数据长得和真实结果一模一样，一旦漏进来就会被用户当成自己那盘菜记进饮食 ——
  // 放在这个统一出口，food-scan 与 advice 两个页面一次性都受保护，不必各自判一遍。
  return p.then((r) => {
    if (r && r.mock) throw visionError('VISION_NOT_READY', '服务端返回了 mock 结果（服务端违约）');
    return r;
  });
}

// RETRYABLE 一并导出：它是一张**对照表**（和 USER_TEXT 同性质），
// 守卫 scripts/verify-vision-result.cjs [E4] 要逐个 code 反查「有没有表过态」，
// 只有拿到真表才能验「漏登记」，光验 isRetryable() 的返回值验不出来
// （undefined 会被 !! 收成 false，漏登记和「明确不可重试」在返回值上长得一模一样）。
module.exports = { analyzeImage, getCfg, userMessage, visionError, isRetryable, RETRYABLE };

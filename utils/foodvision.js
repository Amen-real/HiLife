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
const USER_TEXT = {
  // 引擎没配好：这是服务端配置问题，用户做什么都没用 → 不要让他反复重拍
  VISION_NOT_READY: '照片识别暂时不可用，请稍后重试，或手动填写热量。',
  // 引擎跑了但这次没成：可能是照片或网络 → 引导重拍
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
//   2) GET  /task/{id} 每 2s 轮询 → {status: processing|done|error, result}
function analyzeByCallContainer(tempFilePath, cfg) {
  return compressToBase64(tempFilePath).then((b64) => new Promise((resolve, reject) => {
    if (typeof wx.cloud === 'undefined' || !wx.cloud.callContainer) {
      reject(new Error('wx.cloud.callContainer 不可用，请确认已 wx.cloud.init 且基础库 >= 2.13.1'));
      return;
    }
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
      fail: reject
    });
  })).then((taskId) => pollTask(cfg, taskId));
}

// 轮询任务结果：2s 间隔，最长约 90s（30 次）
function pollTask(cfg, taskId) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const MAX = 30;
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
          // 引擎不可用/识别失败都走这里，带着 code 让 userMessage() 翻成人话
          if (d && d.status === 'error') { reject(visionError(d.code, d.message)); return; }
          if (tries >= MAX) { reject(visionError('VISION_FAILED', '识别超时')); return; }
          setTimeout(tick, 2000);
        },
        fail: (err) => {
          // 单次网络抖动容忍，不立即失败
          if (tries >= MAX) { reject(err); return; }
          setTimeout(tick, 2000);
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
//   ⚠️ **失败一律以 reject 表达，且 err.code 是跨端唯一的失败标识**：
//     VISION_NOT_READY  引擎没配好（服务端配置问题）——用户重拍也没用
//     VISION_FAILED     引擎跑了但这次没成（照片/网络）——可引导重拍
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

module.exports = { analyzeImage, getCfg, userMessage, visionError };

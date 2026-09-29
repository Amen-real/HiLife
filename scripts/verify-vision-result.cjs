// scripts/verify-vision-result.cjs —— 视觉识别「不许给假数据」（B4-4）回归守卫
//
// 原缺陷：未配 LLM_API_KEY / 模型没就绪时，服务端会静默返回一份**写死的示例结果**
// （鸡胸肉沙拉 280g / 360kcal），客户端还会带一句「（示例数据）」把它写进今日饮食。
// 用户会把假热量当成自己那盘菜记下来 —— 那是事故，不是兜底。
//
// 现在：引擎不可用 → 服务端明确 503 / task.status=error（带 code），
//       客户端把 code 翻成用户话术；示例数据若从任何缝隙漏进来，在统一出口直接当失败拦掉。
//
// 覆盖：
//   [A] 服务端静态：mock 路径已彻底移除，EngineNotReady → 503 / task error
//   [B] 客户端**真实行为**（stub wx、真跑 utils/foodvision.js）：两条链路的失败都要以 reject 表达
//   [C] 客户端静态：页面里再无 mock 渲染/入库分支
//   [D] 跨端对齐：服务端可能产出的每个 code，客户端都翻得出人话，且**不泄漏运维术语**
//
// 用法：node scripts/verify-vision-result.cjs
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok() { pass++; }
function bad(m) { fail++; console.log('  ✗ ' + m); }
function eq(a, e, l) { if (a === e) ok(); else bad(l + '：期望 ' + JSON.stringify(e) + '，实际 ' + JSON.stringify(a)); }
function truthy(v, l) { if (v) ok(); else bad(l); }
function has(hay, needle, l) { if (String(hay).indexOf(needle) >= 0) ok(); else bad(l + ' → 未找到 ' + JSON.stringify(needle)); }
function hasNot(hay, needle, l) { if (String(hay).indexOf(needle) < 0) ok(); else bad(l + ' → 仍含 ' + JSON.stringify(needle)); }

function stripJs(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, ''))
    .join('\n');
}
// Python 注释同样要剥（`# …` 到行尾）。**要求 `#` 前是行首或空白** —— 否则会把字符串里的
// `#` 也切掉（如 '#0A0A0A'），而「`#` 前紧跟引号」正好就是这种情况。
// 不剥的后果实例：vision_llm.py 里一句「# 不 raise_for_status()：…」的说明性注释，
// 会让「已不再使用 raise_for_status」这条断言**永远报红**（注释被当成代码）。
function stripPy(s) {
  return String(s).split(/\r?\n/)
    .map(l => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// WXML 注释同样要剥：注释里提到的字段名会让「页面展示了 X」这类断言在**其实没展示**时也通过。
function stripWxml(s) {
  return String(s).replace(/<!--[\s\S]*?-->/g, '');
}
// 剥注释后的源（静态断言必须用这个，否则注释里的说明文字会顶替真实代码通过检查）
const code = (rel) => stripJs(read(rel));
// Python 源：JS 与 Python 两种注释都剥
const pyCode = (rel) => stripPy(code(rel));

/* ═══════════ [A] 服务端静态 ═══════════ */
console.log('[A] 服务端：mock 路径已移除，失败改为显式报错');
const analyzerPy = pyCode('server/analyzer.py');
const appPy = pyCode('server/app.py');

hasNot(analyzerPy, 'mock_result', 'A1 analyzer.py 不再有 mock_result()');
hasNot(analyzerPy, 'is_mock', 'A2 analyzer.py 不再有 is_mock()');
hasNot(analyzerPy, '"mock": True', 'A3 analyzer.py 不再返回 mock=True');
has(analyzerPy, 'class EngineNotReady', 'A4 analyzer.py 定义 EngineNotReady');
has(analyzerPy, 'raise EngineNotReady', 'A5 引擎不可用/推理失败一律 raise（不再 return 假数据）');
has(analyzerPy, 'def not_ready_reason', 'A6 有 not_ready_reason()，说明「该配哪一项」');
has(analyzerPy, 'def is_ready', 'A7 有 is_ready() 供 /health 判断');
// 合约字段保留（改合约会波及客户端），但必须恒 False
has(analyzerPy, '"mock": False', 'A8 合约里 mock 字段保留但恒 False');

hasNot(appPy, 'is_mock', 'A9 app.py 不再引用 is_mock');
has(appPy, 'EngineNotReady', 'A10 app.py 捕获 EngineNotReady');
has(appPy, 'HTTPException', 'A11 app.py 引入 HTTPException');
has(appPy, 'status_code=503', 'A12 /analyze 引擎不可用 → 503（服务端配置问题，不是用户输入问题）');
has(appPy, '"status": "error"', 'A13 异步任务把失败记成 status=error');
has(appPy, '"code": e.code', 'A14 task error 带 code（跨端只认 code）');
has(appPy, '"ready": llm_on or model_on', 'A15 /health 给出 ready');
has(appPy, 'out["reason"] = analyzer.not_ready_reason()', 'A16 /health 未就绪时给出原因');
has(appPy, 'if vision_llm is not None and vision_llm.llm_ready()', 'A17 走 LLM 的前提是 llm_ready()（没配就不许当成了引擎跑了）');
// LLM 未配置时必须明确拒绝，而不是回退
const llmPy = pyCode('server/vision_llm.py');
has(llmPy, 'def llm_ready', 'A18 vision_llm 暴露 llm_ready()');

/* ═══════════ [B] 客户端真实行为 ═══════════ */
console.log('[B] 客户端：两条链路真跑一遍（stub wx）');
const vision = require(path.join(ROOT, 'utils/foodvision.js'));
truthy(typeof vision.analyzeImage === 'function', 'B0 模块导出 analyzeImage()');
truthy(typeof vision.userMessage === 'function', 'B0b 模块导出 userMessage()');
truthy(typeof vision.visionError === 'function', 'B0c 模块导出 visionError()');

const CFG_UPLOAD = { globalData: { useCallContainer: false, visionBackendUrl: 'http://127.0.0.1:8000' } };
const CFG_EMPTY = { globalData: { useCallContainer: false, visionBackendUrl: '' } };
const CFG_CC = { globalData: { useCallContainer: true, cloudEnv: 'env-1', visionService: 'hilu-vision' } };

function useUpload(globalData, resp, log) {
  global.getApp = () => ({ globalData });
  global.wx = {
    uploadFile: (o) => {
      log.push(o);
      o.success(resp);
    }
  };
}
function useCallContainer(respByPath, log) {
  global.getApp = () => ({ globalData: CFG_CC.globalData });
  global.wx = {
    compressImage: (o) => o.success({ tempFilePath: '/tmp/c.jpg' }),
    getFileSystemManager: () => ({ readFile: (o) => o.success({ data: 'AAAA' }) }),
    cloud: {
      callContainer: (o) => {
        log.push(o.path);
        const r = respByPath(o.path, log.length);
        if (!r) return;                       // 故意不回回调（模拟挂住）
        o.success(r);
      }
    }
  };
}
const json = (o) => JSON.stringify(o);
// 把 reject 收敛成 {code,message,user}
const catchIt = (p) => p.then(() => ({ ok: true }), (e) => ({ ok: false, code: e && e.code, raw: e && e.message, user: vision.userMessage(e) }));

(async () => {
  // B1 未配后端地址 → 报「该配哪一项」，不是一句「请求失败」
  let log = [];
  useUpload(CFG_EMPTY.globalData, { statusCode: 200, data: '{}' }, log);
  let r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B1 未配 visionBackendUrl → 失败');
  truthy(/visionBackendUrl/.test(String(r.raw)), 'B1b 失败原因点明了该配哪一项（而不是「请求失败」）');
  eq(log.length, 0, 'B1c 地址为空时根本没发请求');

  // B2 正常结果原样透传
  log = [];
  const GOOD = { success: true, name: '番茄炒蛋', items: [{ name: '番茄炒蛋', weight_g: 250, calories: 210 }], total_weight_g: 250, total_calories: 210, confidence: 0.8, mock: false, note: 'ok' };
  useUpload(CFG_UPLOAD.globalData, { statusCode: 200, data: json(GOOD) }, log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, true, 'B2 正常结果 → resolve');
  eq(log[0].name, 'image', 'B2b multipart 字段名与服务端一致');

  // B3 服务端 503（FastAPI 的 {detail:{code,message}} 包法）→ code 透出，运维术语不落用户眼
  log = [];
  const NOT_READY = { detail: { code: 'VISION_NOT_READY', message: '食物识别服务未就绪：请在云托管配置环境变量 LLM_API_KEY；或设 CALORIESCAN_REAL=1 并配 CALORIESCAN_REPO。' } };
  useUpload(CFG_UPLOAD.globalData, { statusCode: 503, data: json(NOT_READY) }, log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B3 503 → 失败（不许被当成识别结果一路传到「加入记录」）');
  eq(r.code, 'VISION_NOT_READY', 'B3b 失败 code 透出（跨端唯一失败标识）');
  hasNot(r.user, 'LLM_API_KEY', 'B3c 用户可见文案**不含** LLM_API_KEY');
  hasNot(r.user, 'CALORIESCAN', 'B3d 用户可见文案**不含** CALORIESCAN_REPO');
  hasNot(r.user, '环境变量', 'B3e 用户可见文案**不含**「环境变量」');
  hasNot(r.user, 'VISION_', 'B3f 用户可见文案**不暴露**内部 code');

  // B3c 另一种包法：{detail: "字符串"}
  log = [];
  useUpload(CFG_UPLOAD.globalData, { statusCode: 500, data: json({ detail: 'Internal Server Error' }) }, log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B3g 500 + {detail:"字符串"} → 失败');
  eq(r.code, 'VISION_FAILED', 'B3h 无法归因的失败兜底成 VISION_FAILED');

  // B3i 引擎跑了但这次没成 → 引导重拍（与「不可用」的话术必须不同，否则用户白折腾）
  log = [];
  useUpload(CFG_UPLOAD.globalData, { statusCode: 503, data: json({ detail: { code: 'VISION_FAILED', message: '模型推理出错' } }) }, log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.code, 'VISION_FAILED', 'B3i 服务端 VISION_FAILED 原样透出');

  // B4 最后一道防线：示例数据若从任何缝隙漏进来，在统一出口当失败拦掉
  log = [];
  const MOCK = { success: true, name: '鸡胸肉沙拉', items: [{ name: '鸡胸肉沙拉', weight_g: 280, calories: 360 }], total_weight_g: 280, total_calories: 360, mock: true };
  useUpload(CFG_UPLOAD.globalData, { statusCode: 200, data: json(MOCK) }, log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B4 服务端违约返回 mock:true → **拒绝**（绝不把示例数据写进饮食记录）');
  eq(r.code, 'VISION_NOT_READY', 'B4b mock 结果归为「引擎不可用」而不是「重拍试试」');

  // B5 callContainer 模式：callContainer 对 5xx 也走 success 回调 —— 不看 statusCode 就会拿错误体当 taskId
  log = [];
  useCallContainer(() => ({ statusCode: 503, data: json(NOT_READY) }), log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B5 云托管 submit 503（走 success 回调）→ 失败');
  eq(r.code, 'VISION_NOT_READY', 'B5b code 透出');
  eq(log.length, 1, 'B5c 没把错误体当 taskId 去轮询（只发了 submit 这一次）');
  hasNot(r.user, 'LLM_API_KEY', 'B5d 云托管链路的用户文案同样不泄漏运维术语');

  // B6 callContainer 正常 submit，轮询到 status=error
  log = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };   // 轮询间隔归零，测试不用等 2s
  useCallContainer((p) => (p === '/task/submit'
    ? { statusCode: 200, data: json({ taskId: 't1', status: 'processing' }) }
    : { statusCode: 200, data: json({ status: 'error', code: 'VISION_NOT_READY', message: '未配 LLM_API_KEY' }) }), log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  global.setTimeout = realSetTimeout;
  eq(r.ok, false, 'B6 轮询到 status=error → 失败');
  eq(r.code, 'VISION_NOT_READY', 'B6b task error 的 code 透出');
  truthy(log.indexOf('/task/submit') === 0 && log.indexOf('/task/t1') === 1, 'B6c 确实走了 submit → poll 两次：' + log.join(' → '));
  hasNot(r.user, 'LLM_API_KEY', 'B6d 轮询失败的用户文案不泄漏运维术语');

  // B6e submit 成功但没给 taskId
  log = [];
  useCallContainer(() => ({ statusCode: 200, data: json({ status: 'ok' }) }), log);
  r = await catchIt(vision.analyzeImage('/tmp/a.jpg'));
  eq(r.ok, false, 'B6e submit 未返回 taskId → 失败（不静默挂着）');

  /* ── B8–B11 「很慢 / 经常识别不出来」的两条真缺陷（2026-09-29）──
     ① 任务在服务端丢了（实例重启/缩容/多实例）时，旧代码直接失败，用户被引导去重拍；
     ② 客户端 60s 轮询窗口 < 服务端 120s 上游超时 ⇒ 倒挂，客户端先放弃。 */
  const withFastTimers = async (fn) => {
    const rs = global.setTimeout;
    global.setTimeout = (f) => { f(); return 0; };
    try { return await fn(); } finally { global.setTimeout = rs; }
  };

  // B8 任务丢失 → 自动重提一次并成功（用户不必重拍，也不知道发生过）
  log = [];
  useCallContainer((p) => (p === '/task/submit'
    ? { statusCode: 200, data: json({ taskId: 't' + log.length, status: 'processing' }) }
    : (log.filter(x => x === '/task/submit').length < 2
      ? { statusCode: 200, data: json({ status: 'error', code: 'VISION_TASK_LOST', message: 'not found' }) }
      : { statusCode: 200, data: json({ status: 'done', name: '番茄炒蛋', total_calories: 210, mock: false }) })), log);
  r = await withFastTimers(() => catchIt(vision.analyzeImage('/tmp/a.jpg')));
  eq(r.ok, true, 'B8 任务丢失 → 自动重提一次后成功');
  eq(log.filter(x => x === '/task/submit').length, 2, 'B8b 恰好重提 1 次（不放大调用成本）');

  // B9 重提后仍丢 → 以 VISION_TASK_LOST 收场，且**不许**归因到照片
  log = [];
  useCallContainer((p) => (p === '/task/submit'
    ? { statusCode: 200, data: json({ taskId: 'tx', status: 'processing' }) }
    : { statusCode: 200, data: json({ status: 'error', code: 'VISION_TASK_LOST', message: 'not found' }) }), log);
  r = await withFastTimers(() => catchIt(vision.analyzeImage('/tmp/a.jpg')));
  eq(r.code, 'VISION_TASK_LOST', 'B9 重提后仍丢失 → code 保持 VISION_TASK_LOST');
  eq(log.filter(x => x === '/task/submit').length, 2, 'B9b 只重提 1 次就停手（不无限重试）');
  hasNot(r.user, '照片', 'B9c 任务丢失不许归因成「照片不清晰」（用户重拍一百次也没用）');

  // B10 提交阶段网络失败 → 重试 1 次后成功（云托管冷启动第一枪常直接超时）
  log = [];
  {
    let first = true;
    global.getApp = () => ({ globalData: CFG_CC.globalData });
    global.wx = {
      compressImage: (o) => o.success({ tempFilePath: '/tmp/c.jpg' }),
      getFileSystemManager: () => ({ readFile: (o) => o.success({ data: 'AAAA' }) }),
      cloud: {
        callContainer: (o) => {
          log.push(o.path);
          if (o.path === '/task/submit' && first) { first = false; o.fail({ errMsg: 'request:fail timeout' }); return; }
          if (o.path === '/task/submit') { o.success({ statusCode: 200, data: json({ taskId: 't9', status: 'processing' }) }); return; }
          o.success({ statusCode: 200, data: json({ status: 'done', name: 'x', total_calories: 1, mock: false }) });
        }
      }
    };
    r = await withFastTimers(() => catchIt(vision.analyzeImage('/tmp/a.jpg')));
  }
  eq(r.ok, true, 'B10 提交阶段网络失败 → 重试 1 次后成功');
  eq(log.filter(x => x === '/task/submit').length, 2, 'B10b 提交重试恰好 1 次');

  // B11 服务端一直 processing → 到窗口上限给 VISION_TIMEOUT（而不是笼统的失败）
  log = [];
  useCallContainer((p) => (p === '/task/submit'
    ? { statusCode: 200, data: json({ taskId: 'tz', status: 'processing' }) }
    : { statusCode: 200, data: json({ status: 'processing' }) }), log);
  r = await withFastTimers(() => catchIt(vision.analyzeImage('/tmp/a.jpg')));
  eq(r.code, 'VISION_TIMEOUT', 'B11 一直 processing → 到窗口上限报 VISION_TIMEOUT（带 code，不是笼统失败）');
  hasNot(r.user, 'LLM_API_KEY', 'B11b 超时文案不泄漏运维术语');

  // B12 上游 429（额度/限流）→ 必须与「照片不清」区分开
  log = [];
  useCallContainer((p) => (p === '/task/submit'
    ? { statusCode: 200, data: json({ taskId: 'tq', status: 'processing' }) }
    : { statusCode: 200, data: json({ status: 'error', code: 'VISION_QUOTA', message: 'upstream 429' }) }), log);
  r = await withFastTimers(() => catchIt(vision.analyzeImage('/tmp/a.jpg')));
  eq(r.code, 'VISION_QUOTA', 'B12 上游限流 → VISION_QUOTA 原样透出');
  hasNot(r.user, '照片', 'B12b 限流不许归因成照片问题');
  hasNot(r.user, '429', 'B12c 用户文案里不出现上游状态码');

  /* ── userMessage 本身 ── */
  const GENERIC = vision.userMessage({ code: '__NO_SUCH_CODE__' });
  truthy(GENERIC.length > 0, 'B7 未知 code 也有通用兜底文案');
  const tNR = vision.userMessage({ code: 'VISION_NOT_READY' });
  const tF = vision.userMessage({ code: 'VISION_FAILED' });
  truthy(tNR !== tF, 'B7b 「引擎不可用」与「这次没认出」话术必须不同（前者重拍无用）');
  has(tNR, '重试', 'B7c 引擎不可用 → 引导稍后重试');
  has(tF, '照片', 'B7d 这次没认出 → 引导换张照片');
  truthy(vision.userMessage({ errMsg: 'request:fail timeout' }).indexOf('超时') >= 0, 'B7e 超时有专门话术');
  const boom = vision.userMessage(new Error('原始错误 boom'));
  hasNot(boom, 'boom', 'B7f 未归因的错误不把原文甩给用户');
  eq(boom, GENERIC, 'B7g 未归因的错误走通用兜底');
  truthy(vision.userMessage(null).length > 0, 'B7h userMessage(null) 不炸');
  eq(vision.visionError('X', 'm').code, 'X', 'B7i visionError 保留 code');
  eq(vision.visionError(null, null).code, 'VISION_FAILED', 'B7j visionError 无 code 时兜底 VISION_FAILED');

  /* ═══════════ [C] 客户端静态：不再有 mock 渲染/入库分支 ═══════════ */
  console.log('[C] 客户端静态：mock 分支已清干净');
  const advJs = code('pages/advice/advice.js');
  const scanJs = code('pages/food-scan/food-scan.js');
  const advWxml = stripJs(read('pages/advice/advice.wxml'));
  const advWxss = stripJs(read('pages/advice/advice.wxss'));
  hasNot(advJs, 'mock', 'C1 advice.js 无 mock 字段/分支');
  hasNot(scanJs, 'mock', 'C2 food-scan.js 无 mock 字段/分支');
  hasNot(advWxml, 'mock-tip', 'C3 advice.wxml 移除「示例数据」提示条');
  hasNot(advWxss, '.mock-tip', 'C4 advice.wxss 同步移除 .mock-tip 样式（只删 wxml 会留死样式）');
  has(advJs, 'vision.userMessage(', 'C5 advice.js 的失败提示走唯一真源 userMessage()');
  has(scanJs, 'vision.userMessage(', 'C6 food-scan.js 的失败提示走唯一真源 userMessage()');
  // 两个页面都必须保留「识别失败也有出口」：不能因为删 mock 把失败态一起删掉
  has(advJs, "title: '识别失败'", 'C7 advice.js 保留失败弹窗');
  has(scanJs, 'showModal', 'C8 food-scan.js 保留失败弹窗（toast 装不下 20 字以上文案）');

  /* ═══════════ [D] 跨端对齐：服务端产出的每个 code 都要翻得出人话 ═══════════ */
  console.log('[D] 跨端 code 对齐');
  const llmSrc = pyCode('server/vision_llm.py');
  const serverSrc = analyzerPy + '\n' + appPy + '\n' + llmSrc;
  const codes = new Set();
  // 抽「源码里出现过的每个 VISION_* 字面量」，而不是只抽 `code = "X"` 那种写法。
  // 旧正则漏掉了以**映射表**返回的 code（vision_llm._code_for_http 是 `return "VISION_AUTH"`），
  // 于是那几个码**没有用户文案也能过** —— 正是「服务端说过的 code 必须都能翻成人话」的反例。
  // 宁可多抽：多抽只会要求补文案，不会漏。
  serverSrc.replace(/['"](VISION_[A-Z0-9_]+)['"]/g, (_, c) => { codes.add(c); return ''; });
  // 客户端自己也会造 code（本地校验失败等），一并纳入
  const clientSrc = code('utils/foodvision.js');
  clientSrc.replace(/['"](VISION_[A-Z0-9_]+)['"]/g, (_, c) => { codes.add(c); return ''; });
  // 尺子自检：抽不到 code 说明正则在空转，绿灯不算数
  truthy(codes.size >= 6, 'D0 从服务端/客户端抽到 ' + codes.size + ' 个 code（样本量正常）：' + [...codes].join(', '));
  const unmapped = [...codes].filter((c) => vision.userMessage({ code: c }) === GENERIC);
  eq(unmapped.length, 0, 'D1 每个 code 都有专属用户文案' + (unmapped.length ? ' → 未映射 ' + unmapped.join(', ') : ''));
  [...codes].forEach((c) => {
    const t = vision.userMessage({ code: c });
    hasNot(t, 'LLM_API_KEY', 'D2 ' + c + ' 的用户文案不含 LLM_API_KEY');
    hasNot(t, 'CALORIESCAN', 'D2 ' + c + ' 的用户文案不含 CALORIESCAN');
    hasNot(t, '环境变量', 'D2 ' + c + ' 的用户文案不含「环境变量」');
    hasNot(t, c, 'D2 ' + c + ' 的用户文案不暴露内部 code 字面量');
  });

  /* ═══════════ [E] 快慢与归因（2026-09-29 用户反馈「很慢 + 经常识别不出来」）═══════════ */
  console.log('[E] 超时窗口不许倒挂 + 上游错误必须分类 + 任务丢失要能自愈');

  // E1 客户端轮询窗口必须**大于**服务端单次上游超时。倒挂的后果：服务端还在算，
  // 客户端已经放弃并弹一句笼统的「识别超时」，用户永远看不到「到底为什么慢」的 code。
  // 判据抽成纯函数，才能喂倒挂样本验证尺子本身有效（E1c）。
  const srvTimeoutOf = (src) => Number((src.match(/REQ_TIMEOUT\s*=\s*(\d+)/) || [0, 0])[1]);
  const deadlineOf = (src) => Number((src.match(/POLL_DEADLINE_MS\s*=\s*(\d+)/) || [0, 0])[1]);
  const noInversion = (llmS, cliS) => {
    const s = srvTimeoutOf(llmS), c = deadlineOf(cliS);
    return s > 0 && c > 0 && c > s * 1000;
  };
  const srvTimeout = srvTimeoutOf(llmSrc);
  const cliWindow = deadlineOf(clientSrc);
  truthy(srvTimeout > 0 && cliWindow > 0,
    'E1 两侧超时参数都抽到了（抽不到说明改了写法，须同步这条守卫）：服务端 ' + srvTimeout + 's / 客户端 ' + cliWindow + 'ms');
  truthy(noInversion(llmSrc, clientSrc),
    'E1b 客户端窗口(' + cliWindow + 'ms) > 服务端上游超时(' + srvTimeout + 's) ⇒ 超时一定由服务端先报出并带 code');
  eq(noInversion('REQ_TIMEOUT = 50', 'const POLL_DEADLINE_MS = 20000;'), false,
    'E1c 尺子自检：倒挂样本（客户端 20s < 服务端 50s）被同一条判据判为不成立');
  eq(noInversion('REQ_TIMEOUT = 50', 'const POLL_DEADLINE_MS = 70000;'), true,
    'E1d 尺子自检：正常样本（70s > 50s）判为成立（判据不是恒 false）');

  // E2 上游错误必须分类，不能再一股脑 VISION_FAILED
  has(llmSrc, 'def _code_for_http', 'E2 上游状态码有专门映射函数');
  has(llmSrc, 'VISION_QUOTA', 'E2b 429 → 限流/额度自成一档（不能被说成「照片不清晰」）');
  has(llmSrc, 'VISION_AUTH', 'E2c 401/403 → 鉴权自成一档');
  has(llmSrc, 'VISION_MODEL', 'E2d 400 → 模型名/未开通自成一档');
  hasNot(llmSrc, 'raise_for_status', 'E2e 不再用 raise_for_status()（它把 401/429/400 抹成同一个笼统异常）');
  has(appPy, 'getattr(e, "code", None)', 'E2f app.py 尊重异常自带的 code，只在真没有时兜底 VISION_FAILED');
  has(appPy, 'VISION_TASK_LOST', 'E2g 任务找不到时给出专属 code（旧实现不带 code ⇒ 被兜底成「换张清晰照片」）');

  // E3 任务丢失要能自愈：客户端自动重提**一次**
  has(clientSrc, 'VISION_TASK_LOST', 'E3 客户端认识「任务丢失」这个 code');
  has(clientSrc, 'allowResubmit', 'E3b 任务丢失 → 自动重提一次（识别是只读的，重提不产生重复记录）');
  has(clientSrc, 'SUBMIT_RETRY_MS', 'E3c 提交阶段网络失败也要重试（云托管冷启动第一枪常直接超时）');

  // E4 「重试有没有用」必须逐个 code 表态。给用户一个注定失败的重试，比不给他更伤：
  // 他会连点几次、每次等满轮询窗口，最后判定「这功能就是坏的」。
  // ⚠️ 只验 isRetryable() 的返回值验不出漏登记（undefined 被 !! 收成 false，
  //    与「明确不可重试」返回值完全一样）⇒ 必须拿到真表反查。
  truthy(vision.RETRYABLE && typeof vision.RETRYABLE === 'object',
    'E4 导出 RETRYABLE 对照表（「重试有没有用」的唯一真源）');
  const stated = (c) => Object.prototype.hasOwnProperty.call(vision.RETRYABLE, c);
  const unStated = [...codes].filter((c) => !stated(c));
  eq(unStated.length, 0, 'E4b 每个 code 都表过态' + (unStated.length ? ' → 漏登记 ' + unStated.join(', ') : ''));
  // 尺子自检：喂一个肯定没登记的 code，同一条判据必须判红（否则这条断言恒绿）
  eq(['__NO_SUCH_CODE__'].filter((c) => !stated(c)).length, 1, 'E4c 尺子自检：未登记的 code 会被判为漏登记');
  const yes = [...codes].filter((c) => vision.RETRYABLE[c] === true);
  const no = [...codes].filter((c) => vision.RETRYABLE[c] === false);
  truthy(yes.length > 0 && no.length > 0,
    'E4d 「可重试」与「不可重试」两类都存在（全 true/全 false 等于没分档）：可 ' + yes.join(',') + ' / 不可 ' + no.join(','));
  const quirks = (() => {
    try { return vision.isRetryable(null) === false && vision.isRetryable({}) === false; } catch (e) { return false; }
  })();
  truthy(quirks, 'E4e isRetryable 的边界：null / 无 code 一律判 false，且不抛异常');

  /* ═══════════ [F] 页面接线：等待要有推进感、要有出口、重试只在有用时出现 ═══════════ */
  console.log('[F] food-scan：识别中必须能看出「在动」且能退出');
  const scanWxml = stripWxml(read('pages/food-scan/food-scan.wxml'));
  const scanWxss = stripJs(read('pages/food-scan/food-scan.wxss'));
  has(scanWxml, '{{anTip}}', 'F1 识别中展示**阶段文案**（整段只有一句静态文案时，20s 的等待就像卡死）');
  has(scanWxml, '{{anSec}}', 'F2 识别中展示已用秒数（「它确实在推进」的证据）');
  has(scanWxml, 'bindtap="cancelAnalyze"', 'F3 识别中留了**出口**（最长 70s 的等待不能没有返回路径）');
  has(scanJs, 'cancelAnalyze()', 'F3b cancelAnalyze 已实现（wxml 里的事件名必须有对应处理器，否则点了静默无反应）');
  has(scanJs, '_startAnTimer(', 'F4 秒数计时器已启动');
  has(scanJs, '_stopAnTimer(', 'F5 计时器有停：成功/失败/取消/卸载都要停');
  has(scanJs, 'onUnload() { this._stopAnTimer(); }', 'F5b onUnload 停表（setInterval 不会随页面卸载自动消失）');
  has(scanJs, 'vision.isRetryable(', 'F6 失败弹窗按 isRetryable() 决定要不要给「重试」按钮');
  has(scanJs, 'this._lastImg', 'F7 重试用同一张图（失败就逼人重拍，等于把我们的问题转嫁给他）');
  has(scanJs, 'id !== this._anId', 'F8 取消后作废在途回调（否则迟到的响应会把结果页又拽回来）');
  has(scanWxss, '.an-cancel', 'F9 .an-cancel 有样式（wxml 引了 class 却没样式 = 一行裸文字，看不出能不能点）');
  has(scanWxss, '.an-sec', 'F10 .an-sec 有样式');
  // 尺子自检：剥注释这条得真有效，否则 F1/F2 会被注释里的字面量顶替成假绿
  eq(stripWxml('<!-- {{anTip}} --><view/>').indexOf('{{anTip}}'), -1,
    'F11 尺子自检：stripWxml 确实剥掉了注释里的字段名');

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();

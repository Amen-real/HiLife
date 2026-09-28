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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 剥注释后的源（静态断言必须用这个，否则注释里的说明文字会顶替真实代码通过检查）
const code = (rel) => stripJs(read(rel));

/* ═══════════ [A] 服务端静态 ═══════════ */
console.log('[A] 服务端：mock 路径已移除，失败改为显式报错');
const analyzerPy = code('server/analyzer.py');
const appPy = code('server/app.py');

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
const llmPy = code('server/vision_llm.py');
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
  const serverSrc = analyzerPy + '\n' + appPy + '\n' + code('server/vision_llm.py');
  const codes = new Set();
  serverSrc.replace(/code\s*[:=]\s*['"]([A-Z][A-Z0-9_]*)['"]/g, (_, c) => { codes.add(c); return ''; });
  // 客户端自己也会造 code（本地校验失败等），一并纳入
  const clientSrc = code('utils/foodvision.js');
  clientSrc.replace(/visionError\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g, (_, c) => { codes.add(c); return ''; });
  // 尺子自检：抽不到 code 说明正则在空转，绿灯不算数
  truthy(codes.size >= 2, 'D0 从服务端/客户端抽到 ' + codes.size + ' 个 code（样本量正常）：' + [...codes].join(', '));
  const unmapped = [...codes].filter((c) => vision.userMessage({ code: c }) === GENERIC);
  eq(unmapped.length, 0, 'D1 每个 code 都有专属用户文案' + (unmapped.length ? ' → 未映射 ' + unmapped.join(', ') : ''));
  [...codes].forEach((c) => {
    const t = vision.userMessage({ code: c });
    hasNot(t, 'LLM_API_KEY', 'D2 ' + c + ' 的用户文案不含 LLM_API_KEY');
    hasNot(t, 'CALORIESCAN', 'D2 ' + c + ' 的用户文案不含 CALORIESCAN');
    hasNot(t, '环境变量', 'D2 ' + c + ' 的用户文案不含「环境变量」');
    hasNot(t, c, 'D2 ' + c + ' 的用户文案不暴露内部 code 字面量');
  });

  console.log('\npass=' + pass + '  fail=' + fail);
  process.exit(fail ? 1 : 0);
})();

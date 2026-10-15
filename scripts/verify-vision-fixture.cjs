#!/usr/bin/env node
/**
 * verify-vision-fixture.cjs —— server/fixture.py（固定夹具引擎）回归守卫
 *
 * 背景：server/fixture.py 引入了一条「不调大模型也能跑通识别整条回路」的路径
 * （VISION_MODE=fixture）。它最大的风险不是「不好用」，而是**两条红线被它悄悄破坏**：
 *   ① 「禁 mock 兜底」—— 静默返回假热量会让用户把示例数据当成自己那餐记录（2026-09-28 移除 mock 的原因）；
 *   ② 客户端的「最后一道防线」—— foodvision.js 统一出口凡是 mock:true 一律拒绝
 *      （verify-vision-result B4/B4b）。fixture 若自称 mock 会被这道防线拦下，白做；
 *      若靠「不说自己是假数据」蒙混过关，则是骗用户。
 *
 * 所以本守卫的重点不是「fixture 能不能用」，而是**它有没有站到不该站的位置**。
 *
 * 覆盖：
 *   [A] 静态：fixture 只出现在「真实引擎之前」，绝不出现在兜底/except 分支
 *   [B] 行为：真实 python 跑 fixture_enabled / analyze，验证默认关闭 + 合约同构
 *   [C] 静态：mock 字段恒 False + 独立 fixture 标记 + note 明示来源
 *   [D] 接线：/health 如实上报 fixture 态（不能只有翻日志才知道）
 *   [E] 静态：开关名不与真实配置名重叠（避免误配）
 *
 * 用法：node scripts/verify-vision-fixture.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => (v ? ok(label) : bad(label));
const has = (label, s, sub) => (String(s).indexOf(sub) >= 0) ? ok(label)
  : bad(label + '  \u2209 ' + JSON.stringify(sub));
const hasNot = (label, s, sub) => (String(s).indexOf(sub) < 0) ? ok(label)
  : bad(label + '  \u4e0d\u5e94\u5305\u542b ' + JSON.stringify(sub));

// 静态扫必须先剥注释（守卫通则④）——否则会命中「禁 X」这类说明文字，自己把尺子照瞎
const stripPy = (s) => s.replace(/"""[\s\S]*?"""/g, ' ').replace(/^\s*#.*$/gm, ' ');

const fxPy = read('server/fixture.py');
const appPy = read('server/app.py');
const fxCode = stripPy(fxPy);
const appCode = stripPy(appPy);

// 解析可用的 python：优先环境变量 PYTHON，其次本仓托管运行时（'python' 在本机 EBUSY）
function resolvePython() {
  const candidates = [
    process.env.PYTHON,
    'C:/Users/Admin/.workbuddy/binaries/python/versions/3.13.12/python.exe',
    'python'
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['-c', 'pass'], { stdio: 'ignore' });
      return c;
    } catch (e) { /* 试下一个 */ }
  }
  return 'python';
}
// 探针产物落 scripts/_out/（该目录在 packOptions.ignore 的 scripts/ 内 ⇒ 不进主包）
const OUT_DIR = path.join(ROOT, 'scripts', '_out');
const OUT_FILE = path.join(OUT_DIR, 'verify-vision-fixture.probe.json');

/**
 * 跑一段 python 探针并拿回 JSON 结果。
 *
 * ⚠️⚠️ 三个踩过的坑（这一整轮都卡在这里才逐个定位）：
 *   ① **管道会 EBUSY**：本机 sandbox 下 node 通过管道 spawn python 失败，
 *      而 `stdio:'ignore'`（不建管道）正常 —— 问题不在代码，在管道。
 *      ⇒ python 把结果**写成文件**，node 再读文件。
 *   ② **`sys.path[0]` 对 `python -c` 是空串**（不是 cwd）
 *      ⇒ 即使 `cwd: server`，`import fixture` 也会 ModuleNotFoundError
 *      ⇒ 每段探针都自带 `sys.path.insert(0, <server 绝对路径>)`。
 *   ③ **别把多行 dict 塞进 `(lambda: ( ... ))()`**：语法脆（`({...})()` 有歧义），
 *      实测直接 SyntaxError。⇒ 传「语句」而非「表达式」，赋值给 `_res` 再写文件。
 *
 * @param {string} body python 语句体，末尾须给变量 `_res` 赋一个可 JSON 化的值
 * @param {object} extraEnv 额外环境变量（如 VISION_MODE）
 */
function runPy(body, extraEnv) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try { fs.unlinkSync(OUT_FILE); } catch (e) { /* 不存在即可 */ }
  const outPathWin = OUT_FILE.replace(/\\/g, '/');
  const serverPathWin = path.join(ROOT, 'server').replace(/\\/g, '/');
  const code = [
    'import sys, json',
    'sys.path.insert(0, r"' + serverPathWin + '")',
    'import fixture',
    body,
    'with open(r"' + outPathWin + '", "w", encoding="utf-8") as f:',
    '    f.write(json.dumps(_res, ensure_ascii=False, default=str))'
  ].join('\n');
  execFileSync(PY, ['-c', code], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'ignore',                        // 见上方 ⚠️ 管道会 EBUSY
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, extraEnv || {})
  });
  return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
}
const PY = resolvePython();

/* ══════════════ [A] fixture 绝不在兜底分支 ══════════════ */
console.log('\n[A] 静态：fixture 只能排在真实引擎之前');
{
  // 取出 _run_task 与 /analyze 两个函数体做逐行检查
  const grab = (src, name) => {
    const i = src.indexOf('def ' + name + '(');
    if (i < 0) return '';
    // 以下一个顶层 def / @app 为界。⚠️ 必须含 '\n@app.'：async def 不匹配 '\ndef '，
    // 2026-10-15 起任务限额代码落在 /task/submit（async def）里且引用 fixture，
    // 不按装饰器截断会把它的函数体误并进 /analyze（A11 误报）。
    let j = src.indexOf('\ndef ', i + 1);
    const k = src.indexOf('\n@app.', i + 1);
    if (k >= 0 && (j < 0 || k < j)) j = k;
    if (j < 0) j = src.length;
    return src.slice(i, j);
  };
  const runTask = grab(appCode, '_run_task');
  const analyzeFn = grab(appCode, 'analyze');

  isTrue('A0 _run_task 已找到', runTask.length > 0);
  isTrue('A0b /analyze 已找到', analyzeFn.length > 0);

  // 关键：fixture 的判定行必须排在 LLM / analyzer 之前
  const iFx = runTask.indexOf('fixture.fixture_enabled()');
  const iLlm = runTask.indexOf('vision_llm.llm_ready()');
  const iAna = runTask.indexOf('analyzer.analyze(');
  isTrue('A1 _run_task 里确有 fixture 分支', iFx >= 0);
  isTrue('A2 _run_task 里确有 LLM 分支', iLlm >= 0);
  isTrue('A3 _run_task 里确有真实模型分支', iAna >= 0);
  isTrue('A4 fixture 判定排在 LLM 之前（显式开关优先）', iFx >= 0 && iFx < iLlm);
  isTrue('A5 fixture 判定排在真实模型之前', iFx >= 0 && iFx < iAna);

  // ★ 最关键的一条：fixture 绝不能出现在 except / else / fallback 分支里
  const runBody = runTask.slice(0);
  const exceptIdx = runBody.indexOf('except');
  isTrue('A6 _run_task 存在 except 分支（下面据此验证位置）', exceptIdx >= 0);
  isTrue('A7 except 分支内【无】fixture 调用（铁律 1：fixture 不兜底）',
    runBody.slice(exceptIdx).indexOf('fixture.') < 0);
  isTrue('A8 except 分支内【无】fixture_result（连结果构造都不许在兜底位）',
    runBody.slice(exceptIdx).indexOf('fixture_result') < 0);
  // else 分支（真实模型兜底位）同样不许有 fixture
  const elseIdx = runBody.indexOf('else:');
  isTrue('A9 else 兜底分支内【无】fixture 调用',
    elseIdx < 0 || runBody.slice(elseIdx, runBody.indexOf('except') > 0 ? runBody.indexOf('except') : undefined).indexOf('fixture.') < 0);

  // /analyze 同步检查
  const aFx = analyzeFn.indexOf('fixture.fixture_enabled()');
  const aAna = analyzeFn.indexOf('analyzer.analyze(');
  const aExc = analyzeFn.indexOf('except');
  isTrue('A10 /analyze 中 fixture 判定早于真实模型', aFx >= 0 && aFx < aAna);
  isTrue('A11 /analyze 的 except 分支内【无】fixture', aExc < 0 || analyzeFn.slice(aExc).indexOf('fixture.') < 0);

  // 全局反查：app.py 里 fixture 只应出现在这三类位置
  const fxLines = appCode.split('\n').filter(l => /fixture\./.test(l) && !/^\s*#/.test(l));
  isTrue('A12 app.py 中 fixture 调用点数量可控（<=7：health/fx + 4 处判定与调用，'
    + '2026-10-15 新增 /task/submit 限额豁免判定）',
    fxLines.length > 0 && fxLines.length <= 7);
}

/* ══════════════ [B] 行为：真跑 python ══════════════ */
console.log('\n[B] 行为：默认关闭 + 合约同构');
{
  let out = null;
  try {
    out = runPy(`_r = fixture.analyze(b"x", "a.jpg")
_res = {
  "enabled_default": fixture.fixture_enabled(),
  "describe_default": fixture.describe(),
  "result": _r,
  "keys": sorted(_r.keys()),
  "analyzer_keys": sorted(["success","name","items","total_weight_g","total_calories","confidence","mock","note"]),
  "agg_weight": sum(i["weight_g"] for i in _r["items"]),
  "agg_calories": sum(i["calories"] for i in _r["items"]),
  "items_fresh": _r["items"] is not fixture.analyze(b"x", "a.jpg")["items"],
}`);
  } catch (e) {
    // 异常必须可见：静默置 null 会把「脚本写错了」伪装成「环境不支持」（第一版就栽在这）
    bad('B0 python 探针执行失败：' + String(e.message || e).slice(0, 240));
  }

  if (out) {
    eq('B1 默认（未设 VISION_MODE）→ fixture 未启用', out.enabled_default, false);
    eq('B2 describe() 默认 fixture=false', out.describe_default.fixture, false);
    eq('B3 describe() 默认 mode=default', out.describe_default.mode, 'default');
    // 合约同构：必须含 analyzer 的全部字段且不多不少
    const ak = out.analyzer_keys;
    eq('B4 结果含 analyzer 合约的全部字段',
      ak.filter(k => out.keys.indexOf(k) < 0), []);
    eq('B5 只额外多出 fixture 标记（不多不少）',
      out.keys.filter(k => ak.indexOf(k) < 0), ['fixture']);
    eq('B6 mock 恒为 False（铁律 3：不自称 mock，否则被客户端防线拦下）', out.result.mock, false);
    eq('B7 fixture 标记为 True', out.result.fixture, true);
    isTrue('B8 success=True（夹具的用途是让回路跑通，不是模拟失败）', out.result.success === true);
    isTrue('B9 note 明示来源（不能让人误以为在测真实链路）',
      /fixture|夹具|示例/.test(String(out.result.note)));
    isTrue('B10 items 非空且字段完整', Array.isArray(out.result.items) && out.result.items.length > 0
      && out.keys.indexOf('x') < 0 && out.result.items.every(i =>
        i.name && typeof i.weight_g === 'number' && typeof i.calories === 'number'));
    // 总量必须自洽（total 与 items 聚合一致）——否则夹具自己就会喂给下游一个矛盾的数字
    // 总量自洽：total 必须等于 items 聚合（夹具自己喂矛盾数字是最坏的情况）
    eq('B11 total_weight_g 与 items 聚合自洽', out.result.total_weight_g, out.agg_weight);
    eq('B12 total_calories 与 items 聚合自洽', out.result.total_calories, out.agg_calories);
    // 每次调用必须是新对象（防调用方改动污染后续请求）
    isTrue('B13 analyze 每次返回独立对象（items 非同一引用）', out.items_fresh, true);
  }

  // 开关打开时必须启用；且**拼错必须视为未启用**
  const probe = (envVal) => {
    try {
      return runPy('_res = {"e": fixture.fixture_enabled(), "d": fixture.describe()}', { VISION_MODE: envVal });
    } catch (e) {
      // ⚠️ 静默 return null 会把「脚本写错了」伪装成「环境不支持」—— 必须留痕迹
      if (process.env.FX_DEBUG) {
        console.log('    [debug] VISION_MODE=' + JSON.stringify(envVal)
          + ' err=' + String(e.message || e).slice(0, 160));
      }
      return null;
    }
  };
  eq('C1 VISION_MODE=fixture → 启用', (probe('fixture') || {}).e, true);
  eq('C2 VISION_MODE=Fixture（大写）→ 不启用（精确匹配）', (probe('Fixture') || {}).e, false);
  // ⚠️ 这里断言的是**刻意设计**：实现用 .strip()，所以尾随空格仍会启用。
  //   为什么不改成「严格拒绝」：配置项多打一个空格就静默不生效 ⇒ 用户会以为夹具没开、
  //   然后去查别的地方，排查成本远高于「容忍一个空格」。大小写仍必须严格（下面两条）。
  eq('C3 VISION_MODE="fixture "（尾随空格）→ 仍启用（.strip 容错，刻意设计）',
    (probe('fixture ') || {}).e, true);
  eq('C3b VISION_MODE=" fixture"（前导空格）→ 仍启用', (probe(' fixture') || {}).e, true);
  eq('C4 VISION_MODE="" → 不启用', (probe('') || {}).e, false);
  eq('C5 启用时 describe.warning 非空（/health 要能一眼看出是假数据）',
    ((probe('fixture') || {}).d || {}).warning !== undefined
    && String(((probe('fixture') || {}).d || {}).warning).length > 0, true);
}

/* ══════════════ [C] 静态：mock 与标记 ══════════════ */
console.log('\n[C] 静态：mock 字段恒 False + 独立标记');
{
  // fixture.py 里出现的 "mock" 必须只在赋值处，且值是 False
  const mockAssign = fxCode.match(/"mock"\s*:\s*(\w+)/g) || [];
  isTrue('C0 fixture.py 里 mock 字段有且只有一处赋值', mockAssign.length === 1);
  isTrue('C1 该处值为 False', /"mock"\s*:\s*False/.test(fxCode));
  hasNot('C2 fixture.py 不得出现 mock_result / is_mock（旧 mock 路径的名字）', fxCode, 'mock_result');
  hasNot('C3 fixture.py 不得出现 mock=True', fxCode, 'mock=True');
  has('C4 有独立 fixture 标记', fxCode, '"fixture": True');
  has('C5 note 里明示来源', fxCode, 'note');
  // 与 analyzer 的一致性：analyzer 也恒False
  const anaCode = stripPy(read('server/analyzer.py'));
  isTrue('C6 analyzer.py 的 mock 字段同样恒 False（两边口径一致）', /"mock"\s*:\s*False/.test(anaCode));
}

/* ══════════════ [D] 接线：/health 如实上报 ══════════════ */
console.log('\n[D] /health 必须能看出是否在跑夹具');
{
  has('D1 app.py 引用 fixture.describe()', appCode, 'fixture.describe()');
  has('D2 /health 里 fixture 开启时带上 fixture:True', appCode, '"fixture": True');
  has('D3 /health 里正常路径带 fixture:False', appCode, '"fixture": False');
  has('D4 /health 把 warning 透出', appCode, 'fx["warning"]');
  // 反向自检：必须能在 app.py 里找到这两处，否则D2/D3 只是我记忆里的符号
  isTrue('D5 反向自检：app.py 确实含 describe 调用（F4 不是空转）',
    (appCode.match(/fixture\.describe\(\)/g) || []).length >= 1);
}

/* ══════════════ [E] 开关名不与真实配置重叠 ══════════════ */
console.log('\n[E] 开关名安全性');
{
  isTrue('E1 fixture.py 用独立常量 MODE_ENV 而不是散字面量', /MODE_ENV\s*=\s*"VISION_MODE"/.test(fxCode));
  // 与真实配置名不得重叠：LLM_API_KEY / LLM_MODEL / LLM_BASE_URL / CALORIESCAN_* / MODELS_DIR
  const realEnvs = ['LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL', 'CALORIESCAN_REAL', 'CALORIESCAN_REPO', 'MODELS_DIR'];
  realEnvs.forEach(k => hasNot('E2 VISION_MODE 不与真实配置名 ' + k + ' 冲突',
    fxCode.slice(fxCode.indexOf('MODE_ENV')), k));
  // 不得覆盖真实配置的读取（fixture 不许改别人的环境变量语义）
  hasNot('E3 fixture.py 不得写 os.environ[', fxCode, 'os.environ[');
  hasNot('E4 fixture.py 不得 setenv（不许篡改环境给上游）', fxCode, 'setenv');
  // 不得引入网络/文件依赖
  hasNot('E5 fixture.py 不引入 requests（夹具不该有网络）', fxCode, 'import requests');
  hasNot('E6 fixture.py 不读写文件', fxCode, 'open(');
}

// 清理探针产物（临时文件用完即删 —— 项目约定；_out/ 本就在打包忽略内，
// 但留着会让「产物落 _out/」这条约定看起来像没有约束）
try { fs.unlinkSync(OUT_FILE); } catch (e) { /* 已不存在 */ }

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);
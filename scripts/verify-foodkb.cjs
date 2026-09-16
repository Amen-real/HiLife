/**
 * verify-foodkb.cjs —— A3（识别结果纠错 + 本地知识库）守卫
 *
 * 守的是这个功能**唯一值钱的两个承诺**，两者都不容易用眼睛看出来：
 *   ① 「一次纠正之后永久正确」—— 纠正必须真的被记住，且下次必须真的套用得上；
 *   ② 「降低按次计费的模型调用量」—— 手输命中知识库时**一次模型调用都没发生**。
 * 承诺② 一旦被写成「识别后套用修正值也算省了一次调用」，看板就会把准确率谎报成
 * 成本节省 —— 那是这个功能对外的核心数字，必须由守卫钉死，不能靠自觉。
 *
 * 四段：
 *   [A] foodkb 行为不变量（stub 掉 wx，跑真实模块）
 *   [B] metrics 口径（事件表一致、分母为 0 返回 null、KB_HIT 的语义）
 *   [C] 调用点静态断言（裸事件名 / 埋点位次 / 幽灵字段回归 / 第二份实现回归）
 *   [D] 判据校准（把 [C] 的判据喂给「已知违规 + 已知良样本」的夹具，确认真的会红 / 绿）
 *
 * 为什么要 [D]：本项目吃过「守卫长期绿灯但根本没在看」的亏（verify-exercises-compact
 * 曾拿 git HEAD 的自己当基准，恒真）。判据必须能被夹具证明它会红，否则绿灯不算数。
 *
 * 退出码：0 = 通过；1 = 存在缺口
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

/* ---------------- wx stub（必须先于模块 require） ---------------- */

const MEM = {};
global.wx = {
  getStorageSync(k) { return MEM[k] === undefined ? '' : JSON.parse(JSON.stringify(MEM[k])); },
  setStorageSync(k, v) { MEM[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync(k) { delete MEM[k]; }
};

const foodkb = require(path.join(ROOT, 'utils', 'foodkb.js'));
const metrics = require(path.join(ROOT, 'utils', 'metrics.js'));

/* ---------------- 文件遍历 ---------------- */

function walk(dir, ext, out) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (['node_modules', '.git', '.workbuddy'].indexOf(n) >= 0) continue;
      walk(p, ext, out);
    } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const JS_FILES = walk(path.join(ROOT, 'pages'), '.js', [])
  .concat(walk(path.join(ROOT, 'components'), '.js', []));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/* =====================================================================
   [A] foodkb 行为不变量
   ===================================================================== */

console.log('[A] foodkb 行为不变量');

foodkb.reset();

// A1 签名与 item 顺序无关（模型返回顺序不稳定，不排序就永远命不中）
const mealA = { name: '午餐', items: [{ name: '米饭' }, { name: '鸡胸肉' }] };
const mealB = { name: '午餐', items: [{ name: '鸡胸肉' }, { name: '米饭' }] };
if (foodkb.signatureOf(mealA) === foodkb.signatureOf(mealB)) {
  ok('整餐签名与 item 顺序无关（' + foodkb.signatureOf(mealA) + '）');
} else {
  bad('签名对顺序敏感：' + foodkb.signatureOf(mealA) + ' ≠ ' + foodkb.signatureOf(mealB));
}

// A2 归一化：份量/标点/全半角写法差异必须收敛到同一条
const learned1 = foodkb.learn(mealA, { calories: 320, protein: 30, carb: 40, fat: 8, weight: 300 }, '鸡胸肉米饭');
if (learned1 && foodkb.lookup(mealB, false)) {
  ok('顺序打乱后仍能命中同一条（learn 一次、lookup 命中）');
} else {
  bad('顺序打乱后命中失败 —— 知识库会变成只增不减的垃圾堆');
}

const normCases = ['鸡胸肉 100g', ' 鸡胸肉，', '鸡胸肉100克', '鸡胸肉+'];
const normOk = normCases.every((c) => foodkb.normName(c) === '鸡胸肉');
if (normOk) {
  ok('归一化收敛：' + normCases.join(' / ') + ' → 鸡胸肉');
} else {
  bad('归一化未收敛：' + JSON.stringify(normCases.map((c) => foodkb.normName(c))));
}

// A3 【最关键】单品名**不得**命中多品餐条目 —— 否则「燕麦」会拿到「燕麦+鸡蛋」整餐的值
if (foodkb.lookup({ name: '米饭' }, false) === null) {
  ok('单品名不命中多品餐条目（不会把整餐 320kcal 填给单品「米饭」）');
} else {
  bad('单品名命中了多品餐条目 —— 会给用户一个看起来有来源的假值');
}

// A4 但用户单独学过单品后，该单品必须能命中（否则手输路径永远省不下调用）
foodkb.learn({ name: '米饭' }, { calories: 116, protein: 2, carb: 26, fat: 0, weight: null }, '米饭');
const rice = foodkb.lookup({ name: '米饭' }, false);
if (rice && rice.calories === 116) {
  ok('单独学过的单品可命中，且拿到的是单品值（116kcal，而非整餐 320）');
} else {
  bad('单品条目命中异常：' + JSON.stringify(rice));
}

// A5 「+」是结构性分隔符：归一化会把输入里的 + 剥掉 ⇒ 单品名永远含不了 +
if (foodkb.normName('米饭+鸡胸肉').indexOf('+') < 0) {
  ok('normName 剥掉 +（单品名结构上不可能等于多品餐键）');
} else {
  bad('normName 保留了 + —— 单品名可能撞上多品餐键，A3 的安全前提失效');
}

// A6 null 与 0 必须可区分（0 有值，null 是未知）
foodkb.reset();
foodkb.learn({ name: '零卡饮料' }, { calories: 0, protein: null, carb: null, fat: null, weight: null }, '零卡饮料');
const zero = foodkb.lookup({ name: '零卡饮料' }, false);
if (zero && zero.calories === 0 && zero.protein === null) {
  ok('0 与 null 可区分（calories=0 保留为 0，protein=null 仍是 null）');
} else {
  bad('0/null 被混淆：' + JSON.stringify(zero));
}

// A7 空签名不得落键（别把空结果写成一格垃圾）
foodkb.reset();
const emptyLearn = foodkb.learn({ name: '   ' }, { calories: 100 }, '空');
if (emptyLearn === null && foodkb.size() === 0) {
  ok('空签名不落键（size 仍为 0）');
} else {
  bad('空签名写入了知识库：' + JSON.stringify({ emptyLearn, size: foodkb.size() }));
}

// A8 hits / lastUsedAt 只在 bump=true 时变化（读路径不该产生写入）
foodkb.reset();
foodkb.learn({ name: '燕麦' }, { calories: 150, protein: 5, carb: 27, fat: 3, weight: null }, '燕麦');
const before = foodkb.lookup({ name: '燕麦' }, false);
foodkb.lookup({ name: '燕麦' }, false);
const afterRead = foodkb.lookup({ name: '燕麦' }, false);
const afterBump = foodkb.lookup({ name: '燕麦' }, true);
if (before.hits === 0 && afterRead.hits === 0 && afterBump.hits === 1 && afterBump.lastUsedAt > 0) {
  ok('hits 只在 bump 时 +1（读路径不写库）');
} else {
  bad('hits 语义异常：' + JSON.stringify({ before: before.hits, afterRead: afterRead.hits, afterBump: afterBump.hits }));
}

// A9 淘汰方向：满了丢「最久没用过」的，保留最新的
foodkb.reset();
const N = foodkb.MAX_ITEMS + 1;
for (let i = 0; i < N; i++) foodkb.learn({ name: 'food' + i }, { calories: i }, 'food' + i);
const keptNewest = !!foodkb.lookup({ name: 'food' + (N - 1) }, false);
const droppedOldest = foodkb.lookup({ name: 'food0' }, false) === null;
if (foodkb.size() === foodkb.MAX_ITEMS && keptNewest && droppedOldest) {
  ok('超过 MAX_ITEMS(' + foodkb.MAX_ITEMS + ') 时淘汰最旧的，保留最新的');
} else {
  bad('淘汰方向异常：size=' + foodkb.size() + ' keptNewest=' + keptNewest + ' droppedOldest=' + droppedOldest);
}

/* =====================================================================
   [B] metrics 口径
   ===================================================================== */

console.log('\n[B] metrics 口径');

// B1 EVENTS 与 LABELS 键集必须完全一致（少一个中文名 = 界面上显示不出来）
const evVals = Object.keys(metrics.EVENTS).map((k) => metrics.EVENTS[k]).sort();
const labKeys = Object.keys(metrics.LABELS).sort();
const evLabelMatch = evVals.length === labKeys.length && evVals.every((v, i) => v === labKeys[i]);
if (evLabelMatch) {
  ok('EVENTS 与 LABELS 键集一致（' + evVals.length + ' 个事件）');
} else {
  bad('EVENTS/LABELS 不一致：EVENTS=' + evVals.join(',') + ' LABELS=' + labKeys.join(','));
}

// B2 独立 storage key —— 不得混进 uu_fitness_state
if (metrics.KEY !== 'uu_fitness_state' && foodkb.KEY !== 'uu_fitness_state' && metrics.KEY !== foodkb.KEY) {
  ok('埋点与知识库各有独立键（' + metrics.KEY + ' / ' + foodkb.KEY + '），未混入用户数据键');
} else {
  bad('storage key 冲突：metrics=' + metrics.KEY + ' foodkb=' + foodkb.KEY);
}

// B3 分母为 0 时派生指标必须是 null，不能是 0/NaN
metrics.reset();
const emptyRange = metrics.today();
if (emptyRange.visionSuccessRate === null && emptyRange.visionAvgSec === null &&
    emptyRange.kbHitRate === null && emptyRange.visionReuseRate === null) {
  ok('无数据时派生指标返回 null（不冒充 0%）');
} else {
  bad('无数据时派生指标不是 null：' + JSON.stringify({
    s: emptyRange.visionSuccessRate, ms: emptyRange.visionAvgSec,
    kb: emptyRange.kbHitRate, reuse: emptyRange.visionReuseRate
  }));
}

// B4 【核心语义】识别后套用修正值 → 记 VISION_REUSED，**不得**记 KB_HIT
metrics.reset();
metrics.inc(metrics.EVENTS.VISION_START);
metrics.inc(metrics.EVENTS.VISION_OK);
metrics.inc(metrics.EVENTS.VISION_REUSED);
const reuseRange = metrics.today();
if (reuseRange.ev[metrics.EVENTS.KB_HIT] === 0 && reuseRange.ev[metrics.EVENTS.VISION_REUSED] === 1) {
  ok('识别后复用只记 VISION_REUSED、不记 KB_HIT（模型已跑完，没省下调用）');
} else {
  bad('复用路径污染了 KB_HIT：kb=' + reuseRange.ev[metrics.EVENTS.KB_HIT] +
      ' reused=' + reuseRange.ev[metrics.EVENTS.VISION_REUSED]);
}

// B5 手输命中 → 记 KB_HIT，并且它确实是「省下一次调用」（和 VISION_START 同轴求和）
metrics.inc(metrics.EVENTS.KB_HIT);
const manualRange = metrics.today();
const base = manualRange.ev[metrics.EVENTS.KB_HIT] + manualRange.ev[metrics.EVENTS.VISION_START];
if (manualRange.ev[metrics.EVENTS.KB_HIT] === 1 && base === 2 && manualRange.kbHitRate === 50) {
  ok('手输命中记 KB_HIT，命中率 1/(1+1)=50%（成本指标口径正确）');
} else {
  bad('KB_HIT 口径异常：' + JSON.stringify({ kb: manualRange.ev[metrics.EVENTS.KB_HIT], base, rate: manualRange.kbHitRate }));
}

// B6 按自然日分桶（不是平铺数组）
const rawDays = metrics.raw().days || {};
if (Object.keys(rawDays).length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(Object.keys(rawDays)[0])) {
  ok('存储按自然日分桶（' + Object.keys(rawDays)[0] + '）');
} else {
  bad('分桶结构异常：' + JSON.stringify(Object.keys(rawDays)));
}

/* =====================================================================
   [C] 调用点静态断言 —— 判据写成「源码文本 → 违规清单」的纯函数，便于 [D] 夹具校准
   ===================================================================== */

/**
 * 静态检查一律在**去注释**后的源码上做。
 * 理由：注释里描述反模式（「这里曾经写成 XXX」）不该判违规；被注释掉的死代码
 * 也不在执行路径上。逐字扫原文只会产生假警报 —— 而假警报会让人开始无视门禁，
 * 那比漏报更糟。（本仓的 verify-event-binding.cjs 是逐字扫的，
 * 结果一条描述反模式的注释就能把门禁打红，本人已被绊过一次。）
 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// C 判据 1：metrics.inc 的实参必须是 EVENTS 表里的成员，禁写裸字符串
function bareEventArgs(src) {
  const out = [];
  const re = /metrics\.inc\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(stripComments(src)))) {
    const arg = m[1].split(',')[0].trim();
    if (!/^metrics\.EVENTS\.[A-Z_]+$/.test(arg)) out.push(arg);
  }
  return out;
}

// C 判据 2：识别结果读幽灵字段（服务端从来不给 foods / total）
//   启发式：只认短名响应变量（r / res / raw / result / data）上的 .foods，
//   页面自己的视图模型（如 recResult.foods）不算违规。由 [D] 夹具证明它会红。
const GHOST_RE = /\b(r|res|raw|result|data)\.foods\b/g;
function ghostFoodsReads(src) {
  const out = [];
  let m;
  const s = stripComments(src);
  GHOST_RE.lastIndex = 0;
  while ((m = GHOST_RE.exec(s))) out.push(m[0]);
  return out;
}

// C 判据 3：lookup 的两种用途必须分别配套正确的埋点
//   识别复用：lookup(非字面量)  → 必须配 VISION_REUSED
//   手输命中：lookup({...})     → 必须配 KB_HIT
function lookupCallKinds(src) {
  const manual = [];
  const recog = [];
  const re = /foodkb\.lookup\(([^)]*)\)/g;
  let m;
  const s = stripComments(src);
  while ((m = re.exec(s))) {
    const arg = m[1].split(',')[0].trim();
    if (arg.charAt(0) === '{') manual.push(arg); else recog.push(arg);
  }
  return { manual, recog };
}

console.log('\n[C] 调用点静态断言');

// 所有静态检查统一读「去注释」后的源码
const readClean = (f) => stripComments(fs.readFileSync(f, 'utf8'));

// C1 全仓禁裸事件名
const bareHits = [];
for (const f of JS_FILES) {
  const b = bareEventArgs(readClean(f));
  if (b.length) bareHits.push(rel(f) + ' → ' + b.join(', '));
}
if (!bareHits.length) {
  ok('全仓 metrics.inc 一律走 EVENTS 表，无裸字符串事件名');
} else {
  bareHits.forEach((h) => bad('裸事件名：' + h));
}

// C2 每个调视觉识别的文件：发起前记 VISION_START（失败也要计，因为钱已经花了）
const VISION_START = 'metrics.inc(metrics.EVENTS.VISION_START)';
const visionFiles = JS_FILES.filter((f) => readClean(f).indexOf('vision.analyzeImage(') >= 0);
if (!visionFiles.length) {
  bad('没有任何文件调用 vision.analyzeImage —— 守卫失去对象，请检查选文件规则');
} else {
  let allOk = true;
  for (const f of visionFiles) {
    const src = readClean(f);
    const iStart = src.indexOf(VISION_START);
    const iCall = src.indexOf('vision.analyzeImage(');
    const hasFail = src.indexOf('metrics.EVENTS.VISION_FAIL') >= 0;
    if (iStart < 0 || iStart > iCall || !hasFail) {
      allOk = false;
      bad(rel(f) + ' 埋点位次不对：VISION_START@' + iStart + ' 应在 analyzeImage@' + iCall +
          ' 之前，且必须记 VISION_FAIL（当前 ' + (hasFail ? '有' : '无') + '）');
    }
  }
  if (allOk) ok(visionFiles.map(rel).join(' / ') + '：发起前记 VISION_START、失败记 VISION_FAIL');
}

// C3 learn 必须被计数（否则「我教了几次」永远为 0）
const learnHits = [];
for (const f of JS_FILES) {
  const src = readClean(f);
  if (src.indexOf('foodkb.learn(') >= 0 && src.indexOf('metrics.EVENTS.KB_LEARN') < 0) learnHits.push(rel(f));
}
if (!learnHits.length) {
  ok('所有 learn 调用点都记了 KB_LEARN');
} else {
  learnHits.forEach((h) => bad(h + ' 调了 foodkb.learn 但没记 KB_LEARN'));
}

// C4 lookup 的两种用途各自配套正确埋点
const lookupBad = [];
for (const f of JS_FILES) {
  const src = readClean(f);
  const k = lookupCallKinds(src);
  if (k.recog.length && src.indexOf('metrics.EVENTS.VISION_REUSED') < 0) {
    lookupBad.push(rel(f) + ' 有识别复用 lookup 但没记 VISION_REUSED');
  }
  if (k.manual.length && src.indexOf('metrics.EVENTS.KB_HIT') < 0) {
    lookupBad.push(rel(f) + ' 有手输命中 lookup 但没记 KB_HIT');
  }
}
if (!lookupBad.length) {
  ok('lookup 两种用途（识别复用 / 手输命中）各自配套了正确的埋点');
} else {
  lookupBad.forEach((h) => bad(h));
}

// C5 幽灵字段回归（服务端没有任何一条路径返回 foods）
const ghostHits = [];
for (const f of JS_FILES) {
  const g = ghostFoodsReads(readClean(f));
  if (g.length) ghostHits.push(rel(f) + ' → ' + g.join(', '));
}
if (!ghostHits.length) {
  ok('无 .foods 幽灵字段读取（当年照过期注释写错了两个页面）');
} else {
  ghostHits.forEach((h) => bad('幽灵字段：' + h));
}

// C6 第二份实现回归：matchByName 已并入 lookup
const dupHits = [];
for (const f of walk(path.join(ROOT, 'utils'), '.js', []).concat(JS_FILES)) {
  if (readClean(f).indexOf('matchByName') >= 0) dupHits.push(rel(f));
}
if (!dupHits.length) {
  ok('无 matchByName 残留（已与 lookup 合并，禁第二份实现）');
} else {
  dupHits.forEach((h) => bad(h + ' 仍在用已删除的 matchByName'));
}

/* =====================================================================
   [D] 判据校准 —— 夹具必须能证伪
   ===================================================================== */

console.log('\n[D] 判据校准（夹具必须证明判据会红）');

const FIX = {
  badBare: "metrics.inc('vs');",
  goodBare: 'metrics.inc(metrics.EVENTS.VISION_START);',
  badGhost: 'const foods = (res.foods || []).map(f => f);',
  goodGhost: 'const foods = (r.items || []).map(it => ({ name: it.name }));',
  badVision: 'vision.analyzeImage(p);',
  goodVision: 'metrics.inc(metrics.EVENTS.VISION_START);\nvision.analyzeImage(p);\nmetrics.inc(metrics.EVENTS.VISION_FAIL);',
  badManual: 'const hit = foodkb.lookup({ name: n }, true);',
  goodManual: 'const hit = foodkb.lookup({ name: n }, true);\nmetrics.inc(metrics.EVENTS.KB_HIT);',
  // 注释豁免（单独校验，见下方）：违规写在注释里必须不判红，写在代码里必须判红
  commentOnly: "// 旧写法是 metrics.inc('vs')，已废弃\n/* res.foods 是幽灵字段 */",
  mixedViolation: "/* 说明 */\nmetrics.inc('vs');"
};

const calib = [
  ['裸事件名', bareEventArgs(FIX.badBare).length > 0, bareEventArgs(FIX.goodBare).length === 0],
  ['幽灵字段', ghostFoodsReads(FIX.badGhost).length > 0, ghostFoodsReads(FIX.goodGhost).length === 0],
  ['VISION_START 位次',
    !(FIX.badVision.indexOf(VISION_START) >= 0 && FIX.badVision.indexOf(VISION_START) < FIX.badVision.indexOf('vision.analyzeImage(')),
    FIX.goodVision.indexOf(VISION_START) >= 0 && FIX.goodVision.indexOf(VISION_START) < FIX.goodVision.indexOf('vision.analyzeImage(')],
  ['手输命中埋点',
    lookupCallKinds(FIX.badManual).manual.length > 0 && FIX.badManual.indexOf('metrics.EVENTS.KB_HIT') < 0,
    lookupCallKinds(FIX.goodManual).manual.length > 0 && FIX.goodManual.indexOf('metrics.EVENTS.KB_HIT') >= 0]
];

let calibOk = true;
for (const [name, redAsExpected, greenAsExpected] of calib) {
  if (!redAsExpected) { calibOk = false; bad('校准失败：' + name + ' 的违规样本没被判红 —— 该判据形同虚设'); }
  if (!greenAsExpected) { calibOk = false; bad('校准失败：' + name + ' 的良样本被误判为红 —— 会产生假警报'); }
}
if (calibOk) ok(calib.length + ' 组校准样本全部符合预期（违规必红 / 良样本必绿）');

// 去注释这一层单独双向校准。两个方向都要验：
//   · 违规只出现在注释里 → 必须不判红（否则我写一句「旧写法是 XXX」就把门禁打红）
//   · 注释之后紧跟真违规 → 必须仍判红（否则说明 stripComments 把代码一起吞了 → 静默漏报）
const stripIgnored = bareEventArgs(FIX.commentOnly).length === 0 && ghostFoodsReads(FIX.commentOnly).length === 0;
const stripStillCatches = bareEventArgs(FIX.mixedViolation).length === 1;
if (stripIgnored && stripStillCatches) {
  ok('去注释双向校准通过（注释里的反模式不判红 / 注释后的真违规仍判红）');
} else {
  bad('去注释校准失败：注释豁免=' + stripIgnored + '（应 true）、注释后仍能抓到=' + stripStillCatches + '（应 true）');
}

/* =====================================================================
   [E] 页面接线 —— stub 掉 Page/wx，跑**真实**的 food-scan 处理器
   ---------------------------------------------------------------------
   [A]~[D] 只证明「模块自己是对的」。而 A3 最值钱的规则是**页面接线**规则：
   套用修正值时只覆盖有值的字段、纠正要落库、历史回看不许写库。
   这些全在页面里，不跑一遍页面就等于没验。
   ===================================================================== */

function finish() {
  foodkb.reset();
  metrics.reset();
  console.log('\n' + (fail ? '✗' : '✓') + ' verify-foodkb: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

(async () => {
  console.log('\n[E] 页面接线（stub Page/wx，跑真实 food-scan 处理器）');

  const APP = { globalData: { meals: [], trainingLogs: [], weightRecords: [], profile: {}, selectedActions: [] } };
  global.getApp = () => APP;
  let pageCfg = null;
  global.Page = (cfg) => { pageCfg = cfg; };
  let modalReply = null;
  Object.assign(global.wx, {
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    showModal: (o) => { if (o && o.success) o.success(modalReply || { confirm: false }); },
    showToast: () => {},
    navigateBack: () => {},
    switchTab: () => {},
    openSetting: () => {}
  });

  const visionMod = require(path.join(ROOT, 'utils', 'foodvision.js'));
  require(path.join(ROOT, 'utils', 'auth.js')).requireLogin = () => true;  // 接线测试不关心登录
  require(path.join(ROOT, 'pages', 'food-scan', 'food-scan.js'));

  if (!pageCfg || !pageCfg.data) {
    bad('food-scan.js 没有调用 Page(...) —— 拿不到页面配置，本段失去对象');
    finish();
    return;
  }

  const inst = Object.assign({}, pageCfg);
  inst.data = JSON.parse(JSON.stringify(pageCfg.data));
  inst.route = 'pages/food-scan/food-scan';
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') === -1) { this.data[k] = patch[k]; return; }
      const parts = k.split('.');
      let o = this.data;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = patch[k];
    });
  };

  const meal = { name: '鸡胸肉沙拉', items: [{ name: '鸡胸肉' }, { name: '沙拉' }] };
  const modelRaw = {
    success: true, name: '鸡胸肉沙拉',
    items: [{ name: '鸡胸肉', weight_g: 120, calories: 200 }, { name: '沙拉', weight_g: 160, calories: 160 }],
    total_weight_g: 280, total_calories: 360, protein: 25, carb: 30, fat: 12,
    confidence: 0.9, mock: false
  };

  // E1 识别时套用历史修正值 —— 只覆盖「学过且有值」的字段
  foodkb.reset();
  metrics.reset();
  foodkb.learn(meal, { calories: 300, protein: null, carb: 40, fat: 8, weight: 280 }, '我的鸡胸沙拉');
  visionMod.analyzeImage = () => Promise.resolve(modelRaw);
  await inst.analyze('/tmp/a.jpg');
  const p1 = inst.data.photo || {};
  if (p1.kcal === 300 && p1.protein === 25 && p1.carb === 40 && p1.fat === 8 && p1.reused === true) {
    ok('E1 套用修正值：学过的 kcal300/碳水40/脂肪8 被覆盖，没学过的蛋白保留模型的 25');
  } else {
    bad('E1 覆盖规则错误（可能拿 null 盖掉了模型值，或压根没复用）：' +
        JSON.stringify({ kcal: p1.kcal, protein: p1.protein, carb: p1.carb, fat: p1.fat, reused: p1.reused }));
  }

  // E2 纠正 → 写回知识库 + 计数
  modalReply = { confirm: true, content: '250' };
  inst.editNum({ currentTarget: { dataset: { field: 'kcal' } } });
  const afterEdit = foodkb.lookup(meal, false);
  const ev2 = metrics.today().ev;
  if (afterEdit && afterEdit.calories === 250 &&
      ev2[metrics.EVENTS.KB_LEARN] === 1 && ev2[metrics.EVENTS.VISION_EDITED] === 1) {
    ok('E2 改热量 360→250：写回知识库，并各记 1 次 KB_LEARN / VISION_EDITED');
  } else {
    bad('E2 纠正未落库或未计数：' + JSON.stringify({ calories: afterEdit && afterEdit.calories, ev: ev2 }));
  }

  // E3 越界输入必须拦住 —— 否则一个打错的数会被写进知识库并在以后**静默自动套用**
  modalReply = { confirm: true, content: '99999' };
  const safeVal = foodkb.lookup(meal, false).calories;
  inst.editNum({ currentTarget: { dataset: { field: 'kcal' } } });
  if (foodkb.lookup(meal, false).calories === safeVal) {
    ok('E3 越界值 99999 被拦住，没有污染知识库');
  } else {
    bad('E3 越界值写进了知识库：' + foodkb.lookup(meal, false).calories);
  }

  // E4 清空输入 = 放弃修改，不得把已确认的值清成未知
  modalReply = { confirm: true, content: '' };
  inst.editNum({ currentTarget: { dataset: { field: 'kcal' } } });
  if (foodkb.lookup(meal, false).calories === safeVal && inst.data.photo.kcal === safeVal) {
    ok('E4 空输入按「放弃修改」处理，已确认的值没有被清掉');
  } else {
    bad('E4 空输入把值清掉了：' + JSON.stringify({ kb: foodkb.lookup(meal, false).calories, photo: inst.data.photo.kcal }));
  }

  // E5 历史回看是只读的：不该显示编辑入口，更不能写库（没有原始签名）
  const sizeBefore = foodkb.size();
  inst.data.history = [{ ts: 1, name: '旧记录', kcal: 100, weight: 200, protein: 5, carb: 10, fat: 3, conf: '80%' }];
  inst.onPickHistory({ currentTarget: { dataset: { idx: 0 } } });
  modalReply = { confirm: true, content: '5' };
  inst.editNum({ currentTarget: { dataset: { field: 'kcal' } } });
  inst.editName();
  if (inst.data.photo.canEdit === false && foodkb.size() === sizeBefore) {
    ok('E5 历史回看 canEdit=false，且编辑调用不会写库（防止用别的签名污染知识库）');
  } else {
    bad('E5 历史回看可编辑 / 写进了知识库：canEdit=' + inst.data.photo.canEdit + ' size=' + foodkb.size());
  }

  // E6 没有热量时不得生成饮食记录
  APP.globalData.meals = [];
  inst.data.photo = Object.assign({}, inst.data.photo, { canEdit: true, kcal: null });
  inst.saveAndExit();
  if (APP.globalData.meals.length === 0) {
    ok('E6 无热量数据时拦住「加入记录」，不产生空记录');
  } else {
    bad('E6 生成了没有热量的饮食记录');
  }

  finish();
})().catch((e) => {
  bad('E 段抛异常：' + ((e && e.stack) || e));
  finish();
});

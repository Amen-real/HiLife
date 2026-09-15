/**
 * verify-event-binding.cjs —— 事件绑定红线守卫
 *
 * 守两条线：
 *   [A] wxml 的事件名属性禁止写 Mustache 表达式
 *       `bindtap="{{cond ? 'a' : 'b'}}"` —— 微信**不会**把事件名当数据绑定编译，
 *       整个字符串被当成字面量事件名，永远匹配不到任何方法 →
 *       **静默失效**（无报错、无警告、点了没反应）。这是本项目踩过的真实事故，
 *       见 pages/workout/workout.wxml:209「结束训练」按钮。
 *       正确写法：拆成两个静态绑定的节点，用 wx:if / 三元只控制**文案**，不控制**事件名**。
 *
 *   [B] wxml 里绑定的每个事件名，必须在该页/组件的 js 里真实存在同名方法
 *       （防手写错名、防改名漏改 wxml）。注意：只扫静态名，[A] 命中的会被单独报出。
 *
 * 为什么 [A] 必须单独守：类型检查、编辑器补全、微信开发者工具**都不会**报这个错，
 *   只有真机上点下去才发现没反应 —— 纯静态扫描是唯一能提前拦住的手段。
 *
 * 用法： node scripts/verify-event-binding.cjs
 * 退出码：0 = 通过；1 = 存在违规
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log('  ✓ ' + msg); }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }

const SKIP_DIRS = new Set(['.git', 'node_modules', '.workbuddy', 'assets', 'scripts', 'deliverables']);

/** 递归收集文件（按扩展名过滤） */
function collect(dir, ext, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) collect(abs, ext, out);
    else if (e.name.endsWith(ext)) out.push(abs);
  }
}
const rel = p => path.relative(process.cwd(), p).split(path.sep).join('/');

/** 事件名属性：bindtap / catchtap / capture-bind:tap / mut-bind:tap ... */
const EVENT_ATTR = /\b((?:capture-)?(?:bind|catch|mut-bind)):?([a-zA-Z]+)\s*=\s*"([^"]*)"/g;

/**
 * 提取 js 中的「方法定义」位置。
 *
 * 为什么不能用「顶层 key 扫描」：Component 的 methods 全部嵌在 `methods: { }` 里，
 * 顶层 key 只有 properties/data/methods/lifetimes —— 深度 0 扫描会把所有真实方法
 * 漏掉，产出满屏假阳性（曾一次误报 21 条）。改为只认**定义位置**的语法形状：
 *   行首缩进 + 名字 + (参数) + {        —— 方法简写（Page 与 methods 内通用）
 *   行首缩进 + 名字 + : function (      —— 函数值属性
 *   行首缩进 + 名字 + : (…) => {        —— 箭头函数值
 * 这样既穿透 methods 嵌套，又天然排除 this.setData( / wx.showToast( 这类**调用**。
 */
const DEF_RE = /^[ \t]*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|^[ \t]*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\s*\(|\([^)]*\)\s*=>)/gm;

/**
 * 定义位置语法形状的**天然副作用**：控制流语句 `if (…) {` / `for (…) {` / `catch (e) {`
 * 以及作为对象字面量键的回调 `success(res) {` / `fail(err) {` 长得一模一样，会被一起收进来。
 * [B] 只查「绑定名是否在集合里」，多出来的条目不影响判定，所以一直没暴露；
 * 但 [C]/[D] 要逐个方法做判断，不排掉就会报出 197 条 `if()` 之类的噪音。
 */
const NOT_METHOD = new Set([
  // 控制流 / 关键字
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'finally', 'return',
  'function', 'new', 'delete', 'typeof', 'await', 'async', 'in', 'of', 'case', 'default',
  // wx API 的回调键（对象字面量简写，不可能被 wxml 绑定）
  'success', 'fail', 'complete', 'resolve', 'reject', 'then', 'done',
  // 框架入口（不是页面方法）
  'Page', 'Component', 'App', 'Behavior'
]);

function methodDefs(src) {
  const out = [];
  DEF_RE.lastIndex = 0;
  let m;
  while ((m = DEF_RE.exec(src))) {
    const name = m[1] || m[2];
    if (name && !NOT_METHOD.has(name)) out.push({ name, index: m.index });
  }
  return out;
}

/** 从 js 源码提取可绑定方法名；非 Page/Component 文件返回 null（跳过 [B] 校验） */
function methodNames(src, isWxs) {
  if (isWxs) {
    const names = new Set();
    for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const d of methodDefs(src)) names.add(d.name);
    return names;
  }
  if (!/\b(?:Page|Component)\s*\(/.test(src)) return null;
  const names = new Set();
  for (const d of methodDefs(src)) names.add(d.name);
  return names;
}

/** 去掉 wxml 注释，避免把注释里的示例当真实绑定 */
const stripWxmlComments = s => s.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));

// ---------- [A] 事件名禁 Mustache ----------
console.log('[A] 事件名属性禁止 Mustache 表达式（绑定了就是静默失效）');
const wxmls = [];
collect(process.cwd(), '.wxml', wxmls);
wxmls.sort();

const violations = [];
const bindings = [];  // { file, line, name }
for (const f of wxmls) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = stripWxmlComments(raw);
    EVENT_ATTR.lastIndex = 0;
    let m;
    while ((m = EVENT_ATTR.exec(line))) {
      const kind = m[1] + (m[1].includes(':') ? '' : ':' + m[2]);
      const val = m[3].trim();
      if (/\{\{/.test(val)) {
        violations.push({ file: rel(f), line: i + 1, kind, val });
      } else if (val) {
        bindings.push({ file: rel(f), line: i + 1, name: val });
      }
    }
  });
}

if (violations.length) {
  for (const v of violations) {
    bad(`${v.file}:${v.line}  ${v.kind}="${v.val}"`);
  }
  console.log('      正确写法：拆成两个节点，wx:if 控事件名，三元只控文案：');
  console.log('        <view wx:if="{{phase === \'ready\'}}" bindtap="skip">跳过</view>');
  console.log('        <view wx:if="{{phase !== \'ready\'}}" bindtap="end">结束</view>');
} else {
  ok(`全仓 ${wxmls.length} 个 wxml，事件名均为静态字面量（0 处 Mustache）`);
}

// ---------- [B] 绑定名必须在 js 中存在 ----------
console.log('\n[B] wxml 绑定的方法名必须在同名 js 中存在');
let checked = 0, skippedNoJs = 0;
const missing = [];
for (const f of wxmls) {
  const jsPath = f.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsPath)) { skippedNoJs++; continue; }
  const names = methodNames(fs.readFileSync(jsPath, 'utf8'), false);
  if (!names) { skippedNoJs++; continue; }
  checked++;
  for (const b of bindings.filter(b => b.file === rel(f))) {
    if (!names.has(b.name)) missing.push(b);
  }
}
if (missing.length) {
  for (const b of missing) bad(`${b.file}:${b.line}  绑定 "${b.name}" 在对应 js 中无同名方法`);
} else {
  ok(`${bindings.length} 个静态绑定全部命中（覆盖 ${checked} 个页面/组件 js，${skippedNoJs} 个无配对 js 已跳过）`);
}

// ---------- [C] 反向：js 里的空壳方法备案 ----------
// 两类都算「空壳」，因为用户点下去都得不到结果：
//   ① 只 toast「开发中 / 敬请期待」这类文案；
//   ② 方法体只有一条 wx.showToast —— 这类连「开发中」都没说，点击后界面毫无变化，
//      和 P0-1 的静默失败是同一个体验事故。
//      历史案例：workout 的 editPlan 绑在标题行 ✎ 图标上，点了只弹「训练计划编辑还没做」。
//      2026-09-15 已按「撤掉假入口」处置（连同 .wo-edit-ico 样式一起删），故本段现为空。
console.log('\n[C] 空壳方法备案（点了没有任何结果，非红线，登记以防遗忘）');
const stubs = [];
for (const f of wxmls) {
  const jsPath = f.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsPath)) continue;
  const src = fs.readFileSync(jsPath, 'utf8');
  const defs = methodDefs(src);
  defs.forEach((d, i) => {
    const stop = i + 1 < defs.length ? defs[i + 1].index : Math.min(src.length, d.index + 600);
    const body = src.slice(d.index, stop);
    const line = src.slice(0, d.index).split(/\r?\n/).length;
    const keyword = /开发中|敬请期待|即将上线|暂未开放|coming soon/i.test(body);
    // 剥掉最外层花括号，看方法体是不是「只有一条 showToast」
    const inner = body.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '').trim();
    const toastOnly = /^wx\.showToast\([\s\S]*\)\s*;?$/.test(inner);
    if (keyword || toastOnly) {
      stubs.push(`${rel(jsPath)}:${line}  ${d.name}()  ${keyword ? '[说"开发中"]' : '[只弹提示，无结果]'}`);
    }
  });
}
if (stubs.length) {
  for (const s of stubs) console.log('  · ' + s);
  console.log(`      共 ${stubs.length} 个空壳 —— 上线前需逐个决定「做掉 / 藏起来 / 明说」`);
} else {
  ok('无空壳方法');
}

// ---------- [D] 孤儿方法：页面 js 里定义，但既没被 wxml 绑定、也没被内部调用 ----------
// 与 [C] 互补：[C] 是「有入口但没结果」，[D] 是「连入口都没有」。
// 非红线（可能是有意留给后续的占位），但堆多了会让 js 越来越难读，故登记。
// 实测价值：正因这条才发现 profile._saveFallback 从未被调用 —— 导出降级链断了，
// PC 端/开发者工具点「导出」只弹一句「当前环境不支持转发文件」就结束。
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onHide', 'onUnload', 'onReady', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onResize', 'onTabItemTap',
  'onAddToFavorites', 'onSaveExitState', 'onLaunch', 'onError', 'onPageNotFound',
  'created', 'attached', 'ready', 'detached', 'moved', 'lifetimes', 'pageLifetimes',
  'observers', 'properties', 'data', 'methods', 'options', 'behaviors',
  'noop', 'noopCapture'
]);
console.log('\n[D] 孤儿方法备案（js 里定义，但 wxml 未绑定且内部未调用）');
const orphans = [];
for (const f of wxmls) {
  const jsPath = f.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsPath)) continue;
  const src = fs.readFileSync(jsPath, 'utf8');
  const bound = new Set(bindings.filter(b => b.file === rel(f)).map(b => b.name));
  for (const d of methodDefs(src)) {
    if (LIFECYCLE.has(d.name)) continue;
    if (bound.has(d.name)) continue;
    if (new RegExp('\\.' + d.name + '\\b').test(src)) continue; // this.xxx / that.xxx
    const line = src.slice(0, d.index).split(/\r?\n/).length;
    orphans.push(`${rel(jsPath)}:${line}  ${d.name}()`);
  }
}
if (orphans.length) {
  for (const s of orphans) console.log('  · ' + s);
  console.log(`      共 ${orphans.length} 个 —— 无入口即死代码，建议删掉（要留就留个注释说明用途）`);
} else {
  ok('无孤儿方法');
}

console.log(`\n${fail ? '✗' : '✓'} verify-event-binding: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

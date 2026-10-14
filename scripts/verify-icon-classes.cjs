/**
 * verify-icon-classes.cjs —— mask 图标类「引用 ↔ 定义」一致性守卫
 *
 * 为什么必须有它：
 *   图标由 scripts/gen-icons-svg.cjs 生成（key 不带连字符：foodbowl / staron），
 *   类名落在 styles/icons.wxss：.ico-<key> { mask-image: ... }。
 *   wxml 里写错 key（如 ico-food-bowl）**不报错也不缺图**——只是 mask 没挂上，
 *   真机上表现为「图标异常/隐形」（2026-10-14 实际发生：饮食页手动输入入口）。
 *   本守卫把「wxml/wxss 用到的每个 ico-<key> 都必须有定义」钉成断言。
 *
 * 定义集口径：全局 styles/icons.wxss ∪ 组件/页面 wxss 里的本地 .ico-<key> 规则
 *   （training-review 等组件有自己的 data-URI mask 图标，属合法本地定义）。
 *
 * 变异测试记录（2026-10-14）：
 *   · 首版正则 ico-([a-z0-9]+)(?![a-z0-9-]) 把「ico-food-bowl」整段跳过
 *     （引用数 71→70 但全绿）——连字符序列必须整个捕获再判缺失；
 *   · 修正后注入 ico-food-bowl → 红；还原 → 绿。
 *
 * 用法： node scripts/verify-icon-classes.cjs
 * 退出码：0 = 通过；1 = 失败
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

/* [A] 尺子自检：icons.wxss 必须解析出足够多的图标 key（表空 = 路径/生成链坏了） */
const ICONS_WXSS = path.join(ROOT, 'styles', 'icons.wxss');
assert(fs.existsSync(ICONS_WXSS), 'styles/icons.wxss 存在（生成链输出在位）');

const globalKeys = new Set();
fs.readFileSync(ICONS_WXSS, 'utf8').replace(/\r/g, '').split('\n').forEach(line => {
  const m = line.match(/\.ico-([a-z0-9-]+)\s*\{/);
  if (m) globalKeys.add(m[1]);
});
assert(globalKeys.size >= 50, 'icons.wxss 解析出 ' + globalKeys.size + ' 个图标 key（≥50，空表会被抓住）');

/* 收集待扫文件：pages / components / custom-tab-bar 的 wxml + wxss */
const files = [];
['pages', 'components', 'custom-tab-bar'].forEach(dir => {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (/\.(wxml|wxss)$/.test(e.name)) files.push(p);
    });
  })(base);
});
assert(files.length > 0, '扫到 ' + files.length + ' 个 wxml/wxss 文件（0 = 目录错了，断言空转）');

/* 第一遍：定义集 = 全局 key ∪ 各 wxss 本地 .ico-<key> 规则 */
const localKeys = new Set();
files.forEach(p => {
  if (!p.endsWith('.wxss')) return;
  fs.readFileSync(p, 'utf8').replace(/\r/g, '').split('\n').forEach(line => {
    const m = line.match(/\.ico-([a-z0-9-]+)\s*\{/);
    if (m && !globalKeys.has(m[1])) localKeys.add(m[1]);
  });
});
const defined = new Set([...globalKeys, ...localKeys]);

/* 第二遍：全仓引用核对（连字符序列整个捕获，防止错 key 被拆词后静默漏报） */
const missing = new Map();   // key -> [file:line]
let refCount = 0;            // 已核对引用数（防止词表空转）
files.forEach(p => {
  fs.readFileSync(p, 'utf8').replace(/\r/g, '').split('\n').forEach((line, i) => {
    // ico--xxx（双横线）是颜色修饰符，非图形 key：[a-z0-9] 打头天然排除 "-ink"
    const re = /ico-([a-z0-9]+(?:-[a-z0-9]+)*)/g;
    let m;
    while ((m = re.exec(line))) {
      refCount++;
      const key = m[1];
      if (defined.has(key)) continue;
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(path.relative(ROOT, p) + ':' + (i + 1));
    }
  });
});

assert(refCount > 0, '扫到 ' + refCount + ' 处 ico-* 引用（0 = 词表/目录错了，断言空转）');
console.log('\n[B] 定义集：全局 ' + globalKeys.size + ' + 本地 ' + localKeys.size + ' = ' + defined.size + ' 个 key');
if (localKeys.size) console.log('    本地（组件自定义）: ' + [...localKeys].join(', '));

if (missing.size) {
  console.log('  ✗ 以下 ico-* 类在任何 wxss 都无定义（真机表现为图标隐形）：');
  missing.forEach((locs, k) => console.log('      ico-' + k + '\n        ' + locs.join('\n        ')));
  fail++;
} else {
  assert(true, '全部 ico-* 引用均有定义（无静默隐形图标）');
}

console.log('\n' + (fail ? '✗' : '✓') + ' verify-icon-classes: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

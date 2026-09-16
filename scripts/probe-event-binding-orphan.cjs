/**
 * scripts/probe-event-binding-orphan.cjs —— 验证「孤儿检测的收紧真的生效」
 *
 * 本项目通则：**先确认尺子能看见被测物，再报结论**。
 * `verify-event-binding.cjs [D]` 判断「方法是否被内部调用」时，原先用 `\.<name>\b`，
 * 本意匹配 `this.xxx`，却同时命中了**别的对象上的同名方法**（真实案例：
 * `pages/plan/plan.js` 里 `store.deletePlan(id)` 把它 5 行之下的死方法 `deletePlan(e)`
 * 伪装成「已被调用」，于是 [D] 恒绿、死代码藏了一整轮）。
 *
 * 收紧到 `this.` 前缀后，守卫里已内联 `[D0]` 校准样本。本探针回答更高一层的问题：
 * **「[D0] 自己会不会在回归时亮红？」** —— 若它只是装饰，[D] 的漏报会被再次掩盖，
 * 与 `verify-exercises-compact` 拿 git HEAD 自比属同一类失效。
 *
 * 做法：把 `calledInternally` 打回旧的 `\.name\b`，跑守卫，断言
 *   ① [D0] 报失准；② [D] 重新漏掉 fixture 里的目标方法。
 * 无论成败都在 finally 里还原守卫、删除 fixture，并复验还原后 [D] 重新报出目标。
 *
 * **fixture 自带被测量**：不再依赖「仓库里恰有一个真孤儿」（那种孤儿迟早被清掉，
 * 探针就跟着失效）。这里临时造一个页面，同时含「同名不同对象的调用」与「真孤儿」，
 * 因此探针在任何仓库状态下都可重复运行。
 *
 * ⚠️ 会**临时改写** scripts/verify-event-binding.cjs 并在 pages/ 下建临时目录，均在 finally 清理。
 * 用法： node scripts/probe-event-binding-orphan.cjs
 * 退出码：0 = [D0] 确能在回归时报红；1 = 校准块是装饰；2 = 先决条件不满足
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const guard = path.join(root, 'scripts', 'verify-event-binding.cjs');

// 探针要打的补丁：收紧实现 ↔ 旧实现。两者都必须能在守卫里原样找到，
// 否则说明守卫被改过，探针结论不可信（先决条件）。
const GOOD = "const calledInternally = (src, name) => new RegExp('\\\\bthis\\\\.' + name + '\\\\b').test(src);";
const BAD = "const calledInternally = (src, name) => new RegExp('\\\\.' + name + '\\\\b').test(src);";

// fixture：`store.__probeOrphan()` 是**同名不同对象**的调用，旧实现会据此放过 __probeOrphan；
// 而 __probeOrphan 本身没被 wxml 绑定、也没有 this. 调用 → 它是真孤儿。
const FIX_DIR = path.join(root, 'pages', '__probe_orphan');
const FIX_JS = path.join(FIX_DIR, '__probe_orphan.js');
const FIX_WXML = path.join(FIX_DIR, '__probe_orphan.wxml');
const FIX_JS_SRC = [
  '// 探针临时文件，由 scripts/probe-event-binding-orphan.cjs 创建与删除',
  'Page({',
  '  boundOne() { return 1; },',
  '  __probeOrphan() { return 2; },',
  '  otherObjectCall() { store.__probeOrphan(); }',
  '});',
  ''
].join('\n');
const FIX_WXML_SRC = '<view bindtap="boundOne">probe</view>\n';
const TARGET = /pages\/__probe_orphan\/__probe_orphan\.js:\d+\s+__probeOrphan\(\)/;

// 先决条件
const original = fs.readFileSync(guard, 'utf8');
if (!original.includes(GOOD)) {
  console.error('✗ 先决条件不满足：守卫里找不到预期的 calledInternally 实现（守卫被改过？）');
  process.exit(2);
}

let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.error('  ✗ ' + m); failed++; };

function runGuard() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [guard], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

try {
  // 1) 造 fixture
  fs.mkdirSync(FIX_DIR, { recursive: true });
  fs.writeFileSync(FIX_JS, FIX_JS_SRC, 'utf8');
  fs.writeFileSync(FIX_WXML, FIX_WXML_SRC, 'utf8');

  // 2) 先确认现状（收紧后）能看见它 —— 尺子先量到被测量
  const base = runGuard();
  (TARGET.test(base.out) ? ok : bad)('收紧后 [D] 能看见 fixture 孤儿（实得：' + (TARGET.test(base.out) ? '命中' : '未命中') + '）');

  // 3) 打回旧实现，制造盲区回归
  console.log('探针：把 [D] 的 this. 前缀打回 \\.name（制造盲区回归）');
  fs.writeFileSync(guard, original.replace(GOOD, BAD), 'utf8');
  const r = runGuard();
  const d0Red = /校准样本失准/.test(r.out);
  const hides = TARGET.test(r.out) === false;

  (d0Red ? ok : bad)('[D0] 在盲区回归时报红' + (d0Red ? '' : ' —— 校准块是装饰，没拦住回归'));
  (hides ? ok : bad)('[D] 在旧实现下重新漏掉同一个孤儿' + (hides ? '' : '（说明 this. 收紧没生效）'));
  if (!d0Red && hides) console.log('      注意：此时 [D] 报「无孤儿」，而 fixture 里的 __probeOrphan 确实存在');
} finally {
  fs.writeFileSync(guard, original, 'utf8');
  (fs.readFileSync(guard, 'utf8') === original ? ok : bad)('守卫源文件已无条件还原');

  const back = runGuard();
  (TARGET.test(back.out) ? ok : bad)('还原后 [D] 重新报出 fixture 孤儿');
  (/\[D0\][\s\S]{0,200}✓/.test(back.out) ? ok : bad)('还原后 [D0] 恢复通过');

  for (const p of [FIX_JS, FIX_WXML]) { try { fs.unlinkSync(p); } catch (e) {} }
  try { fs.rmdirSync(FIX_DIR); } catch (e) {}
  (!fs.existsSync(FIX_DIR) ? ok : bad)('fixture 已清除');
}

console.log(`\n${failed ? '✗' : '✓'} probe-event-binding-orphan: ${failed} 项断言失败`);
process.exit(failed ? 1 : 0);

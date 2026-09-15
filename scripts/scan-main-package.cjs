/**
 * scan-main-package.cjs —— 主包体积体检（report-only，不修改任何文件）
 *
 * 为什么需要它：
 *   WeChat 主包上限 2048KB（2MB）。项目根目录混放设计稿(.html)、文档(.md)、
 *   脚本(.cjs/.py)、assets/ 等大量非运行资源，是否进包**完全由**
 *   project.config.json 的 packOptions.ignore 决定 —— 与 .gitignore 无关，
 *   两套规则必须各自维护，改了一个忘了另一个就会出现「本地看着干净、包却爆了」。
 *
 * packOptions.ignore 三种规则类型必须**分别**实现，漏掉任一都会算错：
 *   folder —— 目录名匹配，整棵子树剔除（如 assets、scripts）
 *   file   —— 精确相对路径匹配（如 ui-redesign-preview.html、.gitignore）
 *   suffix —— 扩展名匹配（如 .html/.md/.log/.cjs/.py/.zip），**最容易漏**
 *             漏了 suffix 会把所有 .md/.html 计进包，体积虚高（曾误算 4380KB → 实际 1957KB）
 *
 * 用法： node scripts/scan-main-package.cjs            # 摘要
 *        node scripts/scan-main-package.cjs --top 20   # 多列大文件
 * 退出码：0 = 在预算内；1 = 超预算（可接 CI）
 */
const fs = require('fs');
const path = require('path');

const LIMIT_KB = 2048;                 // 主包硬上限
const WARN_KB = Math.round(LIMIT_KB * 0.9); // 90% 预警线 ~1843KB
const ROOT = process.cwd();
const args = process.argv.slice(2);
const TOPN = (() => {
  const i = args.indexOf('--top');
  return i >= 0 && args[i + 1] ? Math.max(1, parseInt(args[i + 1], 10) || 10) : 10;
})();

// 永远不进包的目录（版本控制/依赖，非小程序源码）
const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules', '.workbuddy']);

function loadIgnore() {
  const raw = fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8');
  const cfg = JSON.parse(raw);
  const list = (cfg.packOptions && cfg.packOptions.ignore) || [];
  return {
    folders: new Set(list.filter(r => r.type === 'folder').map(r => r.value)),
    files: new Set(list.filter(r => r.type === 'file').map(r => r.value)),
    suffixes: new Set(list.filter(r => r.type === 'suffix').map(r => r.value)),
  };
}

/** 判断某路径是否被 ignore 规则剔除（rel 用 posix 分隔符） */
function isIgnored(rel, name, isDir, ig) {
  // folder 规则：只看目录名，命中即整棵子树剔除
  if (isDir && ig.folders.has(name)) return true;
  // 路径中任一层的目录名命中 folder 规则
  if (rel.split('/').some(seg => ig.folders.has(seg))) return true;
  // file 规则：精确相对路径
  if (!isDir && ig.files.has(rel)) return true;
  // suffix 规则：扩展名（含首个点，如 .html）
  if (!isDir) {
    const ext = path.extname(name);
    if (ext && ig.suffixes.has(ext)) return true;
  }
  return false;
}

function walk(dir, ig, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (ent.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(ent.name)) continue;
      if (isIgnored(rel, ent.name, true, ig)) continue;
      walk(abs, ig, out);
    } else {
      if (isIgnored(rel, ent.name, false, ig)) continue;
      out.push({ rel, size: fs.statSync(abs).size });
    }
  }
}

/** 按顶层目录聚合 */
function groupByTop(files) {
  const g = new Map();
  for (const f of files) {
    const top = f.rel.includes('/') ? f.rel.split('/')[0] + '/' : '(根目录散文件)';
    g.set(top, (g.get(top) || 0) + f.size);
  }
  return [...g.entries()].sort((a, b) => b[1] - a[1]);
}

const ig = loadIgnore();
const packed = [];
walk(ROOT, ig, packed);

const totalBytes = packed.reduce((s, f) => s + f.size, 0);
const totalKB = Math.round(totalBytes / 1024);
const pct = ((totalKB / LIMIT_KB) * 100).toFixed(1);

console.log('=== 主包（packOptions.ignore 生效后）===');
console.log(`  文件数 ${packed.length}   体积 ${totalKB} KB / ${LIMIT_KB} KB  (${pct}%)   余量 ${LIMIT_KB - totalKB} KB`);
console.log(`  忽略规则：folder ${ig.folders.size} 条 / file ${ig.files.size} 条 / suffix ${ig.suffixes.size} 条`);
console.log(`  suffix 规则：${[...ig.suffixes].join(' ')}`);

if (!ig.suffixes.size) {
  console.log('  ⚠ 未配置任何 suffix 规则 —— 文档类文件会全部进包，体积大概率虚高');
}

console.log(`\n=== 体积占比 TOP 目录 ===`);
for (const [name, sz] of groupByTop(packed).slice(0, 8)) {
  console.log(`  ${String(Math.round(sz / 1024)).padStart(6)} KB  ${((sz / totalBytes) * 100).toFixed(1).padStart(5)}%  ${name}`);
}

console.log(`\n=== 单文件 TOP ${TOPN} ===`);
for (const f of packed.slice().sort((a, b) => b.size - a.size).slice(0, TOPN)) {
  console.log(`  ${String(Math.round(f.size / 1024)).padStart(6)} KB  ${f.rel}`);
}

let exitCode = 0;
if (totalKB > LIMIT_KB) {
  console.log(`\n✗ 超限！超出 ${totalKB - LIMIT_KB} KB —— 提审会被拒`);
  exitCode = 1;
} else if (totalKB > WARN_KB) {
  console.log(`\n⚠ 已超 90% 预警线（${WARN_KB} KB），下一次加资源前先清包`);
} else {
  console.log(`\n✓ 主包在预算内，余量 ${LIMIT_KB - totalKB} KB`);
}
process.exit(exitCode);

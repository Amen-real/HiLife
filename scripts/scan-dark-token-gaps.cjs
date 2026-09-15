// scripts/scan-dark-token-gaps.cjs —— 一次性审计：找出「浅色值 token 在深色下没跟着翻」的页面
//
// 原理：page{} 里定义的 token 是**浅色值**。凡是「只在浅色有意义」的 token
// （浅中性面 / 浅色品牌底 / 深橄榄绿字），各页 .page.theme-dark 块必须重定义，
// 否则深色下会拿到浅色值 —— 亮绿字压浅绿底、或浅色磁贴在黑底上刺眼。
//
// 用法：node scripts/scan-dark-token-gaps.cjs
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// 浅色专属 token（需要逐页翻的）
const NEEDS_FLIP = {
  '--primary-tint': '浅绿底',
  '--primary-text': '深橄榄绿字',
  '--primary-light': '亮绿渐变起笔',
  '--primary-ink': '深墨绿黑',
  '--accent-soft': '浅橙底',
  '--accent-tint': '浅橙底',
  '--info-tint': '浅蓝底',
  '--purple-tint': '浅紫底'
};

function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

// 收集某文件里所有 .theme-dark 规则的块体（支持多行选择器列表）
function darkBodies(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(text)) !== null) {
    if (/\.theme-dark/.test(m[1])) out.push(m[2]);
  }
  return out.join('\n');
}

const targets = walk(path.join(ROOT, 'pages'), []).concat(walk(path.join(ROOT, 'components'), []))
  .filter(f => f.endsWith('.wxss'));

let hits = 0;
for (const f of targets) {
  const text = fs.readFileSync(f, 'utf8');
  const dark = darkBodies(text);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const bad = [];
  for (const tok of Object.keys(NEEDS_FLIP)) {
    const used = new RegExp('var\\(\\s*' + tok.replace(/-/g, '\\-') + '\\s*[,)]').test(text);
    if (!used) continue;
    // 有 fallback 的（var(--x, ...)）在深色下拿到的是 fallback —— 也算风险，但优先看无 fallback 的
    const bare = new RegExp('var\\(\\s*' + tok.replace(/-/g, '\\-') + '\\s*\\)').test(text);
    const flipped = new RegExp(tok.replace(/-/g, '\\-') + '\\s*:').test(dark);
    if (!flipped) bad.push(tok + '（' + NEEDS_FLIP[tok] + (bare ? '' : '，带 fallback') + '）');
  }
  if (bad.length) { hits++; console.log('  ' + rel + '\n      → ' + bad.join('\n      → ')); }
}
if (!hits) console.log('  （无缺口）');
console.log('\n受影响文件数：' + hits);

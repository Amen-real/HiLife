// scripts/scan-module-usage.cjs —— 模块引用面盘点（报告型）
// 回答：utils/ 下每个模块到底还有没有调用方？哪些是死代码？
// 用法：node scripts/scan-module-usage.cjs
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    if (n === 'node_modules' || n === '.git' || n === 'assets') continue;
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

// 注意：必须把 utils/ 自己也当成「调用方」——否则只被 utils 内部引用的模块
// （如 utils/bodymap-data.js ← utils/bodymap.js）会被误判成死代码。
const codeFiles = []
  .concat(walk(path.join(ROOT, 'pages'), []))
  .concat(walk(path.join(ROOT, 'components'), []))
  .concat(walk(path.join(ROOT, 'custom-tab-bar'), []))
  .concat(walk(path.join(ROOT, 'utils'), []))
  .filter(f => /\.(js|wxml)$/.test(f));
codeFiles.push(path.join(ROOT, 'app.js'));
codeFiles.push(path.join(ROOT, 'app.json'));

const sources = codeFiles.map(f => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));

console.log('=== utils/ 模块引用面（谁 require 了它）===');
for (const f of fs.readdirSync(path.join(ROOT, 'utils'))) {
  const mod = f.replace(/\.js$/, '');
  const hits = [];
  for (const s of sources) {
    if (s.rel === 'utils/' + f) continue;
    // 匹配 require('...utils/<mod>') 或 '<mod>.js' 形式的引用
    const re = new RegExp('require\\([^)]*[/\'"]' + mod.replace(/[-]/g, '\\-') + '(\\.js)?[\'"]');
    if (re.test(s.text)) hits.push(s.rel);
  }
  console.log('  ' + (hits.length ? '·' : '✗') + ' utils/' + f + '  ← ' + (hits.length ? hits.join(', ') : '【全仓无引用】'));
}

console.log('\n=== 硬编码后端地址 / 非 https 请求 ===');
for (const s of sources) {
  const lines = s.text.split('\n');
  lines.forEach((l, i) => {
    if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/.test(l) && !/127\.0\.0\.1/.test(l)) {
      console.log('  ' + s.rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    } else if (/http:\/\//.test(l) && !/http:\/\/www\.w3\.org/.test(l)) {
      console.log('  ' + s.rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    }
  });
}

console.log('\n=== wx.request / wx.uploadFile / wx.downloadFile 调用点 ===');
for (const s of sources) {
  const lines = s.text.split('\n');
  lines.forEach((l, i) => {
    if (/wx\.(request|uploadFile|downloadFile|cloud\.callContainer|cloud\.uploadFile)/.test(l)) {
      console.log('  ' + s.rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    }
  });
}

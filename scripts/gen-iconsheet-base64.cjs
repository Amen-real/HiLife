// scripts/gen-iconsheet-base64.cjs
// 基于 components/icon/icons-data.js 的 base64 数据，生成可离线核对的图标总览 HTML。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = require(path.join(ROOT, 'components/icon/icons-data.js'));

const ids = Object.keys(DATA).sort();
const cells = ids.map(id =>
  `<div class="c"><img src="${DATA[id]}"/><b>${id}</b><small>${(DATA[id].length / 1024).toFixed(1)}KB</small></div>`
).join('');
const sheet = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>图标核对 · ${ids.length} 个（base64 内联）</title>
<style>
body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f5f7fa;margin:0;padding:24px;}
h1{font-size:20px;color:#1E293B;margin:0 0 4px}
p{color:#64748B;font-size:13px;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:14px}
.c{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(15,23,42,.05)}
.c img{width:72px;height:72px;object-fit:contain}
.c b{font-size:13px;color:#1E293B}
.c small{font-size:11px;color:#94A3B8}
</style></head><body>
<h1>图标资源核对（${ids.length} 个 · base64 内联）</h1>
<p>这些图标以 data-URI 内联进 components/icon/icons-data.js，已随主包发布，不依赖被忽略的 assets 文件夹。</p>
<div class="grid">${cells}</div>
</body></html>`;
fs.writeFileSync(path.join(ROOT, 'icon-sheet.html'), sheet);
console.log('wrote icon-sheet.html |', ids.length, 'icons');

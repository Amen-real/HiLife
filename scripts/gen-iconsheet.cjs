// scripts/gen-iconsheet.cjs —— 生成图标总览 HTML（内嵌 base64 PNG，便于离线检查）
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets', 'icons');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();

const cards = files.map(f => {
  const name = f.replace(/^i-/, '').replace(/\.png$/, '');
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  return `<div class="card">
    <img src="data:image/png;base64,${b64}" width="64" height="64" />
    <div class="nm">${name}</div>
    <div class="file">${f}</div>
  </div>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HiLife 图标总览</title>
<style>
  body{margin:0;font-family:-apple-system,system-ui,'PingFang SC',sans-serif;background:#f5f7fa;color:#1f2329;padding:28px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#8a9099;font-size:13px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:14px}
  .card{background:#fff;border:1px solid #eef0f3;border-radius:14px;padding:16px 10px;text-align:center;box-shadow:0 2px 10px rgba(31,35,41,.04)}
  .card img{width:64px;height:64px;object-fit:contain}
  .nm{margin-top:10px;font-size:13px;font-weight:600}
  .file{margin-top:2px;font-size:11px;color:#aab0b8;word-break:break-all}
</style></head>
<body>
  <h1>HiLife 小程序图标总览</h1>
  <div class="sub">共 ${files.length} 个 PNG（256×256），位于 assets/icons/，经全局 &lt;icon&gt; 组件引用</div>
  <div class="grid">${cards}</div>
</body></html>`;

const out = path.join(__dirname, '..', 'icon-sheet.html');
fs.writeFileSync(out, html);
console.log('wrote', out, files.length, 'icons');

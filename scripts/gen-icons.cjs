// scripts/gen-icons.cjs
// 提取 ui-preview-prototype.html 中已确认的 SVG 图标符号，逐个光栅化为 PNG 资源，
// 输出到 assets/icons/，并生成 icon-sheet.html 供核对。
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'ui-preview-prototype.html');
const OUT = path.join(ROOT, 'assets/icons');
const SIZE = 256; // 输出 PNG 边长（2x 高清，24 视图盒 → 256px）

// 额外补充：计时器（⏱ 替换为图标）
const EXTRA = {
  'i-clock': `<circle cx="12" cy="12" r="9" fill="url(#gclk-o)"/>
<circle cx="12" cy="12" r="7.2" fill="#fff"/>
<path d="M12 7.4V12l3.2 2" stroke="url(#gclk-h)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
<circle cx="12" cy="12" r="1.4" fill="url(#gclk-h)"/>
<ellipse cx="9" cy="9" rx="2" ry="1.1" fill="#fff" opacity=".25"/>
<linearGradient id="gclk-o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9BE3C4"/><stop offset="1" stop-color="#5FCFA0"/></linearGradient>
<linearGradient id="gclk-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB39E"/><stop offset="1" stop-color="#FF8F7A"/></linearGradient>`
};

function wrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}">${inner}</svg>`;
}

(async () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const re = /<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  const icons = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    icons[m[1]] = m[2];
  }
  // 合并补充图标
  for (const k in EXTRA) icons[k] = EXTRA[k];

  const ids = Object.keys(icons);
  if (!ids.length) throw new Error('未从原型中提取到任何 symbol');

  const report = [];
  for (const id of ids) {
    const svg = wrap(icons[id]);
    const outFile = path.join(OUT, `${id}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outFile);
    const { size } = fs.statSync(outFile);
    report.push({ id, file: `assets/icons/${id}.png`, bytes: size });
  }

  // 生成核对用 HTML
  const cells = report.map(r =>
    `<div class="c"><img src="/${r.file}"/><b>${r.id}</b><small>${(r.bytes/1024).toFixed(1)}KB</small></div>`
  ).join('');
  const sheet = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>图标核对 · ${ids.length} 个</title>
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
<h1>图标资源核对（${ids.length} 个 PNG）</h1>
<p>路径前缀 /assets/icons/ · 256×256 透明 PNG · 风格：清新可爱渐变立体</p>
<div class="grid">${cells}</div>
</body></html>`;
  fs.writeFileSync(path.join(ROOT, 'icon-sheet.html'), sheet);

  console.log('生成图标数:', ids.length);
  console.log('输出目录:', OUT);
  console.log('总计大小:', (report.reduce((s,r)=>s+r.bytes,0)/1024).toFixed(1) + 'KB');
})().catch(e => { console.error('生成失败:', e); process.exit(1); });

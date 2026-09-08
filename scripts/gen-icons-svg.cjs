// scripts/gen-icons-svg.cjs
// 单一真源：一整套「衡力健身记录 / HiLife」主题化 SVG 图标。
// 输出：
//   1) icons/svg/<name>.svg           —— 矢量源文件（master）
//   2) styles/icons.wxss              —— 基于 mask-image 的图标类（微信可用、跟随主题色）
//
// 设计系统（见 ICONS.md）：
//   - 24×24 视窗，内容控制在 2~22，留 1px 安全边
//   - 描边 1.8，round cap / round join，视觉统一
//   - 描边色固定 #000（仅用于 mask 的 alpha）；真实颜色由 .ico 的 background-color 决定
//   - 填充型图标在元素上写 fill="#000"（如 star-on / play / 实心点），mask 下同样表现为不透明
//
// 微信约束：<image> 不渲染 SVG data-URI，但 WXSS 的 mask-image 支持 SVG data-URI，
// 因此用 mask 方案实现「矢量 + 主题色跟随 + 选中态变色」，且无需任何 PNG 栅格化。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVG_DIR = path.join(ROOT, 'icons', 'svg');
const WXSS_OUT = path.join(ROOT, 'styles', 'icons.wxss');

// 每个图标的内层 SVG（path / circle / rect / ellipse 等）。
// 默认会被包裹进 <svg fill="none" stroke="#000" stroke-width="1.8" ...>。
// 需要填充的元素自行写 fill="#000"（可叠加 stroke="none"）。
const ICONS = {
  // —— 导航 / Tab ——
  all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.2 9.6V20h13.6V9.6"/><path d="M9.6 20v-6h4.8v6"/>',
  train: '<path d="M4 9v6"/><path d="M7 7.2v9.6"/><path d="M17 7.2v9.6"/><path d="M20 9v6"/><path d="M7 12h10"/>',
  plan: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4h6v3H9z"/><path d="M8.5 11h7"/><path d="M8.5 15h7"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.6 20c0-3.6 2.9-6 6.4-6s6.4 2.4 6.4 6"/>',

  // —— 通用操作 ——
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.6-4.6"/>',
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="#000"/><circle cx="12" cy="12" r="1.5" fill="#000"/><circle cx="18.5" cy="12" r="1.5" fill="#000"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  arrowleft: '<path d="M14 6l-7 6 7 6"/><path d="M19 12H7"/>',
  arrowright: '<path d="M10 6l7 6-7 6"/><path d="M17 12H5"/>',
  chevrondown: '<path d="M5 9l7 7 7-7"/>',
  chevronup: '<path d="M5 15l7-7 7 7"/>',
  edit: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>',
  delete: '<path d="M4 6.5h16"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5 7.6 20h8.8l1.1-13.5"/><path d="M10 10v7M14 10v7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  share: '<circle cx="6" cy="12" r="2.1" fill="#000"/><circle cx="18" cy="6" r="2.1" fill="#000"/><circle cx="18" cy="18" r="2.1" fill="#000"/><path d="M8 11l8-4M8 13l8 4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.2 5.4"/><path d="M20 5v5h-5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="#000" stroke="none"/>',
  pause: '<rect x="8" y="5" width="2.4" height="14" rx="1.1" fill="#000" stroke="none"/><rect x="13.6" y="5" width="2.4" height="14" rx="1.1" fill="#000" stroke="none"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8.5 7l1.2-2h4.6l1.2 2"/>',
  album: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.5" fill="#000" stroke="none"/><path d="M5 17l4.5-4 3.5 3 3-3 3 3"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M11 8v6M8 11h6"/><path d="M20 20l-3.6-3.6"/>',

  // —— 状态 / 反馈 ——
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.9" fill="#000" stroke="none"/>',
  warning: '<path d="M12 3.5 21.5 20H2.5z"/><path d="M12 10v4.6"/><circle cx="12" cy="17.3" r="0.9" fill="#000" stroke="none"/>',
  success: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.2 10.8 15 16 9.5"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  staron: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9z" fill="#000" stroke="none"/>',
  staroff: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9z"/>',
  flame: '<path d="M12 3c1.4 3-1 4.4-1 6.4a1.6 1.6 0 0 0 1.6 1.6c1.3 0 2-1.3 1.7-2.7 2.1 1.2 3.6 3.6 3.6 6a5.4 5.4 0 1 1-10.8 0C7.1 14.4 9.4 12.5 12 3z"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3"/><path d="M17 6h3v2a3 3 0 0 1-3 3"/><path d="M12 13v3"/><path d="M9.2 20h5.6"/><path d="M10.2 16.5h3.6v3.5h-3.6z"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="#000" stroke="none"/>',
  idea: '<path d="M9 17c-2.4-1.5-3.5-4-3.5-6.4A5.5 5.5 0 0 1 16 10.6c0 2.4-1 5-3.5 6.4"/><path d="M9.6 20h4.8"/><path d="M10.6 17.4h2.8"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="2.6" height="6" rx="0.6" fill="#000" stroke="none"/><rect x="12" y="7" width="2.6" height="10" rx="0.6" fill="#000" stroke="none"/><rect x="17" y="9" width="2.6" height="8" rx="0.6" fill="#000" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trendingup: '<path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>',
  heart: '<path d="M12 20s-7-4.3-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.7 12 20 12 20z"/>',
  hearton: '<path d="M12 20s-7-4.3-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.7 12 20 12 20z" fill="#000" stroke="none"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 9.5h16"/><path d="M8 3.5v3M16 3.5v3"/><path d="M8 14l2 2 4-4"/>',
  lightning: '<path d="M13 2L3 14h9l-1 8L21 10h-9l1-8z" fill="#000" stroke="none"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="#000" stroke="none"/>',
  myaction: '<path d="M3 12h4l2-5 3 9 2-6 2 2h3"/>',
  // 有氧 / 耐力：心率线（供「耐力」目标模板缩略图使用）
  pulse: '<path d="M3 12h4l2-6 4 12 3-8 2 2h3"/>',

  // —— 健身 / 身体部位 ——
  scale: '<rect x="4" y="3.5" width="16" height="3" rx="1.5"/><path d="M12 6.5 7 20h10z"/><circle cx="12" cy="14" r="2"/>',
  body: '<circle cx="12" cy="4.2" r="2"/><path d="M12 6.5v6"/><path d="M12 8.5 7 10M12 8.5 17 10"/><path d="M7 10 5.6 16M17 10l1.4 6"/><path d="M12 12.5 9 20M12 12.5l3 7.5"/>',
  musclefront: '<circle cx="12" cy="4.2" r="2"/><path d="M12 6.5v6"/><path d="M12 8.5 7 10M12 8.5 17 10"/><path d="M7 10 5.6 16M17 10l1.4 6"/><path d="M12 12.5 9 20M12 12.5l3 7.5"/>',
  muscleback: '<circle cx="12" cy="4.2" r="2"/><path d="M12 6.5v13"/><path d="M12 9 6.2 11M12 9l5.8 2"/><path d="M6.2 11l-1 6M17.8 13l1 4"/>',
  arm: '<path d="M7 20 9 9.5a2 2 0 0 1 4 0l.8 5.5h4"/><circle cx="18.6" cy="13.5" r="1.5"/>',
  chest: '<path d="M12 4v5"/><path d="M9 9c0 3-2 4.2-2 7.2M15 9c0 3 2 4.2 2 7.2"/><path d="M12 9 9.4 12.4M12 9l2.6 3.4"/>',
  core: '<circle cx="12" cy="12" r="7.2"/><path d="M12 4.8v14.4M5 12h14"/><path d="M7.5 9h9M7.5 15h9"/>',
  leg: '<path d="M10 3v9l-2 9M14 3v9l2 9"/><path d="M8.2 20h3.6M15.8 20h2.4"/>',
  shoulder: '<path d="M3 14c2-3 6-4 9-4s7 1 9 4"/><path d="M12 10V5"/><circle cx="12" cy="4" r="1.5"/>',
  dumbbell: '<path d="M4 9v6"/><path d="M7 7.2v9.6"/><path d="M17 7.2v9.6"/><path d="M20 9v6"/><path d="M7 12h10"/>',

  // —— 饮食 / 食物 ——
  foodbowl: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z"/><path d="M3.5 11h17"/><path d="M12 11V7.5M12 7.5c0-1.4 1.4-2 2.4-1.5"/>',
  foodegg: '<ellipse cx="12" cy="14" rx="7" ry="5.4"/><circle cx="12" cy="13" r="2.4" fill="#000" stroke="none"/>',
  foodfish: '<path d="M3 12c3-4 9-4 12 0-3 4-9 4-12 0z"/><path d="M15 12l5-3v6z"/><circle cx="7" cy="11" r="0.8" fill="#000" stroke="none"/>',
  foodmeat: '<path d="M5 9c0-3 3-4 5-2 1-2 4-1 4 1 2 0 3 2 2 4-1 3-5 4-8 3-3 0-5-2-5-4z"/><path d="M14 14l4 4"/>',
  foodnoodle: '<path d="M4 9h16v3a6 6 0 0 1-12 0"/><path d="M4 9c0-2 2-3 4-3h8c2 0 4 1 4 3"/><path d="M8 12c0 2.6 1 4.4 4 4.4s4-1.8 4-4.4"/>',
  foodrice: '<path d="M4 11h16v3a6 6 0 0 1-12 0"/><path d="M4 11c0-2 2-3 4-3h8c2 0 4 1 4 3"/><path d="M7 8.2v-2M12 8.2V5.5M17 8.2v-2"/>',
  foodsalad: '<path d="M4 13h16a7 7 0 0 1-14 0z"/><path d="M8 13c0-3 1-5 4-5s4 2 4 5"/><path d="M12 8V5"/>',
  veg: '<path d="M12 20c-4 0-6-2.5-6-6 0-4 3-7 6-9 3 2 6 5 6 9 0 3.5-2 6-6 6z"/><path d="M12 20v-7"/>',
  breakfast: '<path d="M4 11h13v2a6 6 0 0 1-12 0"/><path d="M17 11h2.5"/><path d="M9 9c0-2 1.5-3 3-3s3 1 3 3"/>',
  lunch: '<path d="M5 8h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M5 8 4 5h16l-1 3"/><path d="M9 12.5h6"/>',
  dinner: '<path d="M6 4v6a2 2 0 0 0 4 0V4M8 4v16"/><path d="M15 4c2 0 3 2 3 5s-1 4-3 4M15 13v7"/>',
  snack: '<path d="M5 10h14v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M5 10c0-2 1.5-3 3.5-3M19 10c0-2-1.5-3-3.5-3"/>',
  diet: '<path d="M12 8c-1-3-4-3-5-1-1 2 1 5 5 6 4-1 6-4 5-6-1-2-4-2-5 1z"/><path d="M12 8V5"/><path d="M12 5c1-1 2-1 3 0"/>',
  water: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/><path d="M9.2 14a3 3 0 0 0 2.8 3"/>',
};

// 把内层 SVG 包成完整 <svg>，并生成 mask 用的 data-URI（单引号属性 + 最小编码）
function buildSvg(inner) {
  return '<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'#000\' stroke-width=\'1.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\'>' + inner + '</svg>';
}
// mask-image 用的 data-URI：仅编码 < > # 与引号外的安全字符; 单引号已用于属性
function toDataUri(svg) {
  const enc = svg
    .replace(/ /g, '%20')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/"/g, '%22')
    .replace(/'/g, '%27');
  return 'data:image/svg+xml,' + enc;
}

fs.mkdirSync(SVG_DIR, { recursive: true });
fs.mkdirSync(path.dirname(WXSS_OUT), { recursive: true });

const names = Object.keys(ICONS);
let wxss = '/* AUTO-GENERATED by scripts/gen-icons-svg.cjs —— 主题化 SVG 图标（mask 方案，跟随主题色） */\n';
wxss += '/* 用法: <view class="ico ico-home"></view>  颜色由 background-color 决定，选中态加 .ico--primary */\n\n';
wxss += '.ico{ display:inline-block; width:48rpx; height:48rpx; background-color:var(--text-sub);\n';
wxss += '  -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;\n';
wxss += '  -webkit-mask-position:center; mask-position:center;\n';
wxss += '  -webkit-mask-size:contain; mask-size:contain; }\n';
wxss += '.ico--primary{ background-color:var(--primary); }\n';
wxss += '.ico--ink{ background-color:var(--text); }\n';
wxss += '.ico--muted{ background-color:var(--text-weak); }\n';
wxss += '.ico--success{ background-color:var(--success); }\n';
wxss += '.ico--warning{ background-color:var(--warning); }\n';
wxss += '.ico--info{ background-color:var(--info); }\n';
wxss += '.ico--accent{ background-color:var(--accent); }\n\n';

for (const name of names) {
  const svg = buildSvg(ICONS[name]);
  fs.writeFileSync(path.join(SVG_DIR, name + '.svg'), svg + '\n');
  const uri = toDataUri(svg);
  wxss += '.ico-' + name + '{ -webkit-mask-image:url("' + uri + '"); mask-image:url("' + uri + '"); }\n';
}

fs.writeFileSync(WXSS_OUT, wxss);

// 浏览器预览页：直接看整套图标形状（在浏览器打开 icons/preview.html）
const PREVIEW = path.join(ROOT, 'icons', 'preview.html');
let cards = '';
for (const name of names) {
  const svg = buildSvg(ICONS[name]);
  cards += '<div class="cell"><div class="ink">' + svg + '</div><div class="nm">' + name + '</div></div>';
}
const previewHtml = '<!doctype html><html lang="zh"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>HiLife 图标预览</title><style>'
  + 'body{margin:0;background:#F7F7F5;color:#0A0A0A;font:14px/1.5 -apple-system,system-ui,sans-serif;padding:24px}'
  + 'h1{font-size:20px;margin:0 0 4px}.sub{color:#A0A0A0;margin:0 0 20px}'
  + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:12px}'
  + '.cell{background:#fff;border:1px solid #E8E8E4;border-radius:16px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px}'
  + '.ink{width:40px;height:40px;color:#0A0A0A}.ink svg{width:100%;height:100%}'
  + '.nm{font-size:11px;color:#707070;word-break:break-all;text-align:center}'
  + '</style></head><body><h1>HiLife 图标集</h1><p class="sub">' + names.length + ' icons · 24×24 · 荧光绿主题 · mask 方案跟随主题色</p>'
  + '<div class="grid">' + cards + '</div></body></html>';
fs.writeFileSync(PREVIEW, previewHtml);

console.log('wrote', names.length, 'svg icons ->', SVG_DIR);
console.log('wrote', WXSS_OUT);
console.log('wrote', PREVIEW);

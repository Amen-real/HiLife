// scripts/gen-sharecard-preview.cjs
// 分享卡版式预览：把 utils/shareCard.js 产出的**同一份 ops** 直接翻成 SVG 输出成 HTML。
//
// 为什么这样做而不是在 HTML 里重画一遍：
//   重画 = 第二份实现，稿子好看而真机出图不一样（这个坑本项目踩过）。
//   这里 ops 是 layout() 的真实输出，几何/配色/文案与 canvas 完全相同 ——
//   唯一差异是字体渲染引擎（SVG 用浏览器字体，canvas 用微信内置 sans-serif），
//   故本预览可用于**验收版式**、不能用于验收字宽。字宽越界由守卫的 estWidth 断言负责。
//
// 用法：node scripts/gen-sharecard-preview.cjs
// 产出：deliverables/sharecard-ref-layout-preview.html
const fs = require('fs');
const path = require('path');
const shareCard = require('../utils/shareCard.js');
const bodymap = require('../utils/bodymap.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'deliverables', 'sharecard-ref-layout-preview.html');

/* ===== ops → SVG ===== */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function anchorOf(align) {
  if (align === 'right') return 'end';
  if (align === 'center') return 'middle';
  return 'start';
}

function svgBody(shapes, op) {
  const g = [];
  g.push('<g transform="translate(' + op.x + ',' + op.y + ') scale(' + op.scale + ')'
    + (shapes.xOffset ? ' translate(' + shapes.xOffset + ',0)' : '') + '">');
  const defs = [shapes.outline].concat(shapes.parts);
  defs.forEach(s => {
    g.push('<path d="' + esc(s.d) + '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="' + (s.lw || 2) + '" stroke-linejoin="round"/>');
  });
  g.push('</g>');
  return g.join('\n');
}

function opToSvg(op, m, pal) {
  if (op.t === 'rect') {
    return '<rect x="' + op.x + '" y="' + op.y + '" width="' + op.w + '" height="' + op.h + '" rx="' + (op.r || 0)
      + '" fill="' + (op.fill || 'none') + '"' + (op.stroke ? ' stroke="' + op.stroke + '" stroke-width="' + (op.lw || 1) + '"' : '') + '/>';
  }
  if (op.t === 'circle') {
    return '<circle cx="' + op.cx + '" cy="' + op.cy + '" r="' + op.r + '" fill="' + op.fill + '"/>';
  }
  if (op.t === 'line') {
    return '<line x1="' + op.x1 + '" y1="' + op.y1 + '" x2="' + op.x2 + '" y2="' + op.y2 + '" stroke="' + op.color + '" stroke-width="' + (op.lw || 1) + '"/>';
  }
  if (op.t === 'body') {
    const shapes = bodymap.bodyPaths(op.side, new Set(op.slugs), pal.anat);
    return svgBody(shapes, op);
  }
  if (op.t === 'text') {
    // background rect 仅供校对「这条字压在哪块底色上」，真实出图没有它
    const w = shareCard.estWidth(op.s, op.size);
    const x0 = op.align === 'right' ? op.x - w : (op.align === 'center' ? op.x - w / 2 : op.x);
    const bg = '<rect x="' + x0.toFixed(1) + '" y="' + (op.y - op.size * 0.66).toFixed(1) + '" width="' + w.toFixed(1)
      + '" height="' + (op.size * 1.32).toFixed(1) + '" fill="' + (op.bg || 'none') + '"/>';
    return bg + '<text x="' + op.x + '" y="' + op.y + '" font-size="' + op.size + '" font-weight="' + (op.weight || 400)
      + '" fill="' + op.color + '" text-anchor="' + anchorOf(op.align) + '" dominant-baseline="central"'
      + ' font-family="PingFang SC, Inter, system-ui, sans-serif">' + esc(op.s) + '</text>';
  }
  return '';
}

function cardSvg(m, opts) {
  const L = shareCard.layout(m);
  const pal = shareCard.PALETTES[m.style];
  const svg = [];
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + (L.w / 2) + '" height="' + (L.h / 2) + '">');
  svg.push('<rect x="0" y="0" width="' + L.w + '" height="' + L.h + '" fill="' + pal.bg + '"/>');
  if (opts && opts.debugBg) {
    L.ops.forEach(o => { if (o.t === 'text') svg.push(opToSvg(Object.assign({}, o, { bg: pal.border }), m, pal)); });
  } else {
    L.ops.forEach(o => svg.push(opToSvg(o, m, pal)));
  }
  svg.push('</svg>');
  return { svg: svg.join('\n'), h: L.h, ops: L.ops.length };
}

/* ===== 演示数据（与 dump-sharecard-ops.cjs 共用同一份） ===== */
const CASES = require('./lib/sharecard-demo.cjs').cases();

/* ===== 输出 ===== */

const blocks = CASES.map(c => {
  const m = shareCard.buildModel(c.args);
  const r = cardSvg(m);
  const meta = [];
  meta.push('高 ' + r.h + 'px · ' + r.ops + ' ops');
  meta.push('连续 ' + m.streakDays + ' 天 · ' + m.actionCount + ' 动作 · ' + m.totalSets + ' 组');
  meta.push('解剖高亮：前 ' + m.anatomy.front.length + ' 个 slug / 后 ' + m.anatomy.back.length + ' 个');
  if (m.merged) meta.push('已合并当天');
  if (m.pbs.length) meta.push('破纪录 ' + m.pbs.length + ' 项');
  return '<figure class="fig">'
    + '<figcaption><b>' + esc(c.title) + '</b><span>' + esc(meta.join(' · ')) + '</span></figcaption>'
    + r.svg
    + '</figure>';
}).join('\n');

const html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
  + '<title>HiLife 分享卡 · 版式预览</title>\n<style>\n'
  + ':root{color-scheme:dark}body{margin:0;padding:32px;background:#111;color:#e9e9e6;'
  + 'font-family:"PingFang SC",Inter,system-ui,sans-serif}'
  + 'h1{font-size:18px;margin:0 0 6px}.sub{font-size:12px;color:#9a9a94;margin:0 0 28px;line-height:1.7;max-width:900px}'
  + '.grid{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}'
  + '.fig{margin:0;background:#000;padding:12px;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.5)}'
  + 'figcaption{font-size:12px;margin-bottom:10px;display:flex;flex-direction:column;gap:3px;max-width:375px}'
  + 'figcaption span{color:#8d8d87;line-height:1.5}'
  + 'svg{display:block;border-radius:8px}'
  + '</style>\n</head>\n<body>\n'
  + '<h1>HiLife 训练分享卡 · 版式预览</h1>\n'
  + '<p class="sub">本页由 <code>scripts/gen-sharecard-preview.cjs</code> 生成：每张图都是 '
  + '<code>utils/shareCard.js</code> 真实 <code>layout()</code> 输出的 ops 直译成 SVG，'
  + '因此几何与配色和真机 canvas 出图一致（唯一差异是字体渲染引擎，字宽越界由守卫的 estWidth 断言负责）。'
  + '淡色方块是「这条字压在哪块底色上」的校对标记之外的底色本身，不是额外图元。</p>\n'
  + '<div class="grid">\n' + blocks + '\n</div>\n</body>\n</html>\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('written:', path.relative(ROOT, OUT));
CASES.forEach(c => {
  const m = shareCard.buildModel(c.args);
  console.log('  ' + c.title + ' -> ' + shareCard.measure(m) + 'px, style=' + m.style + ', merged=' + m.merged + ', rows=' + m.rows.length);
});

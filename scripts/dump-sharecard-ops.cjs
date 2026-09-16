// scripts/dump-sharecard-ops.cjs
// 把 shareCard 的 ops 导成 JSON，交给 scripts/render-sharecard.py 用 PIL 画成 PNG —— 
// 目的是让「版式好不好看」这件事可以被真的看见，而不是靠脑补坐标。
//
// 解剖路径在这里就被**拍平成折线**（卡片坐标系），Python 侧只画多边形，不再解析 path。
const fs = require('fs');
const path = require('path');
const shareCard = require('../utils/shareCard.js');
const bodymap = require('../utils/bodymap.js');

const ROOT = path.join(__dirname, '..');
// 产物落在 scripts/_out/ —— 本仓 `scripts` 是 folder 级打包忽略目录。
// 曾经直接写在仓库根，1.4MB 的 JSON + 十几张 PNG 会被算进主包（`scan-main-package.cjs` 直接超限 3.5MB）。
const OUT_DIR = path.join(__dirname, '_out');
const OUT = path.join(OUT_DIR, 'sharecard-ops.json');

// 用记录式 ctx 把 path 拍平成折线：贝塞尔按固定段数细分（预览用，精度足够）
function flatten(d, seg) {
  const polys = [];
  let cur = null;
  let cx = 0, cy = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lastCurve = '';
  const push = (x, y) => { if (cur) cur.push([round(x), round(y)]); };
  const round = v => Math.round(v * 100) / 100;
  const rec = {
    moveTo(x, y) { if (cur && cur.length > 1) polys.push(cur); cur = [[round(x), round(y)]]; sx = x; sy = y; cx = x; cy = y; },
    lineTo(x, y) { if (!cur) cur = [[round(cx), round(cy)]]; push(x, y); cx = x; cy = y; },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      if (!cur) cur = [[round(cx), round(cy)]];
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, mt = 1 - t;
        const bx = mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x;
        const by = mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y;
        push(bx, by);
      }
      lcx = x2; lcy = y2; lastCurve = 'C'; cx = x; cy = y;
    },
    quadraticCurveTo(x1, y1, x, y) {
      if (!cur) cur = [[round(cx), round(cy)]];
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, mt = 1 - t;
        const bx = mt * mt * cx + 2 * mt * t * x1 + t * t * x;
        const by = mt * mt * cy + 2 * mt * t * y1 + t * t * y;
        push(bx, by);
      }
      lcx = x1; lcy = y1; lastCurve = 'Q'; cx = x; cy = y;
    },
    closePath() { if (cur) { cur.push([round(sx), round(sy)]); polys.push(cur); cur = null; } }
  };
  // 借 bodymap 的同一个 path 解析器（低层导出，仅供工具链用）
  void lcx; void lcy; void lastCurve;
  bodymap.parsePath(rec, d);
  if (cur && cur.length > 1) polys.push(cur);
  return polys;
}

function bodyPolys(side, slugs, pal, op) {
  const shapes = bodymap.bodyPaths(side, new Set(slugs), pal.anat);
  const out = [];
  const defs = [shapes.outline].concat(shapes.parts);
  defs.forEach(s => {
    const polys = flatten(s.d, 8).map(poly => poly.map(([x, y]) => [
      Math.round((op.x + (x + shapes.xOffset) * op.scale) * 100) / 100,
      Math.round((op.y + y * op.scale) * 100) / 100
    ]));
    out.push({ fill: s.fill, stroke: s.stroke, lw: Math.max(1, (s.lw || 2) * op.scale), polys: polys });
  });
  return out;
}

function dumpCase(title, args) {
  const m = shareCard.buildModel(args);
  const L = shareCard.layout(m);
  const pal = shareCard.PALETTES[m.style];
  const ops = L.ops.map(op => {
    if (op.t !== 'body') return op;
    return Object.assign({}, op, { polys: bodyPolys(op.side, op.slugs, pal, op) });
  });
  return { title: title, w: L.w, h: L.h, bg: pal.bg, ops: ops };
}

/* ===== 演示用例（与 gen-sharecard-preview.cjs 共用 scripts/lib/sharecard-demo.cjs） ===== */
const DEMO = require('./lib/sharecard-demo.cjs');
const CASES = DEMO.cases();

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(CASES.map(c => dumpCase(c.title, c.args)), null, 0), 'utf8');
console.log('written:', path.relative(ROOT, OUT));

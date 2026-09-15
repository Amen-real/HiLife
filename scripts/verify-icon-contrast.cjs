// scripts/verify-icon-contrast.cjs —— 图标对比度红线守卫（亮绿图标禁压浅底）
//
// 背景（真实事故）：首页「今日推荐」卡的 92rpx 圆角图标底是 --n-100(#F1F1EE)，
//   图标却用了 .ico--primary（--primary #C8FF00）→ 对比度 ≈1.05:1，真机上「看不见」。
//   同类问题同时在 training 的「添加」圆钮（白底 #FFFFFF 上压亮绿）和
//   workout 的完成态奖杯（页面底 --n-50 #F7F7F5 上压亮绿）各出现一次。
//
// 为什么只有 --primary 需要特判：其它 ico--xxx 修饰色都取 var(--text*) / var(--success) …
//   这些 token 在 .page.theme-dark 里被重定义（浅墨 → 白），深浅两套底色各自自洽。
//   唯独 --primary = #C8FF00 **不随主题翻转**（app.wxss 与各页深色块均未重定义），
//   于是它只在「深底」或「绿底」上合法，压在任何浅中性底上必然隐形。
//
// 覆盖三件事：
//   [A] 通用红线：任何 .ico--primary 的最近包裹容器，其背景不得是浅中性色（静态解析）
//   [B] 事故回归：三处已修复点必须保持 ico--ink
//   [C] 模式备案：绿图标若要保留，必须走「容器给绿底」的显式写法（.ico--ink 底色覆盖为 --primary）
//
// 用法：node scripts/verify-icon-contrast.cjs   （退出码 0=全绿，1=有失败）
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0, warn = 0;
function ok() { pass++; }
function bad(msg) { fail++; console.log('  ✗ ' + msg); }
function info(msg) { warn++; console.log('  ! ' + msg); }
function eq(actual, expect, label) {
  if (actual === expect) ok();
  else bad(label + '：期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual));
}
function truthy(v, label) { if (v) ok(); else bad(label); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { try { fs.accessSync(p); return true; } catch (e) { return false; } }
// 读 wxss 一律先剥注释：本守卫用「朴素正则」切规则（/[^{}]+\{[^{}]*\}/），
// 注释里只要出现一个花括号（例如说明文字写了「page{}」），后续规则的边界就会整体错位。
function readCss(p) {
  return read(p).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/* ---------- 1. 收集所有 wxml（页面 + 组件） ---------- */
function walk(dir, out) {
  if (!exists(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.wxml')) out.push(full);
  }
  return out;
}
const WXMLS = walk(path.join(ROOT, 'pages'), []).concat(walk(path.join(ROOT, 'components'), []));
const APP_WXSS = readCss(path.join(ROOT, 'app.wxss'));

/* ---------- 2. 浅色 token 名 → 判定 ---------- */
// 浅中性 token 白名单：这些在**浅色主题**下都是亮底（深色块里会被重定义，但那里配的是 ink 而非 primary）
const LIGHT_TOKENS = [
  '--n-50', '--n-100', '--n-200', '--n-300', '--n-400',
  '--white', '--card', '--card-gray', '--bg', '--bg-muted', '--glass', '--glass-strong',
  '--primary-tint'   // 12% 透明绿压在浅底上仍是亮底，亮绿图标压上去同样糊
];
// 合法底：亮绿本体 / 明确浅底之外的一切
const GREEN_TOKENS = ['--primary'];

// hex 相对亮度（sRGB，够用即可）
function lum(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/* ---------- 3. 取某个类的 background 声明（页面 wxss 优先，其次 app.wxss） ---------- */
function bgOfClass(cls, wxssTexts) {
  // 匹配「选择器末位是 .cls」的规则，返回最后一条命中的 background 值（近似 CSS 层叠）
  let found = null;
  const re = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\s*(?:,[^{]*)?\\{([^}]*)\\}', 'g');
  for (const text of wxssTexts) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const body = m[1];
      const b = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body);
      if (b) found = b[1].trim();
    }
  }
  return found;
}

/* ---------- 4. 判定某背景值在浅色主题下是否「亮底」 ---------- */
function judgeBg(value) {
  if (!value) return 'unknown';
  const v = value.trim();
  const tok = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (tok) {
    const name = tok[1];
    if (GREEN_TOKENS.indexOf(name) >= 0) return 'green';
    if (LIGHT_TOKENS.indexOf(name) >= 0) return 'light';
    return 'unknown';
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    const L = lum(v);
    if (L === null) return 'unknown';
    return L > 0.5 ? 'light' : 'dark';
  }
  if (/^(#fff|white|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i.test(v)) return 'light';
  return 'unknown';
}

/* ---------- 3b. 兜底：页面根底（.page → page） ---------- */
function pageBg(texts) {
  const b = bgOfClass('page', texts);
  if (b) return b;
  // app.wxss 里原生 page 选择器
  const m = /(?:^|\n)\s*page\s*\{([^}]*)\}/.exec(APP_WXSS);
  if (m) {
    const bb = /background(?:-color)?\s*:\s*([^;]+)/.exec(m[1]);
    if (bb) return bb[1].trim();
  }
  return null;
}

/* ══════════════ [A] 通用红线 ══════════════ */
console.log('[A] .ico--primary 不得压在浅中性底上');

let scanned = 0;
for (const wxml of WXMLS) {
  // 关键：先剥掉 wxml 注释，否则「禁用 ico--primary」这类说明文字会被当成真实用法
  const src = read(wxml).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const pageWxss = wxml.replace(/\.wxml$/, '.wxss');
  const texts = [readCss(pageWxss), APP_WXSS].filter(t => !!t);
  const rel = path.relative(ROOT, wxml).replace(/\\/g, '/');

  const re = /ico--primary/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    scanned++;
    const lineNo = src.slice(0, m.index).split('\n').length;
    // 最近的前置包裹容器：往回找最后一个 class="..." 的 view
    const before = src.slice(0, m.index);
    let wrapCls = '';
    let idx = before.lastIndexOf('<view');
    while (idx >= 0) {
      const tagEnd = before.indexOf('>', idx);
      const tag = before.slice(idx, tagEnd < 0 ? before.length : tagEnd);
      const c = /class="([^"]*)"/.exec(tag);
      if (c) { wrapCls = c[1]; break; }
      idx = before.lastIndexOf('<view', idx - 1);
    }
    const tokens = wrapCls.split(/\s+/).filter(t => t && t.indexOf('{{') < 0);
    let verdict = 'unknown', hitCls = '';
    // 从后往前试（复合选择器通常写在最后一段）
    for (let i = tokens.length - 1; i >= 0; i--) {
      const bg = bgOfClass(tokens[i], texts);
      if (bg) { verdict = judgeBg(bg); hitCls = tokens[i] + ' → background: ' + bg; break; }
    }
    // 容器没写背景 → 退到页面底色
    if (verdict === 'unknown') {
      const pb = pageBg(texts);
      if (pb) { verdict = judgeBg(pb); hitCls = '页面底色 → background: ' + pb; }
    }
    if (verdict === 'light') {
      bad(rel + ':' + lineNo + ' .ico--primary 压在浅底上（' + hitCls + '）。请改用 ico--ink，或把容器底改成绿/深底');
    } else if (verdict === 'unknown') {
      info(rel + ':' + lineNo + ' .ico--primary 的容器底无法静态判定（容器 class="' + wrapCls + '"）——请显式给容器背景，或直接改用 ico--ink');
    } else {
      ok();
    }
  }
}
if (scanned === 0) {
  console.log('  · 当前全仓 wxml 中 .ico--primary 出现 0 次（亮绿图标一律由容器绿底 + ico--ink 实现）');
  ok();
}

/* ══════════════ [B] 事故回归：三处已修复点 ══════════════ */
console.log('[B] 事故回归：三处图标必须保持 ico--ink');

const SPOTS = [
  ['pages/home/home.wxml', 'ico-train', '首页「今日推荐」卡图标（01-home.html 设计稿 = #0A0A0A）'],
  ['pages/training/training.wxml', 'ico-plus', '动作库「添加」圆钮图标（白底 92rpx 圆）'],
  ['pages/workout/workout.wxml', 'ico-trophy', '训练完成态奖杯（页面底色上）']
];
for (const [rel, ico, desc] of SPOTS) {
  const src = read(path.join(ROOT, rel));   // wxml：原样读，注释由 [A] 自行处理
  const re = new RegExp('class="ico[^"]*' + ico + '[^"]*"');
  const m = re.exec(src);
  truthy(m, rel + ' 找不到 .' + ico + '（' + desc + '）');
  if (m) {
    truthy(/\bico--ink\b/.test(m[0]), rel + ' 的 .' + ico + ' 应为 ico--ink，实际 class="' + m[0] + '"');
    truthy(!/\bico--primary\b/.test(m[0]), rel + ' 的 .' + ico + ' 又用回 ico--primary 了');
  }
}

/* ══════════════ [C] 容器底色备案：这三处容器确认是浅底 ══════════════ */
console.log('[C] 容器底色备案（若哪天改成绿底，[B] 的 ink 结论需同步复核）');

const CONTAINERS = [
  // 首页芯片已从 --n-100 改为品牌淡绿底 + 亮绿描边（见 [E]：--n-100 压 --card-gray 只差 2/255 = 没有底）
  ['pages/home/home.wxss', '.suggest .photo', 'var(--primary-tint)'],
  ['pages/training/training.wxss', '.cat-add .ic', 'var(--white)'],
  ['pages/workout/workout.wxss', '.done-emoji', null] // 无背景 → 继承页面底色
];
for (const [rel, sel, expect] of CONTAINERS) {
  const text = readCss(path.join(ROOT, rel));
  if (expect === null) {
    // 无背景声明：断言它确实没有 background（透明 → 落到页面底色）
    const re = new RegExp(sel.replace(/[.\s]/g, s => s === '.' ? '\\.' : '\\s') + '\\s*\\{([^}]*)\\}');
    const m = re.exec(text);
    truthy(m, rel + ' 找不到 ' + sel);
    if (m) truthy(!/background/.test(m[1]), rel + ' 的 ' + sel + ' 不应有 background（原设计走页面底色），实际：' + m[1].trim());
  } else {
    const esc = sel.replace(/\./g, '\\.').replace(/\s+/g, '\\s*');
    const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(text);
    truthy(m, rel + ' 找不到 ' + sel);
    if (m) truthy(m[1].indexOf(expect) >= 0, rel + ' 的 ' + sel + ' 背景应为 ' + expect + '，实际：' + m[1].trim());
  }
}

/* ══════════════ [E] 芯片可辨性：卡内 chip 的底必须与「卡底」有可感知差异 ══════════════
   事故：.suggest .photo 用 --n-100(#F1F1EE) 压在 --card-gray(#EFEFEB) 上，差 2/255
   → 用户观感是「背景是透明的」；深色下 #1E1E1E vs #1E1E1E 更是完全相同。
   判据：把两层的实际颜色（含 rgba 叠底）解出来，逐通道最大差 Δ 必须 ≥ 10/255。 */
console.log('[E] 芯片 vs 卡底：必须可辨（Δ ≥ 10/255）');

function parseColor(v) {
  v = String(v == null ? '' : v).trim();
  let m = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
function collectVars(body, into) {
  const re = /(--[\w-]+)\s*:\s*([^;]+)/g; let m;
  while ((m = re.exec(body)) !== null) into[m[1]] = m[2].trim();
}
function buildThemeMaps(wxssPath) {
  const light = {}, dark = {};
  const base = /(?:^|\n)\s*page\s*\{([^}]*)\}/.exec(APP_WXSS);
  if (base) collectVars(base[1], light);
  const text = readCss(wxssPath);
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(text)) !== null) {
    if (/\.theme-dark/.test(m[1])) collectVars(m[2], dark);
    else collectVars(m[2], light);   // 页面浅色也补进 light（如 --lime / 局部覆盖）
  }
  return { light, dark };
}
function resolveVar(value, map) {
  let v = String(value == null ? '' : value).trim();
  for (let i = 0; i < 6; i++) {
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v);
    if (!m) break;
    v = (map[m[1]] !== undefined ? map[m[1]] : (m[2] || '')).trim();
  }
  return parseColor(v);
}
function over(fg, bg) {  // rgba 叠在实底上
  if (!fg) return null;
  if (!bg || fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1
  };
}
function rangeOf(text, sel) {
  const esc = sel.replace(/\./g, '\\.').replace(/\s+/g, '\\s*');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(text);
  if (!m) return null;
  const b = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(m[1]);
  return b ? b[1].trim() : null;
}

const CHIPS = [
  ['pages/home/home.wxss', '.suggest', '.suggest .photo', '首页「今日推荐」图标芯片']
];
for (const [rel, cardSel, chipSel, desc] of CHIPS) {
  const full = path.join(ROOT, rel);
  const text = readCss(full);
  const maps = buildThemeMaps(full);
  for (const theme of ['light', 'dark']) {
    const map = maps[theme];
    const cardBase = over(resolveVar(rangeOf(text, cardSel), map), { r: 255, g: 255, b: 255, a: 1 });
    const chipRaw = resolveVar(rangeOf(text, chipSel), map);
    const chip = over(chipRaw, cardBase);
    if (!cardBase || !chip) { bad(desc + '（' + theme + '）颜色解析失败：card=' + rangeOf(text, cardSel) + ' chip=' + rangeOf(text, chipSel)); continue; }
    const d = Math.max(Math.abs(chip.r - cardBase.r), Math.abs(chip.g - cardBase.g), Math.abs(chip.b - cardBase.b));
    const hex = c => '#' + [c.r, c.g, c.b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (d >= 10) ok();
    else bad(desc + '（' + theme + '）芯片底与卡底几乎同色：chip ' + hex(chip) + ' vs card ' + hex(cardBase) + '（Δ=' + d + '/255，需要 ≥10）');
  }
  // 描边：让芯片边界在两种主题下都确定，不依赖底色差值
  const chipBody = (new RegExp(chipSel.replace(/\./g, '\\.').replace(/\s+/g, '\\s*') + '\\s*\\{([^}]*)\\}').exec(text) || [, ''])[1];
  truthy(/border\s*:\s*[^;]*var\(--primary\)/.test(chipBody), desc + ' 应有 var(--primary) 描边（保证两主题都有确定边界），实际：' + chipBody.trim());
}

/* ══════════════ [F] 浅色值 token 必须在深色块里重定义 ══════════════
   page{} 里的 --primary-tint(#F2FFD6) / --primary-text(#4C7300) 都**不随主题自动翻转**，
   页面一旦用了它们，就必须在本页 .page.theme-dark 内重定义，否则深色下拿到浅色值。
   （全仓审计见 scripts/scan-dark-token-gaps.cjs） */
console.log('[F] home.wxss 用到的浅色值 token 必须在深色块内重定义');

const HOME_WXSS = path.join(ROOT, 'pages/home/home.wxss');
const homeText = readCss(HOME_WXSS);
const homeDark = (function () {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(homeText)) !== null) if (/\.theme-dark/.test(m[1])) out.push(m[2]);
  return out.join('\n');
})();
for (const tok of ['--primary-tint', '--primary-text']) {
  const used = new RegExp('var\\(\\s*' + tok.replace(/-/g, '\\-') + '\\s*\\)').test(homeText);
  if (!used) continue;
  truthy(new RegExp(tok.replace(/-/g, '\\-') + '\\s*:').test(homeDark),
    'home.wxss 用到 ' + tok + '，但 .page.theme-dark 块里没重定义它 → 深色下会拿到浅色值');
}

/* ══════════════ [D] 深色主题下 ink 必须翻白（否则白底/浅底上白图标消失） ══════════════ */
console.log('[D] 深色主题：ico--ink 必须翻白');

function hasDarkInkFlip(wxmlRel) {
  const wxssRel = wxmlRel.replace(/\.wxml$/, '.wxss');
  const text = readCss(path.join(ROOT, wxssRel));
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rules.exec(text)) !== null) {
    const sel = m[1], body = m[2];
    if (!/\.theme-dark/.test(sel)) continue;
    // 命中方式一：显式 .theme-dark ... .ico--ink { background-color: #FFFFFF }
    if (/\.ico--ink/.test(sel) && /background(?:-color)?\s*:\s*#FFFFFF|background(?:-color)?\s*:\s*var\(--n-9/i.test(body)) return true;
    // 命中方式二：深色块把 --text 重定义为白 → .ico--ink{background-color:var(--text)} 自动翻白
    if (/--text\s*:\s*#FFFFFF/i.test(body)) return true;
  }
  return false;
}
for (const [rel] of SPOTS) {
  truthy(hasDarkInkFlip(rel), rel.replace(/\.wxml$/, '.wxss') + ' 的 .ico--ink 在深色下没有翻白路径（--text 未重定义，也没有显式覆盖）');
}

/* ---------- 汇总 ---------- */
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' verify-icon-contrast: ' + pass + ' passed, ' + fail + ' failed' + (warn ? ', ' + warn + ' warning(s)' : ''));
process.exit(fail === 0 ? 0 : 1);

/**
 * scripts/lib/dark-contrast.cjs —— 深色主题对比度分析的共享底座
 *
 * 被两个脚本共用：
 *   · scripts/scan-dark-token-gaps.cjs —— 自动发现可疑点（全仓扫，不必手维护清单）
 *   · scripts/check-dark-contrast.cjs  —— 人工精选点 + 成因批注的「黄金清单」
 *
 * 为什么必须算真实对比度，而不是「token 没翻转」就报缺口：
 *   后者会产出**危险的假阳性**。最典型：
 *     .btn-primary { background: var(--primary); color: var(--primary-ink); }
 *   这是「亮绿底 + #0A0A0A 字」= 16.74:1，两种主题下都成立且必须保持 ——
 *   按「没翻转就报」的逻辑它会要求深色下翻 --primary-ink，那会变成白字压亮绿 ≈1.3:1，
 *   比不改还糟。所以判定必须落到「渲染出来的前景/背景对比度」上。
 *
 * 组件的作用域问题：组件（如 training-review）**不能**自己写 .page.theme-dark
 *   —— 组件样式有作用域，选不中宿主页根节点。所以组件的深色值必须从宿主页解析，
 *   一个组件被 N 个页用就要算 N 次（本模块的 hostPagesOf 负责查宿主）。
 */
const fs = require('fs');
const path = require('path');

const MIN_TEXT = 4.5;   // WCAG AA 正文
const MIN_LARGE = 3.0;  // AA 大号/粗体

// ---------- 颜色 ----------
function parseColor(v) {
  const s = String(v || '').trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
/** 把（可能半透明的）c 合成到不透明实底 base 上 */
function over(c, base) {
  if (!c) return base;
  if (c.a >= 1) return c;
  return {
    r: Math.round(c.r * c.a + base.r * (1 - c.a)),
    g: Math.round(c.g * c.a + base.g * (1 - c.a)),
    b: Math.round(c.b * c.a + base.b * (1 - c.a)),
    a: 1
  };
}
function lum(c) {
  const f = v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const hex = c => c ? '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() : '—';

// ---------- CSS 解析 ----------
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

function tokensIn(text) {
  const out = {};
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/** 取 .page.theme-dark { ... } 的块体（花括号配平，避开注释里的字样） */
function darkBlockOf(cssText) {
  const s = stripComments(cssText);
  const m = s.match(/\.page\.theme-dark\s*\{/);
  if (!m) return '';
  const open = s.indexOf('{', m.index);
  let d = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return s.slice(open + 1, k); }
  }
  return '';
}

/**
 * 合并文件里**所有** `.page.theme-dark` 块的 token 声明。
 *
 * 为什么不能只取第一块：选择器列表可以跨行，例如
 *     .page.theme-dark,
 *     .repl-mask.theme-dark {
 *       --card: #161616;
 *       ...
 *     }
 * 此时 `.page.theme-dark` 后面跟的是逗号而不是大括号，用「紧跟 `{`」的匹配会**整块漏掉**，
 * 于是把已翻转的 token 误判成「没翻转」（曾经因此给 workout 加了重复声明）。
 * 正确做法：把选择器按逗号拆开，凡是**精确等于** `.page.theme-dark` 的分支都算数
 * （用精确相等而非包含，是为了排除 `.page.theme-dark .child` 这类后代规则）。
 */
function darkTokensOf(cssText) {
  const out = {};
  for (const r of rules(cssText)) {
    const parts = r.selector.split(',').map(x => x.trim());
    if (!parts.includes('.page.theme-dark')) continue;
    Object.assign(out, tokensIn(r.body));
  }
  return out;
}
/**
 * 收集所有规则（去注释，含行号与字符位置）。
 * 注意 stripComments 是「等长替换」（把注释内容换成空格、保留换行），
 * 所以 index/end 与**原始文本**的位置一致 —— 这是注解通道（@dark-ok）能对上号的前提。
 */
function rules(cssText) {
  const src = stripComments(cssText);
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.startsWith('@')) continue;
    out.push({
      selector: sel, body: m[2],
      line: src.slice(0, m.index).split(/\r?\n/).length,
      index: m.index, end: m.index + m[0].length
    });
  }
  return out;
}
function decl(body, prop) {
  const m = body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i'));
  return m ? m[1].trim() : '';
}
/** 取**最后一条**同名声明（CSS 后写的胜出；合并「基础 + 深色覆盖」时必须用它） */
function declLast(body, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'gi');
  let m, last = '';
  while ((m = re.exec(body))) last = m[1].trim();
  return last;
}

/**
 * `.page.theme-dark <同一选择器>` 这类覆盖规则的块体。
 *
 * 为什么必须单独处理：分析器只做了「token 换值」，但项目里大量深色修法是**直接给同选择器
 * 写一条 .page.theme-dark 覆盖**（如 .pool-check / .exercise .body .tag）。不认这条，
 * 就会拿浅色的底去配深色的字，产出「深色不达标」的假缺口。
 * 同选择器多条时取**最后一条**（CSS 层叠：后写的胜）。
 */
function darkOverrideOf(rs, baseSel) {
  // 去掉含 .theme-dark 的**那一段**（可能是 .page.theme-dark，也可能是 .repl-mask.theme-dark），
  // 只按空白切分而不是整串 replace：`.page.theme-dark .pool-check` 若只删 `.theme-dark`
  // 会剩下 `.page .pool-check`，永远匹配不上基础选择器（曾因此漏判）。
  const norm = s => s.split(/\s+/).filter(ch => !/\.theme-dark\b/.test(ch)).join(' ').trim();
  let hit = '';
  for (const r of rs) {
    if (!/\.theme-dark\b/.test(r.selector)) continue;
    for (const part of r.selector.split(',')) {
      if (norm(part) === baseSel) hit = r.body;
    }
  }
  return hit;
}

/**
 * sel 是否位于 base 的**后代**位置（而非「同一元素上的另一个类」）。
 *
 * 反例（曾经的假阳性源头）：`.tk-tag.done` 以 `.tk-tag` 开头，但两者是**同一个节点**上的
 * 两个类 —— `.tk-tag { background: var(--primary) }` 是它的自身底色，不是父容器纸底。
 * 把它当祖先，就会用「亮绿纸底」去算，得出「深色下 1.00:1」这种吓人的假结论。
 * 判据：前缀之后必须紧跟组合符（空格 / > / + / ~）才是后代。
 */
function isDescendantChain(sel, base) {
  if (!sel.startsWith(base)) return false;
  return /^[\s>+~]/.test(sel.slice(base.length));
}

/**
 * 读取源码里的**声明式豁免**：`/* @contrast-ok: 原因 *\/`
 *
 * 这是给「静态分析算不出来的纸底」和「WCAG 明示豁免」准备的**唯一**合法口子：
 *   · 相机取景器 / 视频遮罩上的按钮 —— 纸底是画面或恒定深色遮罩，不是页面底色；
 *   · 固定深色弹窗（.rest-pop.dark）内的胶囊 —— 容器自带 #161616，与主题无关；
 *   · 条件渲染的字形（未选中时文本为空）；
 *   · disabled 控件 —— WCAG 1.4.3 明确豁免失效控件。
 * 特点：原因写在 **CSS 源文件里**（可 review、可 grep），而不是藏在脚本的白名单里；
 * 没写原因的条目一律算缺口，门禁照旧拦。
 */
function annotationsOf(cssText) {
  const out = [];
  const re = /\/\*\s*@contrast-ok\s*:?\s*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(cssText))) out.push({ pos: m.index, end: m.index + m[0].length, reason: m[1].replace(/\s+/g, ' ').trim() });
  return out;
}
/** 值 → 颜色引用：var(--x[, fallback]) 或字面色；渐变取首个色停 */
function colorRef(value) {
  if (!value) return null;
  const m = value.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (m) return { token: m[1], fallback: m[2] ? m[2].trim() : '' };
  if (parseColor(value)) return { literal: value };
  const g = value.match(/gradient\([^,]+,\s*([^,)]+)/);
  if (g) return colorRef(g[1]);
  return null;
}
function resolve(ref, toks) {
  if (!ref) return null;
  if (ref.literal) return parseColor(ref.literal);
  let raw = toks[ref.token];
  if (raw === undefined) raw = ref.fallback;
  if (raw === undefined) return null;
  const more = colorRef(raw);
  return more && more.token ? resolve(more, toks) : parseColor(raw);
}

// ---------- 宿主页 ----------
/** 组件被哪些页面注册/使用（返回页面 wxss 相对路径列表） */
function hostPagesOf(componentName, repoRoot) {
  const out = [];
  const pagesDir = path.join(repoRoot, 'pages');
  if (!fs.existsSync(pagesDir)) return out;
  for (const d of fs.readdirSync(pagesDir)) {
    const ws = [path.join(pagesDir, d, d + '.wxml'), path.join(pagesDir, d, d + '.json')];
    const hit = ws.some(f => fs.existsSync(f) && new RegExp('(^|[\\s"/<])' + componentName + '([\\s"/>]|$)').test(fs.readFileSync(f, 'utf8')));
    if (hit) {
      const wxss = path.join(pagesDir, d, d + '.wxss');
      if (fs.existsSync(wxss)) out.push(path.relative(repoRoot, wxss).replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * 分析一条规则在浅色/深色下的对比度。
 * @param {string} ruleBody 规则体
 * @param {object} lightToks 浅色 token（app.wxss 根值）
 * @param {object} darkToks  深色 token（宿主页/本页深色块覆盖后的全量）
 * @param {string} paperValue 该元素压在上面的**原始 CSS 值**（如 'var(--card)' 或 'rgba(0,0,0,.6)'）。
 *   必须是原始值而不是 token 名：遮罩/浮层常用半透明字面色（如镜头上的 rgba(0,0,0,.6)），
 *   换算成 token 名就会丢信息、把纸底误当成白卡。
 * @param {string} [overrideBody] 深色下**同选择器**的覆盖规则体（见 darkOverrideOf）。
 *   给了它，深色侧就按覆盖后的底色/字色算，而不是拿未覆盖的浅色配深色的字。
 * @returns {object} 判定结果
 */
function analyzeRule(ruleBody, lightToks, darkToks, paperValue, overrideBody) {
  const baseBg = () => decl(ruleBody, 'background') || decl(ruleBody, 'background-color');
  const bgOf = isDark => {
    if (isDark && overrideBody) {
      const v = declLast(overrideBody, 'background') || declLast(overrideBody, 'background-color');
      if (v) return v;
    }
    return baseBg();
  };
  const fgOf = isDark => {
    if (isDark && overrideBody) {
      const v = declLast(overrideBody, 'color');
      if (v) return v;
    }
    return decl(ruleBody, 'color');
  };
  const bgRaw = bgOf(false);
  const fgRaw = fgOf(false);
  const paperRef = colorRef(paperValue || 'var(--n-50)');

  const pair = (toks, isDark) => {
    const rawPaper = resolve(paperRef, toks) || parseColor('#FFFFFF');
    // paper 自身可能是半透明（遮罩、--primary-tint 等）：必须先压到页面底上得到**不透明**实色，
    // 否则算对比度时会把它当成一块纯亮绿，得出「亮绿字压亮绿底 = 1:1」这种假警报。
    const pageBase = resolve(colorRef('var(--n-50)'), toks) || parseColor('#FFFFFF');
    const paper = rawPaper.a < 1 ? over(rawPaper, pageBase) : rawPaper;
    const bgC = resolve(colorRef(bgOf(isDark)), toks);
    return { paper, bg: bgC ? over(bgC, paper) : paper, fg: resolve(colorRef(fgOf(isDark)), toks) };
  };
  const L = pair(lightToks, false);
  const D = pair(darkToks, true);

  const fontSize = decl(ruleBody, 'font-size');
  const bold = /font-weight\s*:\s*(700|800|900|bold)/i.test(ruleBody);
  // WCAG 2.1 SC 1.4.3 大号字：≥24px（48rpx）常规，或 ≥18.66px（≈37rpx）粗体。
  // 旧口径「非粗体 ≥42rpx 或 只要 bold 就算大号」会把 20rpx 的粗体小标签也放行 ——
  // 那是浅色侧漏报的源头（.tpl-tag 4.38:1 就是这么漏掉的）。
  // 字号常写成 var(--fs-*)：不查 token 就一律当正文从严，会误伤真大号字。
  const fsDecl = decl(ruleBody, 'font-size') || '';
  const fsVar = fsDecl.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  const fsText = fsVar ? (lightToks[fsVar[1]] !== undefined ? lightToks[fsVar[1]] : (fsVar[2] || '')) : fsDecl;
  const fsPx = /([\d.]+)rpx/.test(fsText) ? parseFloat(fsText) / 2 : 0;
  const big = fsPx >= 24;
  const boldLarge = bold && fsPx >= 18.66;
  const min = (big || boldLarge) ? MIN_LARGE : MIN_TEXT;

  const hasText = !!(fgRaw || (overrideBody && declLast(overrideBody, 'color')));
  const cL = hasText && L.fg ? contrast(L.fg, L.bg) : null;
  const cD = hasText && D.fg ? contrast(D.fg, D.bg) : null;

  // 自洽品牌组合：底是品牌实色/亮绿，字是墨色 → 主题无关，翻任一侧都会砸坏
  // 注意用**已解析**的 L.fg 判亮度，不能拿原始串 parseColor（var(--x) 解析不出颜色）
  const brandBg = /var\(--primary(-light)?\)/.test(bgRaw || '');
  const inkFg = /var\(--primary-ink\)/.test(fgRaw || '') || (!!L.fg && lum(L.fg) < 0.2);
  const selfContained = brandBg && inkFg;

  let verdict;
  // 两侧都要判：浅色是默认主题，它的失败更难被察觉（用户不会去切主题才发现）。
  // food-vision 的 .seg-item.on 就是「浅色 1.18:1、深色反而 15.3:1」的典型 ——
  // 只判深色的话这类缺陷永远漏网。
  const failLight = hasText && cL !== null && cL < min;
  const failDark = hasText && cD !== null && cD < min;
  if (!hasText) verdict = 'exempt-decoration';
  else if (selfContained) verdict = 'exempt-brand-chip';
  else if (failLight || failDark) verdict = 'fail';
  else verdict = 'ok';
  const failModes = [failLight ? 'light' : '', failDark ? 'dark' : ''].filter(Boolean);

  return { verdict, failModes, min, cL, cD, L, D, bgRaw, fgRaw, selfContained };
}

/** 收集某文件里所有 .theme-dark 规则的块体（支持多行选择器列表） */
function darkBodies(text) {
  const out = [];
  for (const r of rules(text)) {
    const parts = r.selector.split(',').map(x => x.trim());
    if (parts.some(p => p === '.page.theme-dark' || p === '.tab-bar.theme-dark' || /\.theme-dark$/.test(p))) out.push(r.body);
  }
  return out.join('\n');
}

// 需要在深色下重新审视的浅色专属 token
const NEEDS_FLIP = [
  '--primary-tint', '--primary-text', '--primary-light', '--primary-ink',
  '--accent-soft', '--accent-tint', '--accent-ink',
  '--info-tint', '--purple-tint'
];
// 根值是浅色「面」的旧 token：不翻转 = 深色下渲染出白卡，与文字无关
const SURFACE_TOKENS = ['--glass', '--glass-strong', '--glass-border'];

function walkWxss(d, out) {
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) walkWxss(f, out);
    else if (f.endsWith('.wxss')) out.push(f);
  }
  return out;
}

/** 向上找最近定义了底色的祖先规则（靠选择器前缀判断，须是真后代） */
function ancestorPaper(rs, idx) {
  const sel = rs[idx].selector;
  for (let k = idx - 1; k >= 0; k--) {
    if (!isDescendantChain(sel, rs[k].selector)) continue;
    const bg = decl(rs[k].body, 'background') || decl(rs[k].body, 'background-color');
    if (bg) return bg;
  }
  return null;
}

/**
 * 全仓深色主题扫描（两个通道）
 *   [A] 文字对比度：按实际渲染的前景/背景算 WCAG，低于阈值才算缺口
 *   [B] 浅色面未翻转：--glass* 这类「根值是白色」的面 token 若在深色块没重定义，
 *       且没有 .theme-dark 规则用字面色直接覆盖同一元素，则判为缺口（白卡）
 *
 * @returns {{textGaps:Array, surfaceGaps:Array, annotated:Array, ok:number, exDecor:number, exChip:number}}
 */
function scanDarkGaps(repoRoot) {
  const LIGHT = tokensIn(fs.readFileSync(path.join(repoRoot, 'app.wxss'), 'utf8'));
  const files = walkWxss(path.join(repoRoot, 'pages'), []).concat(walkWxss(path.join(repoRoot, 'components'), []));

  const textGaps = [], surfaceGaps = [], annotated = [];
  let ok = 0, exDecor = 0, exChip = 0;

  for (const f of files) {
    const css = fs.readFileSync(f, 'utf8');
    const rel = path.relative(repoRoot, f).replace(/\\/g, '/');
    const isComponent = rel.startsWith('components/');
    const name = path.basename(f, '.wxss');

    let darkSrcs;
    if (isComponent) {
      const hosts = hostPagesOf(name, repoRoot);
      darkSrcs = hosts.map(h => ({ label: h, css: fs.readFileSync(path.join(repoRoot, h), 'utf8') }));
      if (!darkSrcs.length) continue;
    } else {
      darkSrcs = [{ label: rel, css }];
    }

    const rs = rules(css);
    const annos = annotationsOf(css);
    for (const src of darkSrcs) {
      const DARK = Object.assign({}, LIGHT, darkTokensOf(src.css));

      // [A] 文字对比度
      rs.forEach((rule, idx) => {
        const hasFg = !!decl(rule.body, 'color');
        const hasBg = !!(decl(rule.body, 'background') || decl(rule.body, 'background-color'));
        const touchesFlip = NEEDS_FLIP.some(t => new RegExp('var\\(\\s*' + t + '\\s*[,)]').test(rule.body));
        // 候选条件必须**放开**，不能只看 NEEDS_FLIP 名单：
        //   food-vision 的 .seg-item.on 是「background: var(--glass-strong) + color: var(--primary)」，
        //   两个 token 都不在名单里 —— 于是这条例（浅色下 1.18:1，亮绿字压白底）躲过了历代审计。
        //   凡是**同时设了底色与字色**的规则都能可靠地算出对比度，一律纳入候选。
        if (!hasFg) return;
        if (!hasBg && !touchesFlip) return;
        // 深色作用域规则（.page.theme-dark / .pop-mask.theme-dark ...）只在深色下生效，
        // 拿浅色 token 去算它没有意义，必判成假失败。
        if (/theme-dark/.test(rule.selector)) return;

        // 声明式豁免：算不出来的纸底（相机画面 / 视频遮罩 / 固定深色弹窗）与 WCAG 明示豁免的
        // 失效控件，由源码里的 @contrast-ok 注明原因。
        // 归属范围严格取「上一条规则结束 ~ 本条规则结束」：注解只作用于紧跟着的那一条，
        // 否则前面那条的注解会把后面的一条一起吞掉（如 .pool-check 吞掉选中态）。
        const prevEnd = idx > 0 ? rs[idx - 1].end : 0;
        const anno = annos.find(a => a.pos >= prevEnd && a.pos <= rule.end);
        if (anno) {
          annotated.push({ file: rel, line: rule.line, selector: rule.selector, reason: anno.reason, via: isComponent ? src.label : '' });
          return;
        }

        // paper：取**祖先的原始 background 值**（可为字面色/半透明遮罩），逐层向上；
        // 找不到就退回页面底。浮层/遮罩全靠这一步，否则会误当压在白卡上。
        let paperValue = null;
        for (let k = idx - 1; k >= 0; k--) {
          if (!isDescendantChain(rule.selector, rs[k].selector)) continue;
          const abg = decl(rs[k].body, 'background') || decl(rs[k].body, 'background-color');
          if (abg) { paperValue = abg; break; }
        }
        // 无祖先色 → 卡片面是最常见的落点，比页面底更贴近真实（胶囊/标签多在卡内）
        paperValue = paperValue || 'var(--card)';
        const a = analyzeRule(rule.body, LIGHT, DARK, paperValue, darkOverrideOf(rs, rule.selector));
        if (a.verdict === 'exempt-decoration') { exDecor++; return; }
        if (a.verdict === 'exempt-brand-chip') { exChip++; return; }
        if (a.verdict === 'ok') { ok++; return; }
        textGaps.push({
          file: rel, line: rule.line, selector: rule.selector, via: isComponent ? src.label : '',
          min: a.min, cL: a.cL, cD: a.cD, failModes: a.failModes,
          Lbg: hex(a.L.bg), Lfg: hex(a.L.fg), Dbg: hex(a.D.bg), Dfg: hex(a.D.fg),
          bgRaw: a.bgRaw, fgRaw: a.fgRaw
        });
      });

      // [B] 浅色面未翻转
      const darkTokSet = darkTokensOf(src.css);
      const darkRuleList = rs.filter(x => /\.theme-dark/.test(x.selector));
      for (const tok of SURFACE_TOKENS) {
        const usingRules = rs.filter(x => new RegExp('var\\(\\s*' + tok + '\\s*[,)]').test(x.body));
        if (!usingRules.length) continue;
        if (darkTokSet[tok] !== undefined) continue;
        for (const ur of usingRules) {
          const lastClass = (ur.selector.match(/\.([\w-]+)(?![\s\S]*\.)/) || [])[1] || '';
          const overridden = darkRuleList.some(dr => {
            const base = dr.selector.replace(/\.theme-dark/g, '');
            if (!base.includes('.' + lastClass)) return false;
            return !!(decl(dr.body, 'background') || decl(dr.body, 'background-color') || decl(dr.body, 'border') || decl(dr.body, 'border-top'));
          });
          if (!overridden) surfaceGaps.push({ file: rel, line: ur.line, selector: ur.selector, token: tok, via: isComponent ? src.label : '' });
        }
      }
    }
  }
  return { textGaps, surfaceGaps, annotated, ok, exDecor, exChip };
}

module.exports = {
  MIN_TEXT, MIN_LARGE, NEEDS_FLIP, SURFACE_TOKENS,
  parseColor, over, lum, contrast, hex,
  stripComments, tokensIn, darkBlockOf, darkTokensOf, rules, decl, declLast, colorRef, resolve,
  darkOverrideOf, isDescendantChain, annotationsOf,
  hostPagesOf, analyzeRule, darkBodies, ancestorPaper, scanDarkGaps
};

// scripts/scan-binding-integrity.cjs —— 事件绑定完整性检查（报告型）
//
// 小程序里 wxml 绑了一个 js 里不存在的方法，**点击不报错、也没反应**，
// 是最难靠真机发现的静默故障。反向：js 里写了却从没被绑定的方法＝死代码。
//
// 用法：node scripts/scan-binding-integrity.cjs
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

function walk(d, out) {
  for (const n of fs.readdirSync(d)) {
    if (n === 'node_modules' || n === '.git' || n === '.workbuddy') continue;
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const wxmls = walk(path.join(ROOT, 'pages'), []).filter(f => f.endsWith('.wxml'))
  .concat(walk(path.join(ROOT, 'components'), []).filter(f => f.endsWith('.wxml')))
  .concat(walk(path.join(ROOT, 'custom-tab-bar'), []).filter(f => f.endsWith('.wxml')));

const LIFECYCLE = new Set(['onLoad', 'onShow', 'onHide', 'onUnload', 'onReady', 'onPullDownRefresh',
  'onReachBottom', 'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onResize', 'onTabItemTap',
  'attached', 'detached', 'created', 'ready', 'moved']);

let missing = 0, dead = 0;
const deadList = [];

for (const wxml of wxmls) {
  const rel = path.relative(ROOT, wxml).replace(/\\/g, '/');
  const js = wxml.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(js)) { console.log('  ⚠ ' + rel + ' 没有同名 js（'+ path.basename(js) +'）'); continue; }
  // 剥注释，避免注释里的示例被当成真实绑定
  const w = fs.readFileSync(wxml, 'utf8').replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const j = fs.readFileSync(js, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1);

  // 收集绑定名（bindtap / catchtap / bindinput / bindchange / bindconfirm / bindlongpress …）
  const bound = new Set();
  const re = /\b(?:bind|catch)[:a-zA-Z]*\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(w)) !== null) {
    const name = m[1].trim();
    if (!name || /^\{\{/.test(name)) continue;   // 动态事件名本项目已禁用，出现即跳过
    bound.add(name);
  }

  for (const name of bound) {
    // js 里允许写成 `name(` 或 `name: function` / `name: (` / `name: async`
    const ok = new RegExp('(^|[\\s,{])' + name.replace(/[$]/g, '\\$') + '\\s*[:(]').test(j);
    if (!ok) { missing++; console.log('  ✗ ' + rel + ' 绑定 ' + name + '() —— js 里不存在（点击静默无反应）'); }
  }

  // 反向：Page/Component 体里声明的方法，既没被 wxml 绑定、也没被 this.xxx() 调用 ⇒ 真死代码。
  // 关键：必须先**只取 Page({...}) / Component({...}) 的花括号体**，
  // 否则模块顶层的辅助函数（pad / todayStr / emojiFor 这类）会被全部误报。
  const body = bodyOf(j, ['Page', 'Component']);
  if (body) {
    const declared = new Set();
    // 只认 **Page/Component 体的一级键**（depth 0），且跳过整个 `data: {…}` 块 ——
    // 否则 data 里的每个字段名（theme / tags / steps …）都会被当成方法，实测误报 655 条。
    let depth = 0, i = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }
      if (depth === 0) {
        const m2 = /^([A-Za-z_$][\w$]*)\s*[:(]/.exec(body.slice(i));
        if (m2 && (i === 0 || /[\s,{)]/.test(body[i - 1]))) {
          declared.add(m2[1]);
          const colon = body.indexOf(':', i);
          const brace = body.indexOf('{', i);
          if (m2[1] === 'data' && brace >= 0 && (colon < 0 || brace > colon)) {
            // 跳过 data 的整块
            let d2 = 0, k = brace;
            for (; k < body.length; k++) { if (body[k] === '{') d2++; else if (body[k] === '}') { d2--; if (d2 === 0) break; } }
            i = k + 1; continue;
          }
        }
      }
      i++;
    }
    for (const name of declared) {
      if (bound.has(name) || LIFECYCLE.has(name)) continue;
      if (/^_/.test(name)) continue;                          // 约定：下划线开头＝内部
      if (name === 'data' || name === 'methods' || name === 'properties' || name === 'options' || name === 'lifetimes' || name === 'observers') continue;
      if (new RegExp('this\\.' + name + '\\s*\\(').test(j)) continue;   // 被内部调用
      dead++;
      if (deadList.length < 40) deadList.push(rel + '  ' + name);
    }
  }
}

// 取出 xxx({ ... }) 的最外层花括号体（支持嵌套），返回 null 表示找不到
function bodyOf(text, callees) {
  for (const callee of callees) {
    const i = text.search(new RegExp('\\b' + callee + '\\s*\\('));
    if (i < 0) continue;
    const open = text.indexOf('{', i);
    if (open < 0) continue;
    let depth = 0;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(open + 1, k); }
    }
  }
  return null;
}

console.log('\n绑定缺失 = ' + missing + ' 处；疑似死方法（无绑定）= ' + dead + ' 处');
if (deadList.length) { console.log('\n死方法样例：'); deadList.forEach(x => console.log('  · ' + x)); }

#!/usr/bin/env node
// verify-style-binding.cjs —— wxml 红线守卫：style 属性值禁混写 Mustache。
// 背景（真实事故 2026-10-30，weekly.wxml wk-fill）：style="width: {{r.pct}}%" 这类
// 「字面量 + 插值」混写会触发 IDE/静态 CSS 解析报错（css-semicolondexpected，
// semi-colon expected）。仓内约定 = JS 拼好完整字符串，wxml 只绑 style="{{xxxStyle}}"。
// 规则：style 属性值只要含 {{ }}，就必须是**纯** {{expr}}（首尾即边界，不许夹任何字面量）。
// 跑法：仓库根 node scripts/verify-style-binding.cjs
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }
function bad(name, detail) { fail++; console.log('  ✗ ' + name + '\n      ' + detail); }

// —— [S] 内置样本自检（尺子先验自己：好/坏样本都必须能被正确判定） ——
const RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function styleViolations(src) {
  const out = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src)) !== null) {
    const v = m[1] != null ? m[1] : m[2];
    if (v.indexOf('{{') < 0) continue;          // 纯静态 style 合法
    const t = v.trim();
    if (/^\{\{[\s\S]*\}\}$/.test(t)) continue;  // 纯 {{expr}} 合法
    out.push(v);
  }
  return out;
}
{
  const good = [
    '<view style="{{fillStyle}}"></view>',
    '<view style=\'{{rowStyle}}\'></view>',
    '<view style="background: #fff"></view>',          // 纯静态合法
    '<view style="{{a}}" aria-label="{{b}}"></view>'
  ];
  const badSamples = [
    '<view style="width: {{pct}}%"></view>',           // 前缀字面量（本次事故形态）
    '<view style="height: {{h}}rpx"></view>',          // 后缀字面量
    '<view style="--pct: {{pct}}"></view>',            // CSS 自定义属性
    '<view style="height:{{rv*10}}%"></view>',         // 无空格变体
    '<view style="{{a}}; color: red"></view>'          // 半插值半字面量
  ];
  good.forEach((s, i) => {
    if (styleViolations(s).length === 0) ok('S1 合规样本' + (i + 1) + ' 不误报');
    else bad('S1 合规样本' + (i + 1) + ' 误报', s);
  });
  badSamples.forEach((s, i) => {
    if (styleViolations(s).length === 1) ok('S2 违规样本' + (i + 1) + ' 被抓');
    else bad('S2 违规样本' + (i + 1) + ' 漏报', s);
  });
}

// —— [W] 全仓 wxml 扫描 ——
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.wxml$/.test(e.name)) out.push(p);
  });
  return out;
}
{
  const files = walk(path.join(process.cwd(), 'pages'), []);
  let checked = 0;
  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const v = styleViolations(src);
    checked++;
    if (v.length) {
      const line = src.split('\n').findIndex(l => styleViolations(l).length > 0) + 1;
      bad(path.relative(process.cwd(), f), '混写 Mustache 的 style 共 ' + v.length + ' 处（首处约行 ' + line + '）：' + v[0]);
    }
  });
  if (fail === 0) ok('W1 全仓 ' + checked + ' 个 wxml 的 style 属性均为纯静态或纯 {{expr}}');
}

console.log('--------------------------------------------------------');
console.log('style-binding: pass=' + pass + '  fail=' + fail);
if (fail > 0) process.exit(1);

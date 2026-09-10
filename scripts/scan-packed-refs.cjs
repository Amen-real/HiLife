// 临时扫描脚本：核对 presets/ 引用 + utils/ 各文件是否被 pages/components/app.js 引用
const fs = require('fs'), path = require('path');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

// 全量业务源码（不含 utils 自身，避免 utils 互相引用干扰判断）
let biz = read('app.js');
fs.readdirSync('pages').forEach(p => { biz += read(path.join('pages', p, p + '.js')); });
fs.readdirSync('pages').forEach(p => { biz += read(path.join('pages', p, p + '.wxml')); });
fs.readdirSync('components').forEach(c => { biz += read(path.join('components', c, c + '.js')); });
const customTab = read('custom-tab-bar/index.js');
const appJson = read('app.json');

console.log('=== presets/ 引用检查 ===');
const presets = fs.readdirSync('presets');
let presetUsed = false;
presets.forEach(f => {
  const stem = f.replace(/\.js$/, '');
  const hit = biz.indexOf('presets/' + stem) >= 0 || appJson.indexOf('presets') >= 0 || customTab.indexOf('presets') >= 0;
  console.log((hit ? '  [被引用] ' : '  [未引用] ') + 'presets/' + f + '  ' + (fs.statSync(path.join('presets', f)).size / 1024).toFixed(1) + 'KB');
  if (hit) presetUsed = true;
});

console.log('=== utils/ 引用检查 ===');
fs.readdirSync('utils').forEach(f => {
  const s = fs.statSync(path.join('utils', f));
  const stem = f.replace(/\.js$/, '');
  const used = biz.indexOf("utils/" + stem) >= 0 || biz.indexOf('../../utils/' + stem) >= 0;
  console.log((used ? '  [被引用] ' : '  [未引用?] ') + (s.size / 1024).toFixed(1) + 'KB  utils/' + f);
});

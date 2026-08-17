const fs = require('fs');
const ex = require('./utils/exercises.js');
const lib = ex.library;

// 线上动作：{name(英文), file(图片文件名如 3294-A9qxk2F.jpg)}
const online = [];
for (const cat in lib) {
  for (const a of lib[cat]) {
    online.push({ name: (a.name || '').trim(), file: (a.image || '').split('/').pop() });
  }
}

// 本地动作：name -> 图片文件名（images/0001-2gPfomN.jpg）
const localRaw = JSON.parse(fs.readFileSync('F:/exercises-dataset-main/data/exercises.json', 'utf-8'));
const localByName = new Map();
for (const r of localRaw) localByName.set((r.name || '').trim(), (r.image || '').split('/').pop());

const pairs = [];
const missing = [];
for (const o of online) {
  const lf = localByName.get(o.name);
  if (!lf) { missing.push(o.name); continue; }
  // 本地高清图在 assets/upscaled/<lf>.jpg；目标上传为线上文件名 + _x4 后缀
  const dstBase = o.file.replace(/\.jpg$/i, '');
  pairs.push({ src: `assets/upscaled/${lf}`, dst: `images/${dstBase}_x4.jpg` });
}

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/action_map.json', JSON.stringify({ pairs, missing }, null, 2));
console.log('pairs:', pairs.length, '| missing:', missing.length);
if (missing.length) console.log('missing sample:', missing.slice(0, 10));

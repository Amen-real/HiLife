const fs = require('fs');
const ex = require('./utils/exercises.js');
const lib = ex.library;

// 线上：提取 {name(英文), file(图片文件名)}
const online = [];
for (const cat in lib) {
  for (const a of lib[cat]) {
    online.push({ name: (a.name || '').trim(), file: (a.image || '').split('/').pop() });
  }
}

// 本地：提取 {name(英文), file(图片文件名)}
const localRaw = JSON.parse(fs.readFileSync('F:/exercises-dataset-main/data/exercises.json', 'utf-8'));
const local = localRaw.map(r => ({
  name: (r.name || '').trim(),
  file: (r.image || '').split('/').pop(),
}));

const localByName = new Map();
for (const l of local) localByName.set(l.name, l);

let matched = 0;
const unmatchedOnline = [];
const dupOnline = [];
const seen = new Set();
for (const o of online) {
  if (seen.has(o.name)) { dupOnline.push(o.name); continue; }
  seen.add(o.name);
  if (localByName.has(o.name)) matched++;
  else unmatchedOnline.push(o.name);
}

console.log('online total:', online.length);
console.log('local total:', local.length);
console.log('matched (online name found in local):', matched);
console.log('coverage %:', (matched / online.length * 100).toFixed(2));
console.log('unmatched online (no local by name):', unmatchedOnline.length);
console.log('  sample:', unmatchedOnline.slice(0, 15));
console.log('online duplicate names:', dupOnline.length, dupOnline.slice(0, 5));

// 反向：本地有但线上没有（高清图生成了但线上无对应动作，上传无意义）
const onlineNames = new Set(online.map(o => o.name));
const unmatchedLocal = local.filter(l => !onlineNames.has(l.name)).map(l => l.name);
console.log('local w/o online (skip upload):', unmatchedLocal.length, unmatchedLocal.slice(0, 10));

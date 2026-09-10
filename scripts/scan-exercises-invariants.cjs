// 临时脚本：验证 exercises.js 可压缩不变量 + 输出体积构成
const E = require('../utils/exercises.js');
const lib = E.library;
const cats = Object.keys(lib);
let total = 0, sameImg = 0, videoDerivable = 0, ids = new Set(), dupIds = [];
const equipDict = new Map(), targetDict = new Map();
let stepsBytes = 0, nameBytes = 0, otherBytes = 0;

cats.forEach(cat => {
  lib[cat].forEach(a => {
    total++;
    if (ids.has(a.id)) dupIds.push(a.id);
    ids.add(a.id);
    if (a.image === a.imageLocal) sameImg++;
    const base = (a.image || '').split('/').pop().replace(/\.jpg$/i, '');
    if (a.video === '/videos/' + base + '.gif') videoDerivable++;
    if (!equipDict.has(a.equip)) equipDict.set(a.equip, equipDict.size);
    if (!targetDict.has(a.target)) targetDict.set(a.target, targetDict.size);
    stepsBytes += JSON.stringify(a.steps || '').length;
    nameBytes += (a.name || '').length + (a.nameZh || '').length;
    otherBytes += JSON.stringify({ id: a.id, image: a.image, imageLocal: a.imageLocal, video: a.video }).length;
  });
});

console.log('动作总数:', total, '| 类别:', cats.join('/'), '| id 唯一:', dupIds.length === 0);
console.log('image===imageLocal:', sameImg + '/' + total);
console.log('video 可由 image 派生:', videoDerivable + '/' + total);
console.log('equip 字典大小:', equipDict.size, '| target 字典大小:', targetDict.size);
console.log('steps 中文文本 ≈', (stepsBytes / 1024).toFixed(0) + 'KB  | name(en+zh) ≈', (nameBytes / 1024).toFixed(0) + 'KB  | 路径字段 ≈', (otherBytes / 1024).toFixed(0) + 'KB');

// 消费方字段核对：imageLocal 是否被页面用到（若从未用可不解码该字段，仍保留以稳 API）
console.log('导出 keys:', Object.keys(E).join(','));

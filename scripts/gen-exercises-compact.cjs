// scripts/gen-exercises-compact.cjs —— 把 utils/exercises.js 重编码为压缩行式格式
// 不变量已验证（scan-exercises-invariants.cjs）：
//   image === imageLocal（100%）、video = '/videos/' + image 文件名（100%）、id 全唯一
//
// ★★★ 重跑本脚本前必读（2026-10-13 补，契约全文见 utils/exercises.js 头部 / utils/README.md 第四节）
// 本脚本会把每个动作的**内容哈希**写进媒体路径：
//     image = /images/{id}-{hash}.jpg
//     video = /videos/{id}-{hash}.gif
// ⇒ **动作内容一变，hash 就变，两条路径就都变了。**
//   而历史训练记录是按**动作 id** 引用动作的 —— 于是「重跑生成链」可能让
//   老记录里的动作图与演示 GIF 指向失效地址。这是最容易在真机上才暴露的一类事故。
//
// 三条硬规矩：
//   ① **id 永不复用**：本脚本按原顺序透传 id，不会重排。但若有人改了上游顺序、
//      或用新列表覆盖，编号一旦复用，历史记录就会指向别的动作 —— 删除走 tombstone。
//   ② **顺序必须稳定**：utils/exercises.js 的分类与条目顺序是对外契约的一部分
//      （verify-exercises-compact 按【位置】逐位比对，顺序变了会红）。不要用
//      Set / Object 遍历顺序或带随机性的排序来重建 library。
//   ③ **验证顺序不能反**：
//        node scripts/verify-exercises-compact.cjs      ← 先验证（与固定指纹比）
//        node scripts/gen-exercises-fingerprint.cjs    ← 数据确实要改时才更新指纹
//        node scripts/verify-exercises-compact.cjs      ← 再验证
//      ⚠️ 先更新指纹再验证，等于把尺子改成跟被测物一样长。
// 生成后必须跑 verify-exercises-compact.cjs 再提交。
//
// 行式编码：[id, hash, nameEn, nameZh, equipIdx, targetIdx, stepIdx[]]
//   equipIdx / targetIdx 查 _E / _T 字典；stepIdx[] 查 _S 句子字典（2026-09-16 新增）
// 解码还原全部 9 个字段，对外 API（module.exports = { library }）不变。
//
// 为什么 steps 要单独做字典：实测 steps 占 _R 段 82.0%（462KB / 551KB 文件），
// 而 7538 条步骤里有 4070 条唯一（去重率 46%）—— 内联时同一句「收紧腹肌…」被
// 重复写了几十遍。改字典 + 索引后实测省 145KB。这是纯重编码，零信息损失。
const fs = require('fs');
const path = require('path');

const E = require('../utils/exercises.js');
const lib = E.library;
const cats = Object.keys(lib);

const equips = [], targets = [], steps = [];
const equipIdx = new Map(), targetIdx = new Map(), stepIdx = new Map();
function pushDict(list, idxMap, v) {
  if (!idxMap.has(v)) { idxMap.set(v, list.length); list.push(v); }
  return idxMap.get(v);
}

const rows = {};
cats.forEach(cat => {
  rows[cat] = lib[cat].map(a => {
    const base = a.image.split('/').pop();               // "3294-A9qxk2F.jpg"
    if (!base.startsWith(a.id + '-') || !base.endsWith('.jpg')) {
      throw new Error('image 文件名不符合 id-hash.jpg 约定: ' + a.id + ' -> ' + a.image);
    }
    const hash = base.slice(a.id.length + 1, base.length - 4);
    const stepIdxArr = (a.steps || []).map(s => pushDict(steps, stepIdx, s));
    return [
      a.id,
      hash,
      a.name,
      a.nameZh,
      pushDict(equips, equipIdx, a.equip),
      pushDict(targets, targetIdx, a.target),
      stepIdxArr
    ];
  });
});

const header = [
  '// utils/exercises.js —— 动作库（压缩行式格式，由 scripts/gen-exercises-compact.cjs 生成，勿手改）',
  '// 行式编码 [id, hash, nameEn, nameZh, equipIdx, targetIdx, stepIdx]；',
  '// _E/_T/_S 三张字典分别还原 equip/target/steps（_S 为步骤句子字典，索引去重）；',
  '// image/imageLocal/video 路径与 category/equip/target 由下方解码还原，对外 API 与原版完全一致。',
  'var _E=' + JSON.stringify(equips) + ';',
  'var _T=' + JSON.stringify(targets) + ';',
  'var _S=' + JSON.stringify(steps) + ';',
  'var _R=' + JSON.stringify(rows) + ';',
  'var library={};',
  'Object.keys(_R).forEach(function(cat){',
  '  library[cat]=_R[cat].map(function(r){',
  '    var img="/images/"+r[0]+"-"+r[1]+".jpg";',
  '    return {id:r[0],name:r[2],category:cat,equip:_E[r[4]],target:_T[r[5]],image:img,imageLocal:img,steps:r[6].map(function(i){return _S[i];}),nameZh:r[3],video:"/videos/"+r[0]+"-"+r[1]+".gif"};',
  '  });',
  '});',
  'module.exports={library:library};',
  ''
].join('\n');

const out = path.join(__dirname, '..', 'utils', 'exercises.js');
fs.writeFileSync(out, header, 'utf8');
console.log('已生成压缩版 utils/exercises.js:', (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
console.log('equip 字典:', equips.length, '项 | target 字典:', targets.length, '项 | steps 句子字典:', steps.length, '项');

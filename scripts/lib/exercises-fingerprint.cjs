/**
 * scripts/lib/exercises-fingerprint.cjs —— 动作库「内容指纹」
 *
 * 为什么需要它：
 *   原本的守卫是拿 `git show HEAD:utils/exercises.js` 与当前文件比。这在**提交前**有效，
 *   但一旦压缩版被提交，HEAD 就成了压缩版本身 → 之后每次运行都是「自己跟自己比」，恒真。
 *   守卫于是退化成安慰剂（本项目称之为「尺子看不见被测物」的失效模式）。
 *
 * 换成固定指纹：把每个动作的 9 个字段做规范化序列化后取 SHA-256，逐条列出，
 * 再对整体取一个聚合 digest。指纹文件随代码提交，因此**跨提交持续有效**。
 * 只有「确实要改动作库数据」时才用 gen-exercises-fingerprint.cjs 重新生成。
 *
 * 注意：steps 是数组，必须按序拼接后参与哈希，否则「丢了一条步骤」这类事故抓不到。
 */
const crypto = require('crypto');

/** 参与指纹的字段（必须覆盖对外 API 的全部字段，少一个就留一个盲区） */
const FIELDS = ['id', 'name', 'nameZh', 'category', 'equip', 'target', 'image', 'imageLocal', 'video', 'steps'];

const SEP_FIELD = '\u0002';
const SEP_STEP = '\u0001';

/** 单个动作的内容哈希（取前 16 位十六进制，够用且便于阅读） */
function actionKey(a) {
  const parts = FIELDS.map(f => {
    const v = a[f];
    if (f === 'steps') return Array.isArray(v) ? v.join(SEP_STEP) : '';
    return v === undefined || v === null ? '' : String(v);
  });
  return crypto.createHash('sha256').update(parts.join(SEP_FIELD), 'utf8').digest('hex').slice(0, 16);
}

/** 整库指纹：类别顺序 + 每类**按位置**的动作哈希
 *
 * ⚠️ 为什么不存成一个扁平的 id 列表然后按 id 反查比对：
 *   实测过，那样会漏掉「动作在分类内换位」——每个动作自身内容没变，
 *   按 id 反查时哈希全部匹配，守卫绿灯，但动作库的**显示顺序**已经变了
 *   （训练页/收藏页/循环页都是按库内顺序渲染的）。所以必须存**有序**结构，
 *   验证时按位置逐位比对。
 */
function fingerprint(library) {
  const categories = Object.keys(library);
  const groups = {};
  const counts = [];
  let total = 0;
  for (const cat of categories) {
    const list = library[cat] || [];
    counts.push(list.length);
    total += list.length;
    groups[cat] = list.map(a => a.id + ':' + actionKey(a));
  }
  const flat = categories.map(c => c + '=' + groups[c].join(',')).join('\n');
  const digest = crypto.createHash('sha256').update(flat, 'utf8').digest('hex');
  return {
    version: 2,
    fields: FIELDS,
    digest,
    total,
    categories,
    counts,
    groups
  };
}

module.exports = { fingerprint, actionKey, FIELDS };

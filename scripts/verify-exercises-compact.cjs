/**
 * verify-exercises-compact.cjs —— 动作库内容守卫（压缩编码是否无损）
 *
 * 做法：把当前 utils/exercises.js 解码后，与 scripts/exercises-fingerprint.json
 * 里**按位置排列**的逐动作字段哈希比对。
 *
 * ⚠️ 为什么不用「git show HEAD:utils/exercises.js」比：
 *   压缩版一旦提交，HEAD 就变成压缩版自身 → 之后每次运行都是自己跟自己比，恒真。
 *   本脚本原先就是这个写法，等于提交后自动退化成安慰剂。改用随代码提交的固定指纹，
 *   跨提交持续有效（见 scripts/lib/exercises-fingerprint.cjs 的说明）。
 *
 * 覆盖范围：id / name / nameZh / category / equip / target / image / imageLocal /
 *   video / steps（steps 按序参与哈希），且**按位置逐位比对** —— 因此以下都能抓到：
 *   字段被改、steps 少/多一条、动作被删、动作被换位、分类顺序变化。
 *   （曾经的实现按 id 反查，换位抓不到；由 .workbuddy/tmp 的篡改探针测出。）
 *
 * 数据确实要改时：先 verify 通过，再 node scripts/gen-exercises-fingerprint.cjs 更新指纹。
 * 顺序不能反过来 —— 先更新指纹再验证，等于把尺子改成跟被测物一样长。
 *
 * 用法： node scripts/verify-exercises-compact.cjs
 * 退出码：0 = 通过；1 = 有差异
 */
const fs = require('fs');
const path = require('path');
const { fingerprint, actionKey, FIELDS } = require('./lib/exercises-fingerprint.cjs');

const FP_PATH = path.join(__dirname, 'exercises-fingerprint.json');
if (!fs.existsSync(FP_PATH)) {
  console.log('✗ 缺少 scripts/exercises-fingerprint.json —— 先运行 node scripts/gen-exercises-fingerprint.cjs');
  process.exit(1);
}
const want = JSON.parse(fs.readFileSync(FP_PATH, 'utf8'));
const lib = require('../utils/exercises.js').library;
const got = fingerprint(lib);

const bad = [];

// 1) 分类集合与顺序
if (JSON.stringify(got.categories) !== JSON.stringify(want.categories)) {
  bad.push('分类顺序/集合不一致：[' + got.categories.join(',') + '] ≠ [' + want.categories.join(',') + ']');
}
if (got.total !== want.total) {
  bad.push('动作总数不一致：' + got.total + ' ≠ ' + want.total);
}

// 2) 按位置逐位比对（顺序敏感）
let checked = 0;
for (const cat of want.categories) {
  const exp = (want.groups || {})[cat] || [];
  const act = lib[cat] || [];
  if (act.length !== exp.length) {
    bad.push('分类 ' + cat + ' 条数不一致：' + act.length + ' ≠ ' + exp.length);
  }
  const n = Math.min(act.length, exp.length);
  for (let i = 0; i < n; i++) {
    const sep = exp[i].lastIndexOf(':');
    const expId = exp[i].slice(0, sep), expKey = exp[i].slice(sep + 1);
    const a = act[i];
    checked++;
    if (String(a.id) !== expId) {
      bad.push('分类 ' + cat + ' 第 ' + (i + 1) + ' 位动作错位：' + a.id + ' ≠ 指纹 ' + expId + '（顺序被打乱）');
      continue;
    }
    const k = actionKey(a);
    if (k !== expKey) {
      bad.push('动作 ' + a.id + '（' + (a.name || a.nameZh) + ' @' + cat + '）内容与指纹不符 [当前 ' + k + ' ≠ 指纹 ' + expKey + ']');
    }
  }
}

console.log('按位置比对: ' + checked + ' / 指纹 ' + want.total + '，当前库 ' + got.total +
  '，聚合 digest ' + got.digest.slice(0, 16) + (got.digest === want.digest ? ' ✓' : ' ✗'));
if (bad.length) {
  console.log('FAIL:');
  bad.slice(0, 12).forEach(b => console.log('  · ' + b));
  if (bad.length > 12) console.log('  … 共 ' + bad.length + ' 条');
  console.log('若这次改动是**有意的**：确认无误后运行 node scripts/gen-exercises-fingerprint.cjs 更新指纹。');
  process.exit(1);
}
console.log('PASS: 动作库与指纹完全一致（' + FIELDS.length + ' 个字段 × ' + want.total + ' 个动作，含顺序）');

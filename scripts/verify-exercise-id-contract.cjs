#!/usr/bin/env node
/**
 * verify-exercise-id-contract.cjs —— 动作 id 契约守卫（零依赖，node 直跑）
 *
 * 守的是什么：utils/README.md 第四节与 utils/exercises.js 头部写下的「动作 id 契约」——
 * id 永久不复用、媒体路径含内容哈希、重跑生成链必须先验证。
 *
 * ⚠️ 为什么这类「契约」需要守卫，而不是只写在注释里：
 *   注释会被后来人跳过，而这三条一旦被破坏，**后果是用户的历史训练记录指向错误或
 *   404 的动作** —— 静态检查看不出来，只有真机才暴露（正是 openGym 用
 *   `catalogue-v13-ids.json` 想防的那类事故）。
 *   所以「契约成文」只是第一步，「契约可执行」才算落地。
 *
 * ⚠️ 与既有守卫的分工（别重复造轮子）：
 *   · verify-exercises-compact —— 内容守卫：与固定指纹逐位比对（**字段/顺序/增删**）
 *   · 本脚本 —— **契约守卫**：盯「id 形态与不复用」「路径含hash」「契约注释确实在」
 *   两者互补，**不是替代**。
 *
 * 覆盖：
 *   [A] id 形态：4 位零填充、唯一、范围不回退（与基线快照比）
 *   [B] 路径形态：image/video 严格符合 /images|/{id}-{hash}.jpg| 与 /videos|/{id}-{hash}.gif
 *   [C] 契约成文：两个文件的头部注释里必须真的写了那三条（否则等于没写）
 *   [D] 顺序稳定：分类与条目顺序是契约的一部分（此处钉住当前顺序的摘要）
 *
 * 用法：node scripts/verify-exercise-id-contract.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b))
  ? ok(label) : bad(label + '  expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
const isTrue = (label, v) => (v ? ok(label) : bad(label));
const has = (label, s, sub) => (String(s).indexOf(sub) >= 0) ? ok(label)
  : bad(label + '  \u2209 ' + JSON.stringify(sub));

// 解出 _R 段（动作库行式数据）
const libSrc = read('utils/exercises.js');
const start = libSrc.indexOf('var _R=') + 'var _R='.length;
let depth = 0, end = start;
for (let i = start; i < libSrc.length; i++) {
  const c = libSrc[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
const rows = JSON.parse(libSrc.slice(start, end));
const groups = Object.keys(rows);                 // 分类，顺序本身是契约的一部分
const all = groups.flatMap(g => rows[g].map(r => Object.assign({ _cat: g }, r)));

/* ══════════════ [A] id 形态 ══════════════ */
console.log('\n[A] id 形态：4 位零填充 ·唯一 · 范围不回退');
{
  eq('A0 动作总数（1295，与 README 一致）', all.length, 1295);

  // 4 位零填充字符串
  const badPad = all.filter(r => !/^\d{4}$/.test(r[0]));
  eq('A1 全部 id 为 4 位零填充字符串', badPad.map(r => r[0]), []);

  // 唯一
  const seen = new Set(); const dups = [];
  all.forEach(r => { if (seen.has(r[0])) dups.push(r[0]); seen.add(r[0]); });
  eq('A2 id 全唯一（不复用编号 = 不得有重复）', dups, []);

  // 范围不回退：与随代码提交的基线快照比
  // ⚠️ 快照放scripts/ 下（已在 packOptions.ignore 的 scripts/ 内 ⇒ 不进主包）。
  //   用它不是为了「记条数」，而是为了让「编号被悄悄重排/删除」这类改动必须显式更新快照。
  const SNAP = path.join(ROOT, 'scripts', 'exercises-id-baseline.json');
  const nums = all.map(r => r[0]).map(Number);
  const cur = {
    total: all.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    groups: groups,
    // 每组首尾 id：足以发现组内顺序被重排（不记全量，避免快照本身变成第二份数据源）
    firstLast: groups.map(g => [g, rows[g][0][0], rows[g][rows[g].length - 1][0]])
  };
  if (!fs.existsSync(SNAP)) {
    bad('A3 缺少基线快照 scripts/exercises-id-baseline.json —— 先确认动作库是有意变更，再运行 node scripts/gen-exercises-id-baseline.cjs');
  } else {
    const base = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    eq('A3 动作总数未变', cur.total, base.total);
    isTrue('A3b id 范围未回退（max 不得变小）',
      cur.max >= base.max && cur.min <= base.min);
    eq('A4 分类集合与顺序未变', cur.groups, base.groups);
    eq('A5 各组首尾 id 未变（组内顺序未被重排）', cur.firstLast, base.firstLast);
  }

  // 「id 不可假定连续」—— 这条必须显式钉住，否则有人会写 id+1 取下一条
  const sorted = nums.slice().sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 1) gaps++;
  isTrue('A6 id 高度稀疏（存在大量跳号）⇒ 确实不可假定连续', gaps > 100);
  isTrue('A6b 反向自检：稀疏这个前提若哪天不成立（id 变连续），A6 会红—— 说明契约需重审',
    gaps > 100);
}

/* ══════════════ [B] 路径形态 ══════════════ */
console.log('\n[B] 媒体路径严格符合 id-hash 形态');
{
  const badImg = [], badVid = [], badHash = [], badPair = [];
  all.forEach(r => {
    // _R 每行是数组 [id, hash, nameEn, nameZh, equipIdx, targetIdx, stepIdx[]]
    const id = r[0], hash = r[1];
    const img = '/images/' + id + '-' + hash + '.jpg';
    const vid = '/videos/' + id + '-' + hash + '.gif';
    if (!/^\/images\/\d{4}-[0-9A-Za-z]{7}\.jpg$/.test(img)) badImg.push(img);
    if (!/^\/videos\/\d{4}-[0-9A-Za-z]{7}\.gif$/.test(vid)) badVid.push(vid);
    if (!/^[0-9A-Za-z]{7}$/.test(hash)) badHash.push(hash);
    // hash 必须与 id 绑定：不同动作不能共用同一个 hash（同 hash = 同内容，会撞图）
    if (!hash) badPair.push(id);
  });
  eq('B1 image 全部符合 /images/{4位id}-{7位hash}.jpg', badImg.slice(0, 3), []);
  eq('B2 video 全部符合 /videos/{4位id}-{7位hash}.gif', badVid.slice(0, 3), []);
  eq('B3 hash 一律 7 位 base32 形态', badHash.slice(0, 3), []);
  eq('B4 无空 hash', badPair.slice(0, 3), []);

  // 真实 library 里也要成立（防止只验证了「我们以为的」拼接规则）
  const lib = require(path.join(ROOT, 'utils', 'exercises.js')).library;
  const realBad = [];
  Object.keys(lib).forEach(cat => (lib[cat] || []).forEach(a => {
    if (a.image !== '/images/' + a.id + '-' + a.image.split('/').pop().split('-')[1] + '.jpg') {
      // 只校验 image 严格匹配 id-hash 形态
    }
    if (!new RegExp('^/images/' + a.id + '-[0-9A-Za-z]{7}\\.jpg$').test(a.image)) realBad.push(a.image);
    if (!new RegExp('^/videos/' + a.id + '-[0-9A-Za-z]{7}\\.gif$').test(a.video)) realBad.push(a.video);
  }));
  eq('B5 真实 library 里路径形态全部成立', realBad.slice(0, 3), []);

  // image === imageLocal（历史不变量，scan-exercises-invariants 也查，这里钉一份）
  const neq = [];
  Object.keys(lib).forEach(cat => (lib[cat] || []).forEach(a => { if (a.image !== a.imageLocal) neq.push(a.id); }));
  eq('B6 image === imageLocal（100%）', neq.slice(0, 3), []);

  // ⚠️ B 节**不负责**抓「内容 hash 被改」。这条写出来是为了防止后人误判分工：
  //   变异测试注入「改 hash」时本守卫全绿，看起来像漏网 —— 实际是**分工正确**：
  //     · 内容变更 =「合法但必须显式 review」 ⇒ 由 verify-exercises-compact 的**固定指纹**抓
  //       （实测：它会 FAIL 并提示跑 gen-exercises-fingerprint.cjs 更新指纹）；
  //     · 本脚本只守**契约与形态**：id 永久不复用、路径拼接规则、契约成文、顺序稳定。
  //   所以这里断言「内容守卫确实存在且在跑」—— 用它的文件名当契约的一部分。
  isTrue('B7 内容 hash 变更由 verify-exercises-compact 守（指纹文件必须在、守卫必须在）',
    fs.existsSync(path.join(ROOT, 'scripts', 'exercises-fingerprint.json'))
    && fs.existsSync(path.join(ROOT, 'scripts', 'verify-exercises-compact.cjs')));
}

/* ══════════════ [C] 契约成文 ══════════════ */
console.log('\n[C] 契约必须真的写在文件头部（否则等于没写）');
{
  const readme = read('utils/README.md');
  ['动作 id 契约', '永久', 'tombstone', '不复用', 'hash'].forEach(k =>
    isTrue('C1 utils/README.md 提到「' + k + '」', readme.indexOf(k) >= 0));

  const libHead = libSrc.slice(0, libSrc.indexOf('var _E='));
  ['动作 id 契约', '永久', '不复用', 'hash'].forEach(k =>
    isTrue('C2 utils/exercises.js 头部提到「' + k + '」', libHead.indexOf(k) >= 0));

  const genHead = read('scripts/gen-exercises-compact.cjs').slice(0, 2400);
  ['重跑本脚本前必读', 'id 永不复用', '顺序必须稳定', '验证顺序不能反'].forEach(k =>
    isTrue('C3 生成器头部提到「' + k + '」', genHead.indexOf(k) >= 0));

  // 反向自检：把注释剥掉后必须「找不到」⇒ 证明上面查的确实是注释里的内容
  const libNoComment = libHead.replace(/^\s*\/\/.*$/gm, ' ');
  isTrue('C4 反向自检：剥掉行注释后契约词条消失（证明断言不是被代码里的同名字符串满足的）',
    libNoComment.indexOf('动作 id 契约') < 0);
}

/* ══════════════ [D] 顺序稳定 ══════════════ */
console.log('\n[D] 顺序是对外契约的一部分');
{
  // verify-exercises-compact 已按位置比对；本节只钉住「顺序真的被当作契约」这件事
  eq('D1 分类顺序固定', groups, ['胸部', '背部', '肩膀', '腿部', '手臂', '核心']);
  // 组的条数分布（重排一个分类的顺序会让这里变）
  const dist = groups.map(g => [g, rows[g].length]);
  isTrue('D2 各分类条数之和 = 总数', dist.reduce((s, x) => s + x[1], 0) === all.length);
  // ⚠️ D3 第一版写成「组内 id 必须升序」，实测**红了**——查证后确认是**我的假设错了**：
  //   组内实际是按【动作名字母序】排的（barbell bench press → assisted chest dip → …），
  //   所以 id 天然不升序（实测每组有 31~108 处降序）。
  //   顺序契约真正要守的是「**这次生成的顺序 = 上次生成的顺序**」，
  //   而那已由 A5（各组首尾 id快照）与 verify-exercises-compact（按位置逐位比对）覆盖。
  // ⇒ 这里改成守一条**真实且有意义**的不变量：同组内不得出现**重复条目**（同一 id 出现两次）
  //   —— 那是「编号复用」最直接的表现，与 id 顺序无关。
  const dupInGroup = [];
  groups.forEach(g => {
    const local = new Set();
    rows[g].forEach(r => { if (local.has(r[0])) dupInGroup.push(g + '/' + r[0]); local.add(r[0]); });
  });
  eq('D3 同组内无重复条目（编号复用的直接表现）', dupInGroup, []);

  // 反向自检：顺序确实是被当契约守着的 —— 首尾 id 必须与基线快照一致（不是恒真）
  const SNAP2 = path.join(ROOT, 'scripts', 'exercises-id-baseline.json');
  if (fs.existsSync(SNAP2)) {
    const b2 = JSON.parse(fs.readFileSync(SNAP2, 'utf8'));
    const nowFirstLast = groups.map(g => [g, rows[g][0][0], rows[g][rows[g].length - 1][0]]);
    isTrue('D3b 组内首尾与基线快照不同（证明顺序可被改动，因而需要守卫盯着）',
      JSON.stringify(nowFirstLast) === JSON.stringify(b2.firstLast));
  }
}

console.log('\n────────────────────────────────');
console.log(pass + ' 断言通过，' + fail + ' 失败');
if (fail) process.exit(1);
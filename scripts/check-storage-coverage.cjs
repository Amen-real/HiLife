// scripts/check-storage-coverage.cjs
// 核验「代码里引用的媒体」在云开发云存储里是否真的存在、且终端用户读得到。
//
// 为什么需要它：媒体全部走 cloud://（MEDIA_MODE='cloud'），漏传不会报错，
// 只会让真机上的动作演示图/饮食图整片空白 —— 而开发者工具能读本地 assets/，看起来完全正常。
//
// 与旧版 check-missing-gifs.cjs 的区别（旧版已删除）：
//   旧版需要先扫码 `tcb login` + 手工导出 videos_list.txt，只能查 GIF，且查的是「清单里有没有名字」。
//   本脚本零凭据、零登录：云存储底层是 COS，公开桶挂在 https://<bucket>.tcb.qcloud.la/ 上，
//   key 与 cloud:// 文件 ID 的路径部分完全一致，HEAD 一下即可判定。
//   200 = 存在且公开可读；404 = 缺失；其他 = 网络/限流（自动重试）。
//
// 覆盖三类资源：动作静态图 images/、演示 GIF videos/、饮食图 images/food/。
// 注：本脚本依赖网络，故意不叫 verify-* 也不进 run-all-guards.cjs（那套要能离线跑）。
//
// 用法：
//   node scripts/check-storage-coverage.cjs                # 全量核验
//   node scripts/check-storage-coverage.cjs --only gif     # 只查演示 GIF
//   node scripts/check-storage-coverage.cjs --limit 20     # 抽样快速自检
//   node scripts/check-storage-coverage.cjs --json         # 额外输出明细 JSON 到 scripts/_out/

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const { MEDIA_MODE, CLOUD_ID_SUFFIX } = require(path.join(ROOT, 'utils/media.js'));

const args = process.argv.slice(2);
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : ''; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();
const WANT_JSON = args.includes('--json');
const CONCURRENCY = 12;

// ---- 前置：必须已填 CLOUD_ID_SUFFIX，否则 host 无从推导 ----
if (MEDIA_MODE !== 'cloud') {
  console.log(`! MEDIA_MODE='${MEDIA_MODE}'，当前不走云存储。本脚本只对 'cloud' 模式有意义。`);
  process.exit(0);
}
if (!CLOUD_ID_SUFFIX || CLOUD_ID_SUFFIX.indexOf('__TODO') >= 0) {
  console.log('✗ utils/media.js 的 CLOUD_ID_SUFFIX 未填写，无法推导云存储域名。');
  process.exit(1);
}
const HOST = `https://${CLOUD_ID_SUFFIX}.tcb.qcloud.la`;

// ---- 收集代码引用的资源（单源：exercises.js 的 image/video 字段 + 源码里的 /images/food/）----
const refs = new Map(); // key -> { kind, src }
const { library } = require(path.join(ROOT, 'utils/exercises.js'));
for (const a of Object.values(library).flat()) {
  if (a.image && /^\/images\//.test(a.image)) refs.set(a.image.slice(1), { kind: 'image', src: a.id });
  if (a.video && /^\/videos\//.test(a.video)) refs.set(a.video.slice(1), { kind: 'gif', src: a.id });
}

const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|wxml)$/.test(e.name)) srcFiles.push(p);
  }
})(path.join(ROOT, 'pages'));
for (const d of ['presets', 'utils', 'components']) (function walk(x) {
  for (const e of fs.readdirSync(x, { withFileTypes: true })) {
    const p = path.join(x, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|wxml)$/.test(e.name)) srcFiles.push(p);
  }
})(path.join(ROOT, d));
for (const f of srcFiles) {
  const re = /\/images\/food\/[A-Za-z0-9_\-.]+\.(?:jpg|jpeg|png|webp)/g;
  let m;
  const txt = fs.readFileSync(f, 'utf8');
  while ((m = re.exec(txt))) if (!refs.has(m[0].slice(1))) refs.set(m[0].slice(1), { kind: 'food', src: path.basename(f) });
}

// 注意：refs 是 Map，必须用 [...keys()] 取键 —— Object.keys(Map) 恒为 []（Map 条目不是自有可枚举属性）
const ALL = [...refs.keys()];
const kindOf = (k) => refs.get(k).kind;
let keys = ONLY ? ALL.filter((k) => kindOf(k) === ONLY) : ALL.slice();
if (LIMIT > 0) keys = keys.slice(0, LIMIT);

const tally = (list) => {
  const m = {};
  for (const k of list) m[kindOf(k)] = (m[kindOf(k)] || 0) + 1;
  return m;
};

console.log(`云存储域名: ${HOST}`);
console.log(`引用统计: ${JSON.stringify(tally(ALL))}  （合计 ${ALL.length}）`);
console.log(`本次核验: ${keys.length} 个${ONLY ? `  [--only ${ONLY}]` : ''}${LIMIT ? `  [--limit ${LIMIT}]` : ''}\n`);

// 零样本守卫：取数为 0 一定要报警，不能报「通过」。
// 否则一旦取数环节坏掉（例如 refs 取键方式写错），脚本会输出一片绿 —— 假绿灯比漏报更糟。
if (!keys.length) {
  console.log('✗ 没有取到任何引用，判定为取数环节异常（不是「通过」）。');
  console.log(`  ALL=${ALL.length}，ONLY='${ONLY}'，LIMIT=${LIMIT}。请检查 --only 取值是否为 image|gif|food，或 exercises.js 是否改过导出结构。`);
  process.exit(1);
}

function head(key, attempt = 1) {
  return new Promise((res) => {
    const finish = (v) => res(v);
    const t = setTimeout(() => again(key, attempt, 'TIMEOUT', finish), 15000);
    const req = https.request(`${HOST}/${key}`, { method: 'HEAD', timeout: 14000 }, (r) => {
      clearTimeout(t);
      r.resume();
      if (r.statusCode === 200) return finish({ key, code: 200, len: Number(r.headers['content-length'] || 0) });
      if (r.statusCode === 404) return finish({ key, code: 404 });
      again(key, attempt, r.statusCode, finish);
    });
    req.on('error', (e) => { clearTimeout(t); again(key, attempt, e.code || 'ERR', finish); });
    req.on('timeout', () => { clearTimeout(t); req.destroy(); again(key, attempt, 'TIMEOUT', finish); });
    req.end();
  });
}
function again(key, attempt, why, finish) {
  if (attempt >= 4) return finish({ key, code: why });
  setTimeout(() => head(key, attempt + 1).then(finish), 400 * attempt);
}

(async () => {
  const started = Date.now();
  const results = new Array(keys.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
    while (cursor < keys.length) {
      const i = cursor++;
      results[i] = await head(keys[i]);
      if (++done % 500 === 0) console.log(`  进度 ${done}/${keys.length}`);
    }
  }));

  const ok = results.filter((r) => r.code === 200);
  const missing = results.filter((r) => r.code === 404);
  const other = results.filter((r) => r.code !== 200 && r.code !== 404);
  const mb = (ok.reduce((s, r) => s + (r.len || 0), 0) / 1048576).toFixed(1);

  console.log(`\n耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`✓ 存在且公开可读 : ${ok.length}  (${mb} MB)`);
  console.log(`✗ 云端缺失       : ${missing.length}`);
  if (other.length) console.log(`! 未定/网络异常  : ${other.length}`);

  if (missing.length) {
    console.log(`\n缺失明细（按类型 ${JSON.stringify(tally(missing.map((r) => r.key)))}），前 30 条：`);
    missing.slice(0, 30).forEach((r) => console.log(`  ${r.key}   (来自 ${refs.get(r.key).src})`));
    if (missing.length > 30) console.log(`  …… 其余 ${missing.length - 30} 条见 JSON 明细`);
  }
  if (other.length) {
    console.log('\n未定明细（前 15 条，通常是网络抖动，可重跑）：');
    other.slice(0, 15).forEach((r) => console.log(`  ${r.key}  → ${r.code}`));
  }

  if (WANT_JSON) {
    const out = path.join(ROOT, 'scripts', '_out', 'storage-coverage.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({
      host: HOST, checked: keys.length, ok: ok.length,
      missing: missing.map((r) => r.key), undetermined: other.map((r) => ({ key: r.key, code: r.code })),
    }, null, 2));
    console.log(`\n明细已写入 scripts/_out/storage-coverage.json`);
  }

  if (!missing.length && !other.length) {
    console.log('\n✓ 云存储覆盖率核验通过：代码引用的媒体在云端均存在且公开可读。');
  } else if (!missing.length) {
    console.log('\n! 无缺失，但有网络异常项，建议重跑确认。');
  }
  process.exit(missing.length ? 1 : 0);
})();

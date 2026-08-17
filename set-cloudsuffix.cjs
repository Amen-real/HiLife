// set-cloudsuffix.cjs
// 上传任意 1 个文件到云存储后，从控制台复制其 CloudID（形如 cloud://<env>.<哈希>/videos/xxx.mp4），
// 用本脚本一键把「<哈希>」写入 utils/media.js 的 CLOUD_ID_SUFFIX，免去手动改代码出错。
//
// 用法：
//   node set-cloudsuffix.cjs "cloud://cloud1-d0g5ihto42b4ed256.abc123/videos/0001-2gPfomN.mp4"
//
// 注意：CloudID 里的 env 必须与 utils/media.js 的 CLOUD_ENV 一致。

const fs = require('fs');
const path = require('path');

const id = process.argv[2];
if (!id || !id.startsWith('cloud://')) {
  console.error('用法：node set-cloudsuffix.cjs "<CloudID>"');
  console.error('例：  node set-cloudsuffix.cjs "cloud://cloud1-d0g5ihto42b4ed256.abc123/videos/0001-2gPfomN.mp4"');
  process.exit(1);
}

// cloud://<env>.<suffix>/<path>
const m = id.match(/^cloud:\/\/([^.]+)\.([^/]+)\/(.*)$/);
if (!m) {
  console.error('无法解析 CloudID（格式应为 cloud://<env>.<哈希>/<路径>）：', id);
  process.exit(1);
}
const env = m[1];
const suffix = m[2];

const file = path.join(__dirname, 'utils', 'media.js');
let s = fs.readFileSync(file, 'utf8');

if (env !== 'cloud1-d0g5ihto42b4ed256') {
  console.warn('⚠️ CloudID 的 env 是', env, '，与 CLOUD_ENV(cloud1-d0g5ihto42b4ed256) 不一致，请确认复制自正确环境');
}

if (!s.includes("const CLOUD_ID_SUFFIX = '")) {
  console.error('未在 utils/media.js 找到 CLOUD_ID_SUFFIX 定义，请检查文件');
  process.exit(1);
}

s = s.replace(/const CLOUD_ID_SUFFIX = '[^']*';/, `const CLOUD_ID_SUFFIX = '${suffix}';`);
fs.writeFileSync(file, s);

console.log('✓ 已将 CLOUD_ID_SUFFIX 设为：', suffix);
console.log('  对应前缀：cloud://' + env + '.' + suffix + '/');

// 即时验证
const { media } = require('./utils/media.js');
const sample = '/videos/' + (m[3].split('/').pop() || 'x.mp4');
console.log('  验证 media(' + sample + ') =>', media(sample));

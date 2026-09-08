// upload-home-bg.cjs
// 只上传「首页人物背景图」到微信云存储 —— 比 upload-to-storage.cjs（全量 assets/images）快得多。
//
// 前置（只需做一次）：
//   1) 登录 CloudBase：npx -y -p @cloudbase/cli tcb login      （弹浏览器扫码授权）
//   2) 云开发控制台 → 存储 → 权限，设为「所有用户可读，仅创建者可写」
//      （默认是「仅创建者可读写」，不改成可读的话终端用户看不到背景图）
//
// 用法：
//   node upload-home-bg.cjs
//   node upload-home-bg.cjs --env <环境ID>          # 换环境
//   node upload-home-bg.cjs --file <本地路径>        # 换图
//
// 上传目标：images/home-bg.jpg（与 pages/home/home.wxss 里的 cloud:// 路径严格对应）
//   cloud://cloud1-d0g5ihto42b4ed256.636c-cloud1-d0g5ihto42b4ed256-1457779150/images/home-bg.jpg

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const pick = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const ENV = pick('--env', 'cloud1-d0g5ihto42b4ed256');
const LOCAL = path.resolve(__dirname, pick('--file', 'assets/images/home-bg.jpg'));
const REMOTE = 'images/home-bg.jpg';   // ← 必须与 home.wxss 中的路径一致

if (!fs.existsSync(LOCAL)) {
  console.error('✗ 找不到本地文件：' + LOCAL);
  console.error('  提示：底图由 PIL 从 22111_57.png 生成（人物缩到 80% + 600×1297 满幅画布），');
  console.error('        不要直接把原图丢进来 —— 人物会过大、且画布比例对不上导致铺不满。');
  process.exit(1);
}

const kb = (fs.statSync(LOCAL).size / 1024).toFixed(1);
console.log('环境   : ' + ENV);
console.log('本地   : ' + path.relative(__dirname, LOCAL) + '  (' + kb + ' KB)');
console.log('目标   : ' + REMOTE + '\n');

try {
  execFileSync(
    'npx',
    ['-y', '-p', '@cloudbase/cli', 'tcb', 'storage', 'upload', LOCAL, REMOTE, '-e', ENV],
    { stdio: 'inherit' }
  );
} catch (e) {
  console.error('\n✗ 上传失败。常见原因：');
  console.error('  1) 未登录 → 先执行： npx -y -p @cloudbase/cli tcb login');
  console.error('  2) 环境 ID 不对 → 云开发控制台确认后加 --env <ID>');
  console.error('  3) 网络问题 → 重跑即可（同名文件会覆盖）');
  process.exit(1);
}

console.log('\n✓ 上传完成。接下来确认两件事：');
console.log('  1) 云开发控制台 → 存储 → 权限 = 「所有用户可读，仅创建者可写」');
console.log('  2) 复制刚上传文件的 CloudID，核对 CLOUD_ID_SUFFIX：');
console.log('       node set-cloudsuffix.cjs "cloud://' + ENV + '.<哈希>/images/home-bg.jpg"');
console.log('     （当前 utils/media.js 里是 636c-cloud1-d0g5ihto42b4ed256-1457779150，');
console.log('       同一个环境复用即可，不用每次都改）');

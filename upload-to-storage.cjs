// upload-to-storage.cjs
// 把本地媒体上传到微信云开发【云存储】（不是静态托管），供 utils/media.js 的 MEDIA_MODE='cloud' 使用。
// 云存储文件以 cloud:// 文件 ID 访问，<image> 组件可直接渲染，且免 downloadFile 白名单 / 免 ICP 备案。
//
// 前置：
//   - 微信开发者工具已开通云开发，记下环境 ID（envId）。本项目 CLOUD_ENV = cloud1-d0g5ihto42b4ed256
//   - 云开发控制台 → 存储 → 权限，必须设为「所有用户可读，仅创建者可写」（否则终端用户看不到媒体）
//   - 首次使用 CloudBase CLI 需登录：终端执行 `npx -y -p @cloudbase/cli tcb login`（弹浏览器扫码授权）
//
// 用法：
//   CLOUDBASE_ENV=cloud1-d0g5ihto42b4ed256 node upload-to-storage.cjs
//   或  node upload-to-storage.cjs --env cloud1-d0g5ihto42b4ed256
//
// 上传映射（与 media() / 云存储实际结构一致）：
//   assets/upscaled/*.jpg  →  云存储 images/   （动作静态图，文件名即 <id>-<hash>.jpg，对应 exercises.js 的 /images/<id>-<hash>.jpg）
//
// ⚠️ 注意（2026-09-28 校正）：本脚本原先写的源目录是 assets/images 与 assets/videos，都是错的 ——
//   - assets/images/ 里放的是**首页背景图**（home-bg* / home-hero*），传上去会污染云存储 images/ 目录；
//     首页背景实际走的是包内 static/（home-bg.jpg 等），**不需要上传**。
//   - assets/videos/ 目录不存在；演示 GIF 与饮食图（images/food/）在仓库内**没有源文件**，
//     其云端资源已存在且经核验齐备，如需重传必须先从外部找回源文件。
//
// 上传后请务必跑一次 node scripts/check-storage-coverage.cjs 核验覆盖率。

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = process.env.CLOUDBASE_ENV || (() => {
  const i = process.argv.indexOf('--env');
  return i >= 0 ? process.argv[i + 1] : '';
})();

if (!env) {
  console.error('✗ 缺少环境 ID。请用 CLOUDBASE_ENV=xxx 或 --env xxx 指定云开发环境 ID。');
  process.exit(1);
}

const ROOT = __dirname;
const DEPLOYS = [
  // 动作静态图：assets/upscaled/<id>-<hash>.jpg → 云存储 images/<id>-<hash>.jpg
  { local: path.join(ROOT, 'assets', 'upscaled'), remote: 'images' },
];

console.log(`目标环境: ${env}\n`);

for (const { local, remote } of DEPLOYS) {
  if (!fs.existsSync(local)) {
    console.log(`- 跳过（不存在）: ${local}`);
    continue;
  }
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(local);
  if (!files.length) {
    console.log(`- 跳过（空目录）: ${local}`);
    continue;
  }
  console.log(`→ 上传 ${local} → ${remote}/  （${files.length} 个文件）`);
  try {
    // CloudBase CLI 可执行名是 tcb；storage upload <localDir> <cloudDir> 会递归上传
    execFileSync(
      'npx',
      ['-y', '-p', '@cloudbase/cli', 'tcb', 'storage', 'upload', local, remote, '-e', env],
      { stdio: 'inherit' }
    );
    console.log(`✓ ${remote} 上传完成\n`);
  } catch (e) {
    console.error(`✗ ${remote} 上传失败（详见上方输出）。可单独重试：`);
    console.error(`  npx -y -p @cloudbase/cli tcb storage upload "${local}" "${remote}" -e ${env}\n`);
  }
}

console.log('全部上传结束后，确认两件事：');
console.log('1) 云开发控制台 → 存储 → 权限，已设为「所有用户可读，仅创建者可写」；');
console.log('2) 核验覆盖率（零凭据、无需登录）：');
console.log('     node scripts/check-storage-coverage.cjs');
console.log('   它会 HEAD 每个被引用的资源（动作图 / 演示 GIF / 饮食图），报出缺失项。');
console.log('   （若 media.js 的 CLOUD_ID_SUFFIX 变了，先跑 set-cloudsuffix.cjs 更新。）');

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
//   assets/images/*        →  云存储 images/         （动作静态图，文件名保留源名含哈希后缀，对应 exercises.js 的 /images/<id>-<hash>.jpg）
//   assets/images/food/*   →  随 images/ 一并上传      （饮食推荐图，对应 mock.js 的 /images/food/<name>.jpg）
//   assets/videos/*        →  云存储 videos/         （演示 GIF 动图，对应 /videos/<id>-<hash>.gif）
//
// 注意：本项目 assets/videos/ 当前为空，演示 GIF 需先放到该目录再上传（或单独上传到 videos/）。

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
  { local: path.join(ROOT, 'assets', 'images'), remote: 'images' },
  { local: path.join(ROOT, 'assets', 'videos'), remote: 'videos' },
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
console.log('2) 上传任意 1 个文件，复制其 CloudID（cloud://<env>.<哈希>/...），运行：');
console.log(`     node set-cloudsuffix.cjs "cloud://${env}.<哈希>/upscaled/任意.jpg"`);
console.log('   把 CLOUD_ID_SUFFIX 填对后，media() 即返回正确的 cloud:// 地址。');

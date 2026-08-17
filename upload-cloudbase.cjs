// upload-cloudbase.cjs
// 把本地压缩好的媒体（videos/*.mp4、images/**/*.{jpg,png}）部署到微信云开发 CloudBase 的「静态网站托管」。
// 静态托管底层即 COS，部署后文件可通过 https://<envId>.tcloudbaseapp.com/<path> 访问，
// 与本项目的 utils/media.js 的 MEDIA_BASE 开关完美契合（代码零改动）。
//
// 前置：
//   - 微信开发者工具已开通云开发，记下环境 ID（envId）
//   - 云开发控制台 → 静态网站托管 → 已开通
//     （默认域名需 ICP 备案才能真机生产访问；或绑定自定义已备案域名）
//   - 本脚本通过 npx 调用 CloudBase CLI（可执行名 tcb，不是包名 @cloudbase/cli），无需全局安装
//   - 首次使用需先登录：在终端执行 `npx -y -p @cloudbase/cli tcb login`（弹浏览器扫码授权）
//
// 用法：
//   CLOUDBASE_ENV=xxx node upload-cloudbase.cjs
//   或  node upload-cloudbase.cjs --env xxx
//
// 注意：本脚本只上传 .mp4 / .jpg / .png，不会上传原 .gif（转换后的源文件已无意义，
//       且会被 project.config.json 的 packOptions.ignore 排除，不进包）。

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
  { local: path.join(ROOT, 'videos'), remote: 'videos' },
  { local: path.join(ROOT, 'images'), remote: 'images' },
];

// 只部署允许的扩展名，避免把原 GIF / 开发脚本传上去
const ALLOWED = new Set(['.mp4', '.jpg', '.jpeg', '.png', '.webp']);

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (ALLOWED.has(path.extname(e.name).toLowerCase())) n++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
}

console.log(`目标环境: ${env}\n`);

for (const { local, remote } of DEPLOYS) {
  if (!fs.existsSync(local)) {
    console.log(`- 跳过（不存在）: ${local}`);
    continue;
  }
  const n = countFiles(local);
  console.log(`→ 部署 ${local} → ${remote}  （${n} 个媒体文件）`);
  try {
    // 注意：CloudBase CLI 的可执行名是 tcb（不是包名 @cloudbase/cli）
    execFileSync(
      'npx',
      ['-y', '-p', '@cloudbase/cli', 'tcb', 'hosting', 'deploy', local, remote, '-e', env],
      { stdio: 'inherit' }
    );
    console.log(`✓ ${remote} 部署完成\n`);
  } catch (e) {
    console.error(`✗ ${remote} 部署失败（详见上方输出）。可单独重试：`);
    console.error(`  npx -y -p @cloudbase/cli tcb hosting deploy "${local}" "${remote}" -e ${env}\n`);
  }
}

console.log('全部部署结束后，把 utils/media.js 的 MEDIA_BASE 改成你的静态托管域名即可：');
console.log(`  const MEDIA_BASE = 'https://${env}.tcloudbaseapp.com';`);
console.log('（用自定义备案域名则填自定义域名；并在小程序后台 downloadFile 合法域名加上该域名）');

/**
 * upload-media.cjs
 * 把本地 videos/ 和 images/ 整目录上传到腾讯云 COS（保持相对结构 /videos/<id>.mp4、/images/<id>.jpg、/images/food/*.jpg）。
 * 上传完成后，把 utils/media.js 的 MEDIA_BASE 改成你的 CDN 域名即可，运行时所有媒体（<image>/<video>）自动走 CDN。
 *
 * 用法：
 *   1) 安装 SDK：  npm i cos-nodejs-sdk-v5
 *   2) 配置密钥（二选一）：
 *        a. 直接改下方 SECRET_ID / SECRET_KEY / BUCKET / REGION 常量
 *        b. 用环境变量：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
 *   3) 运行：      node upload-media.cjs
 *
 * 改成阿里 OSS / 七牛：只需替换 SDK 与 putObject 调用，遍历逻辑可复用。
 * 不想写代码：也可用腾讯云官方 coscli 一条命令搞定：
 *   coscli cp -r videos/ cos://<bucket>/videos/
 *   coscli cp -r images/ cos://<bucket>/images/
 */

const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');

const SECRET_ID = process.env.COS_SECRET_ID || 'YOUR_SECRET_ID';
const SECRET_KEY = process.env.COS_SECRET_KEY || 'YOUR_SECRET_KEY';
const BUCKET = process.env.COS_BUCKET || 'uu-fitness-125xxxxxxx';
const REGION = process.env.COS_REGION || 'ap-guangzhou';
const CONCURRENCY = 10;

if (SECRET_ID === 'YOUR_SECRET_ID') {
  console.error('请先配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION（环境变量或脚本顶部常量）。');
  process.exit(1);
}

const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY });
const ROOTS = ['videos', 'images'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(r => walk(r));
console.log(`待上传文件：${files.length} 个（videos + images）`);

let done = 0;
let failed = [];
let cursor = 0;

function put(file) {
  const key = file.split(path.sep).join('/'); // 保持相对结构
  return new Promise((resolve) => {
    cos.putObject(
      { Bucket: BUCKET, Region: REGION, Key: key, Body: fs.createReadStream(file),
        // 健身演示视频需可被 <video> 内联播放，关掉下载 Content-Disposition 强制
        ContentDisposition: 'inline' },
      (err) => {
        if (err) { failed.push(file); console.error('✗', key, err.message || err); }
        else {
          done++;
          if (done % 100 === 0) console.log(`进度 ${done}/${files.length}`);
        }
        resolve();
      }
    );
  });
}

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    await put(file);
  }
}

(async () => {
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`完成：成功 ${done} / ${files.length}，失败 ${failed.length}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (failed.length) console.log('失败文件名（前 10）：\n' + failed.slice(0, 10).join('\n'));
  console.log(`\n下一步：把 utils/media.js 的 MEDIA_BASE 改为你的访问域名，例如：\n  https://${BUCKET}.cos.${REGION}.myqcloud.com`);
  console.log('并在微信小程序后台【开发设置 → 服务器域名 → downloadFile 合法域名】加上该域名。');
})();

// utils/media.js
// 媒体资源云端化 —— 解决小程序包体积超限（videos 演示 MP4 ~9.5MB + images ~14MB，远超 2MB 主包 / 20MB 总包）。
//
// 数据文件（exercises.js 等）仍存相对路径（/videos/...、/images/...），
// 由 media() 在"出口处"拼成最终地址，业务代码无需感知。
//
// 三种云端模式（由 MEDIA_MODE 切换）：
//   'cloud' : 微信云开发【云存储】cloud:// 文件 ID  ← 免费版锁权限改不了，暂不可用
//   'cdn'   : 任意对象存储/CDN 的 HTTPS 域名（Cloudflare R2 / 腾讯云 COS / 阿里云 OSS / CloudBase 静态托管 等）← 当前选用【Cloudflare R2】
//   'local' : 本地开发，直接返回相对路径
//
// ── 云存储模式（MEDIA_MODE='cloud'）─────────────
// 前置：开通云开发后，云存储默认可用（基础版含 5GB，无需付费/备案）。
// 把 videos/、images/ 上传到云存储根目录（保持 /videos/<id>.mp4、/images/<id>.jpg 结构）。
// 云存储权限建议设为「所有用户可读，仅创建者可写」（否则他人看不到媒体）。
//
// ⚠️ CLOUD_ID_SUFFIX 必须填：cloud:// 文件 ID 形如
//      cloud://<envId>.<这段哈希>/videos/xxx.mp4
//    中间「这段哈希」每个环境固定但不透明、无法公式计算。
//    做法：上传任意 1 个文件到云存储 → 控制台复制其 CloudID → 把「.<哈希>」里的哈希填到下面。
//    未填前 media() 会回退本地相对路径（开发者工具模拟器仍可看，但真机加载失败）。
const CLOUD_ENV = 'cloud1-d0g5ihto42b4ed256';
const CLOUD_ID_SUFFIX = '636c-cloud1-d0g5ihto42b4ed256-1457779150'; // ← 上传一个文件后，从控制台 CloudID 复制替换

// ── CDN 模式（MEDIA_MODE='cdn'）──────────────────
// 当前用 Cloudflare R2（公开桶，r2.dev 默认域名）。MEDIA_BASE 填 R2 公开访问域名（HTTPS）：
//   形如 https://pub-<hash>.r2.dev（在 R2 控制台「设置 → 公开访问 / Allow Access」开启后获取）。
// 微信小程序 downloadFile 合法域名需加上该域名；注意 r2.dev 默认域名**无法 ICP 备案**，
// 真机加载需改用你自己备案过的自定义域名（CNAME 到 R2 + 走 Cloudflare 代理，橙色云）。
// 开发者工具勾选「详情 → 本地设置 → 不校验合法域名」可先跳过白名单验证。
const MEDIA_BASE = 'https://pub-d1c906fc65734d81a50cd8fabad52ca5.r2.dev'; // Cloudflare R2 公开桶（r2.dev 默认域名；真机需改用备案自定义域名 + 微信 downloadFile 白名单）

const MEDIA_MODE = 'cdn'; // 'cloud' | 'cdn' | 'local'

function media(p) {
  if (!p) return '';
  // 已是 http(s) 绝对地址或 cloud:// 文件 ID，原样返回（幂等，可重复调用）
  if (/^(https?:|cloud:)/.test(p)) return p;

  if (MEDIA_MODE === 'local') return p;

  if (MEDIA_MODE === 'cdn') {
    if (!MEDIA_BASE) return p;
    let base = MEDIA_BASE + (p.charAt(0) === '/' ? p : '/' + p);
    // 动作静态图走 R2 上的高清版：本地 180 源 → 沙箱 LANCZOS 批量放大 720 → 手动回传 R2 根目录 upscaled/ 前缀。
    // 业务数据里仍是 /images/<id>.jpg，这里在出口处改写成 /upscaled/<id>.jpg（同名，仅前缀不同）。
    // 仅对 /images/*.jpg 生效；视频 /videos/* 与其它资源不受影响。
    // 注：手动上传时直接用了 assets/upscaled/（原名、无 _x4 后缀）落到 upscaled/ 前缀，故此处映射到 upscaled/ 而非 _x4。
    if (/^\/images\/[^/]+\.jpe?g$/i.test(p)) {
      // 注意：此处 base 已是完整 URL（https://.../images/...），/images/ 不在开头，
      // 故 replace 不能用 ^ 锚点，否则匹配不到、改写失效（历史 bug：一直吃 180px 原图而非 720px upscaled）。
      base = base.replace(/\/images\//i, '/upscaled/');
    }
    return base;
  }

  // cloud 模式：拼 cloud://<envId>.<hash>/<相对路径>
  if (CLOUD_ID_SUFFIX.indexOf('__TODO') >= 0) {
    console.error(
      '[media] CLOUD_ID_SUFFIX 未填写，已回退本地相对路径。' +
      '请上传一个文件到云存储，复制其 CloudID（cloud://<env>.<哈希>/...），把哈希填进 utils/media.js 的 CLOUD_ID_SUFFIX'
    );
    return p;
  }
  const prefix = 'cloud://' + CLOUD_ENV + '.' + CLOUD_ID_SUFFIX + '/';
  const rel = p.charAt(0) === '/' ? p.slice(1) : p;
  return prefix + rel;
}

// 生成固定比例缩略图。
// 原方案依赖阿里云 OSS 的 x-oss-process 实时图像处理；迁移到 Cloudflare R2 后该参数失效。
// 当前策略（用户选择「先恢复原图」）：直接返回原图 media(p)，保证图片可加载、不报错。
// 后续若要自动缩略，可在「走 Cloudflare 代理的自定义域名 + 开启 Image Resizing」下改用：
//   const sep = url.indexOf('?') >= 0 ? '&' : '?';
//   return url + sep + 'width=' + w + '&height=' + h + '&fit=cover&format=webp';
// （注意：r2.dev 默认域名不支持 Image Resizing，必须改用自定义域名）
function thumb(p) {
  return media(p);
}

module.exports = { MEDIA_MODE, MEDIA_BASE, CLOUD_ENV, CLOUD_ID_SUFFIX, media, thumb };

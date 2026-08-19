// utils/media.js
// 媒体资源云端化 —— 解决小程序包体积超限（videos 演示 MP4 ~9.5MB + images ~14MB，远超 2MB 主包 / 20MB 总包）。
//
// 数据文件（exercises.js 等）仍存相对路径（/videos/...、/images/...），
// 由 media() 在"出口处"拼成最终地址，业务代码无需感知。
//
// 三种云端模式（由 MEDIA_MODE 切换）：
//   'cloud' : 微信云开发【云存储】cloud:// 文件 ID  ←【当前选用】免备案、无需配 downloadFile 域名白名单
//   'cdn'   : 任意对象存储/CDN 的 HTTPS 域名（Cloudflare R2 / 腾讯云 COS / 阿里云 OSS / CloudBase 静态托管 等）← 本地调试备用
//   'local' : 本地开发，直接返回相对路径
//
// ── 云存储模式（MEDIA_MODE='cloud'，当前选用）─────────────
// 前置：开通云开发后，云存储默认可用（免费版含 5GB，无需付费/备案）。
// 业务数据（exercises.js / mock.js）已存完整相对路径（images/<id>-<hash>.jpg、videos/<id>-<hash>.gif、images/food/<name>.jpg），
// 与云存储实际目录结构一致：动作图→images/、演示 GIF→videos/、饮食图→images/food/。media() 只在出口拼前缀，不做目录改写。
// 云存储权限【必须】设为「所有用户可读，仅创建者可写」，否则终端用户看不到媒体（默认仅创建者可读）。
// cloud:// 文件 ID 在 <image> 组件下可直接渲染，且免 downloadFile 域名白名单、免 ICP 备案。
//
// ⚠️ CLOUD_ID_SUFFIX 必须正确：cloud:// 文件 ID 形如
//      cloud://<envId>.<这段哈希>/upscaled/xxx.jpg
//    中间「这段哈希」每个环境固定但不透明、无法公式计算。
//    做法：上传任意 1 个文件到云存储 → 控制台复制其 CloudID → 运行 `node set-cloudsuffix.cjs "<CloudID>"` 一键写入。
//    未填前 media() 会回退本地相对路径（开发者工具模拟器仍可看，但真机加载失败）。
const CLOUD_ENV = 'cloud1-d0g5ihto42b4ed256';
const CLOUD_ID_SUFFIX = '636c-cloud1-d0g5ihto42b4ed256-1457779150'; // ← 上传一个文件后，从控制台 CloudID 复制替换

// ── CDN 模式（MEDIA_MODE='cdn'，仅本地调试备用）──────────
// 开发者工具勾选「详情 → 本地设置 → 不校验合法域名」时，可临时切回 cdn 模式用 R2 等预览。
// MEDIA_BASE 填对象存储/CDN 公开访问域名（HTTPS）：
//   形如 https://pub-<hash>.r2.dev（Cloudflare R2）或 https://<bucket>.cos.<region>.myqcloud.com（COS）。
// 注意 r2.dev 默认域名**无法 ICP 备案**，真机生产不可用；COS/自定义域名需在小程序后台配置 downloadFile 合法域名。
const MEDIA_BASE = 'https://pub-d1c906fc65734d81a50cd8fabad52ca5.r2.dev'; // Cloudflare R2 公开桶（r2.dev 默认域名；真机需改用备案自定义域名 + 微信 downloadFile 白名单）

const MEDIA_MODE = 'cloud'; // 'cloud' | 'cdn' | 'local'（当前选用 cloud：微信云存储，免备案）

function media(p) {
  if (!p) return '';
  // 已是 http(s) 绝对地址或 cloud:// 文件 ID，原样返回（幂等，可重复调用）
  if (/^(https?:|cloud:)/.test(p)) return p;
  if (MEDIA_MODE === 'local') return p;

  // 业务数据（exercises.js 等）存的已是完整相对路径，含哈希后缀、目录即 images/ 与 videos/：
  //   动作图：/images/<id>-<hash>.jpg   演示 GIF：/videos/<id>-<hash>.gif   饮食图：/images/food/<name>.jpg
  // 云存储实际目录结构与之一致，这里只在出口拼前缀，不做目录改写（否则 404）。
  let rel = p.charAt(0) === '/' ? p.slice(1) : p;

  if (MEDIA_MODE === 'cdn') {
    if (!MEDIA_BASE) return p;
    return MEDIA_BASE + '/' + rel;
  }

  // cloud 模式：拼 cloud://<envId>.<hash>/<相对路径>
  if (CLOUD_ID_SUFFIX.indexOf('__TODO') >= 0) {
    console.error(
      '[media] CLOUD_ID_SUFFIX 未填写，已回退本地相对路径。' +
      '请上传一个文件到云存储，复制其 CloudID（cloud://<env>.<哈希>/...），把哈希填进 utils/media.js 的 CLOUD_ID_SUFFIX'
    );
    return p;
  }
  return 'cloud://' + CLOUD_ENV + '.' + CLOUD_ID_SUFFIX + '/' + rel;
}

// 把 media() 输出的 cloud:// 文件 ID 解析为 HTTPS 临时地址，
// 供 wx.previewImage 等「只认 URL」的接口使用（<image> 组件可直接用 cloud://，无需此步）。
// 已是 http(s) 则直接回调；非云环境或解析失败时回退原值，保证不崩。
function resolveUrl(p, cb) {
  if (!p) { cb(''); return; }
  if (!/^cloud:/.test(p)) { cb(p); return; }
  if (!wx.cloud || !wx.cloud.getTempFileURL) { cb(p); return; }
  wx.cloud.getTempFileURL({
    fileList: [p],
    success: (res) => {
      const f = (res.fileList && res.fileList[0]) || {};
      cb(f.tempFileURL || p);
    },
    fail: () => cb(p)
  });
}

// 缩略图：云存储模式下直接返回原图 media(p)（cloud:// 文件 ID，<image> 原样渲染即可）。
// 若日后要实时缩略，可在云存储开启「图片处理」样式后用 getTempFileURL 的 ...?imageView2 参数，
// 或上传时额外存一份缩略图。当前保持简单、保证可加载。
function thumb(p) {
  return media(p);
}

module.exports = { MEDIA_MODE, MEDIA_BASE, CLOUD_ENV, CLOUD_ID_SUFFIX, media, thumb, resolveUrl };

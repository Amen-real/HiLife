# 上线 Checklist：一键上传媒体 + 切 CDN

> 目标：把本地压缩好的媒体（MP4 / JPG）传上云，改一个开关让全站走 CDN，使小程序包体积 < 2MB、审核通过、真机能正常加载演示视频与图片。

---

## 0. 仓库内已完成的前置

- **媒体本地压缩**
  - 食物图 PNG → JPG（quality 85，去透明填白底）：22MB → 1.9MB
  - 演示 GIF → MP4（H.264 / yuv420p / 480 宽封顶 / crf30）：126MB → 约 24MB
  - 转换脚本：`convert_gif_mp4.py`（依赖 `imageio-ffmpeg` 自带的 ffmpeg）
- **包体积云端化**
  - `utils/media.js`：`MEDIA_BASE` 开关 + `media()` 幂等函数（已是 http 地址原样返回）
  - `project.config.json`：`packOptions.ignore` 已排除 `videos/`、`images/` → 包内仅代码
- **数据 / 渲染**
  - 数据字段 `exercises.js` 等存相对路径 `/videos/<id>.mp4`、`/images/...`，运行时由 `media()` 拼 CDN
  - 详情页演示用 `<video>`（autoplay / loop / muted，poster 用静态图），`<image>` 同样走 CDN

---

## 1. 申请存储 / CDN（二选一）

### 方案 A（推荐）：微信云开发 CloudBase 静态网站托管
- 微信开发者工具 → 顶部「云开发」→ 开通环境，记下 **环境 ID（envId）**
- 云开发控制台 →「静态网站托管」→ 开通，得到域名 `https://<envId>.tcloudbaseapp.com`
- ⚠️ 默认域名需 **ICP 备案** 才能真机生产访问；或绑定自定义已备案域名
- 部署脚本见 `upload-cloudbase.cjs`（底层即 COS，与本仓库 `MEDIA_BASE` 开关完美契合，代码零改动）

### 方案 B：对象存储（腾讯云 COS / 阿里 OSS / 七牛）
- 创建 Bucket，设为「公有读」（或绑定 CDN 加速域名并开启回源）
- 拿到**访问域名**，形如：
  ```
  https://uu-fitness-125xxxxxxx.cos.ap-guangzhou.myqcloud.com
  ```

### 方案 C（已选，推荐免费路线）：微信云开发【云存储】cloud:// 文件 ID
- 云开发环境已开通即可用，**基础版含 5GB 云存储，免付费、免 ICP 备案、免域名白名单**
  （注意：被红框禁掉的是「静态网站托管」，云存储是另一套服务，不受影响）
- 上传后每个文件得到一个 `cloud://<envId>.<哈希>/<路径>` 的 CloudID，`<image>`/`<video>` 原生支持
- 云存储权限建议设为「**所有用户可读，仅创建者可写**」（小程序后台 → 云开发 → 存储 → 权限设置），否则他人看不到媒体
- 代码已就绪：`utils/media.js` 的 `MEDIA_MODE='cloud'`，`app.js` 已 `wx.cloud.init({ env })`

---

## 2. 上传媒体（保持相对结构）

目录结构必须保持，因为代码里的相对路径就是按这个拼的：

```
/videos/<id>.mp4
/images/<id>.jpg
/images/food/*.jpg
```

### 方式 A：脚本上传（腾讯云 COS 示例）

```bash
npm i cos-nodejs-sdk-v5
COS_SECRET_ID=xxx COS_SECRET_KEY=xxx COS_BUCKET=xxx COS_REGION=ap-guangzhou \
  node upload-media.cjs
```

- 并发 10，失败会列出文件名，方便补传
- **只上传、不动本地文件**，可放心重跑

### 方式 B：coscli 一条命令

```bash
coscli cp -r videos/ cos://<bucket>/videos/
coscli cp -r images/ cos://<bucket>/images/
```

### 方式 C（CloudBase 静态托管，对应方案 A）

**前置：首次使用需先登录 CLI**（弹浏览器扫码授权，只需一次）：
```bash
npx -y -p @cloudbase/cli tcb login
```

然后运行上传脚本：
```bash
CLOUDBASE_ENV=<envId> node upload-cloudbase.cjs
# 或：node upload-cloudbase.cjs --env <envId>
```

- 只上传 `.mp4` / `.jpg` / `.png`，**不会传原 `.gif`**（转换源文件，避免双份）
- 底层调用 `npx -y -p @cloudbase/cli tcb hosting deploy <本地目录> <云端路径> -e <envId>`（注意可执行名是 `tcb`）
- 单目录失败会打印单独重试命令

> 换成阿里 OSS / 七牛：只需替换 SDK 与 `putObject` 调用，遍历逻辑在 `upload-media.cjs` 里可复用。

### 方式 D（云存储 cloud://，对应方案 C，最省事）
**纯控制台拖拽，无需命令行、无需登录 CLI：**
1. 小程序后台 / 微信开发者工具 → 云开发 → **存储**
2. 把本地 `videos/` 和 `images/` 两个文件夹直接拖进存储根目录（保持 `videos/`、`images/` 结构）
3. 上传完成后，点开任意一个文件 → 复制它的 **CloudID**（形如 `cloud://cloud1-d0g5ihto42b4ed256.哈希/videos/0001-2gPfomN.mp4`）
4. 运行一键填后缀脚本（自动写入 `utils/media.js`）：
   ```bash
   node set-cloudsuffix.cjs "这里粘贴你复制的CloudID"
   ```
   > 不想用脚本也可手动改 `utils/media.js` 的 `CLOUD_ID_SUFFIX = '哈希'`

---

## 3. 切换媒体模式（关键一步）

`utils/media.js` 用 `MEDIA_MODE` 控制走哪套：

```js
const MEDIA_MODE = 'cloud'; // 'cloud' | 'cdn' | 'local'
```

- **云存储（已选）**：`MEDIA_MODE='cloud'`，把 `CLOUD_ID_SUFFIX` 填成控制台 CloudID 里的哈希（用 `set-cloudsuffix.cjs` 一键填）。无需备案、无需配域名白名单。
- **静态托管（备选）**：`MEDIA_MODE='cdn'`，把 `MEDIA_BASE` 改成静态托管域名（需付费套餐 + ICP 备案）。
- **本地开发**：`MEDIA_MODE='local'`，直接读项目内文件，开发者工具模拟器可预览。

数据文件（`exercises.js` 等）始终存相对路径，由 `media()` 在出口处拼最终地址，**业务代码一行都不用动**。

---

## 4. 微信小程序后台配合法域名

路径：【开发设置 → 服务器域名 → downloadFile 合法域名】加上第 1 步的域名。

- CloudBase 静态托管默认域名有时随云开发环境自动加入白名单；**若真机加载失败，再手动补一次**即可
- 自定义备案域名则必须手动加入白名单

- 必须是 **HTTPS**，且证书有效（自签名 / 过期会被拒）
- 小程序 `<video>`、`<image>` 加载该域名资源**必须登记**；未登记时真机一律失败
- 开发者工具可临时勾选「不校验合法域名」绕过，但真机不行——上线前务必登记

---

## 5. 验证

- 开发者工具：**上传代码**，此时包内应 < 2MB（仅代码）；确认后预览 / 真机扫码
- 进详情页点开任意动作：演示视频**自动循环静音播放**；加载失败时回退静态图 / emoji
- 饮食推荐图正常显示（JPG）
- 在开发者工具「详情 → 项目信息 → 项目体积」确认 < 2MB，提交审核

---

## 体积 / 流量预期

| 资源 | 压缩前 | 压缩后 |
|---|---|---|
| 演示媒体 | 126MB GIF | ~24MB MP4 |
| 食物图 | 22MB PNG | 1.9MB JPG |
| 小程序包 | 超限（含媒体 ~160MB） | < 2MB（仅代码） |

上线后 CDN 出流量计费大幅下降（GIF→MP4 省约 80% 带宽）。

---

## 回滚方案

- **CDN 故障**：把 `MEDIA_BASE` 改回 `''`，开发者工具模拟器仍可读项目内媒体继续开发（真机需重新上传后才能用）
- **某视频转码异常**：重跑 `convert_gif_mp4.py` 前先备份 `videos/`；脚本成功后才删原 GIF，失败的文件不受影响

---

## 注意事项

- 媒体 © Gym visual（https://gymvisual.com/），**必须保留 `© Gym visual` 署名**（详情页已内置），商用前请向 Gym visual 确认授权
- MP4 用 **H.264 + yuv420p**，微信全平台兼容；**勿用 WebM**（iOS 小程序 `<video>` 不支持）
- 视频建议 ≤ 480px 宽、单文件尽量 < 500KB，弱网体验更稳
- `convert_gif_mp4.py` / `gen_names.cjs` / `upload-media.cjs` 均为开发期脚本，可随仓库但**不进包**（已被 `packOptions.ignore` 排除或本就非小程序文件）

# 衡力 健身记录 · 微信小程序

个人运动健身小程序的微信小程序源码（完整 5 大模块 + 本地交互，数据用 mock + 真实动作数据集）。

## 目录结构

```
项目根目录（即本 README 所在文件夹）
├── app.js / app.json / app.wxss      全局逻辑、路由、主题样式
├── project.config.json / sitemap.json
├── custom-tab-bar/                 自定义底部导航（5 个主模块）
├── pages/
│   ├── home/         首页（CTA / AI 拍照 / 今日状态 / 目标 / 日历）
│   ├── training/      训练（动作库 + 真实数据集接入 + 选择/收藏）
│   ├── list/         列表（体重趋势 canvas 图 + 训练记录）
│   ├── advice/       建议（营养目标 + 饮食推荐 / 记录）
│   ├── profile/       我的（健康概览 / 登录 / 健康数据 / 日报 / 提醒）
│   ├── settings/      健康数据设置（性别 / 目标 / 目标体重 / 身高）
│   ├── weight-record/ 记录体重
│   └── action-detail/ 动作详情（中文分步教学）
├── utils/
│   ├── exercises.js   由真实数据集生成的动作库（1295 条，按 6 大部位分类）
│   ├── mock.js        示范中文动作 + 饮食推荐
│   ├── media.js       媒体云端化开关（MEDIA_BASE + media()）
│   └── store.js       轻量全局状态（读写 globalData 并持久化）
├── videos/            动作演示视频（/videos/<id>.mp4，GIF 已压为 MP4 省流量，上线传 CDN）
├── images/            动作缩略图 / 饮食图（上线传 CDN）
└── upload-media.cjs   媒体批量上传脚本（腾讯云 COS 示例）
```

## 如何运行

1. 用**微信开发者工具**导入项目，目录选本 README 所在的文件夹（即项目根目录）。
2. AppID 可填测试号，或保留 `touristappid`（游客模式）。
3. 详情 / 本地设置里勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**（本地开发用项目内媒体无需网络；上线走 CDN 时也便于真机调试）。
4. 编译即可预览。底部 5 个 Tab 切换，所有交互（选动作、收藏、记录体重、记饮食、设目标）都基于本地数据，关掉再开数据仍在（已用 `Storage` 持久化）。

## 动作库数据源（已接入真实数据集）

训练页的「动作库」来自公开数据集 **[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)**（1324 条健身动作，含 180×180 缩略图、部位、器械、10 国语言分步教学）。

已做预处理（`utils/exercises.js`，由仓库 `data/exercises.json` 离线生成）：

- 按 `body_part` 映射到 6 大部位分类：**胸 163 / 背 203 / 肩 143 / 腿 286 / 臂 329 / 核心 171**（共 1295 条，其余有氧/颈部约 29 条未纳入）。
- 只保留**中文分步说明**与必要字段，文件从 17MB 压到约 **803KB**。
- 器械名映射为中文标签（如 `barbell → 杠铃`、`dumbbell → 哑铃`、`body weight → 自重`）。
- 「我的动作」标签页保留架构文档里的中文示例动作（杠铃平板卧推等），方便对照。
- ⚠️ 当前仓库**只提交了 `exercises.js` 成品，未包含从 `data/exercises.json` 离线生成它的脚本**；如需重新加工或更新数据，需要自行补写生成脚本。

## 媒体资源与包体积（云端化方案）

训练所需的动作缩略图（`/images/`）、演示视频（`/videos/`，原 GIF 已压为 MP4）、饮食推荐图（`/images/food/`）共数百 MB（压缩前 videos 126MB + images 34MB），远超微信小程序 **2MB 主包 / 20MB 总包** 上限，无法随代码打包上传。本项目采用「数据存相对路径、运行时拼 CDN」的方式解决：

**本地开发（默认）**
- 把数据集的 `images/` 复制为本项目根目录的 `images/`，`videos/` 复制为 `videos/`（`utils/exercises.js` 的 `video` / `image` 字段已是 `/videos/`、`/images/` 相对路径）。
- `utils/media.js` 的 `MEDIA_BASE` 默认为 `''`，运行时 `media()` 直接返回相对路径，开发者工具【模拟器】即可预览，无需任何网络。

**上线发布**
1. 申请对象存储 / CDN（腾讯云 COS、阿里 OSS、七牛等均可），得到访问域名。
2. 上传媒体：运行 `node upload-media.cjs`（腾讯云 COS 示例，需 `npm i cos-nodejs-sdk-v5` 并填密钥），或用官方 `coscli cp -r` 把 `videos/`、`images/` 整目录传到域名根下，保持相对结构。
3. 把 `utils/media.js` 的 `MEDIA_BASE` 改为你的 CDN 域名，例如 `https://uu-fitness-125xxxxxxx.cos.ap-guangzhou.myqcloud.com`。
4. `project.config.json` 的 `packOptions.ignore` 已预置排除 `videos`、`images`，上传代码时自动忽略本地媒体 → 包内仅剩代码（< 2MB），审核通过。
5. 在微信小程序后台【开发设置 → 服务器域名 → downloadFile 合法域名】加上你的 CDN 域名（`<image>` / `<video>` 加载网络资源需登记）。
6. 运行时所有 `<image>` / `<video>` 走 CDN；某张图加载失败时，详情页会自动回退到静态图 / emoji。

> ⚠️ **包体积提醒**：未云端化前媒体约 160MB（压缩前：videos 126MB GIF + images 34MB）。已做两步压缩：① 食物图 PNG→JPG（22MB→1.9MB）；② 演示 GIF→MP4（126MB→约 24MB）。媒体现已压缩并**排除出包**，包内仅代码（< 2MB）。上线把压缩后的媒体传 CDN，流量成本大幅下降。。云端化后包内仅代码，体积合规。
>
> **授权说明（已核实数据集 LICENSE）：** 代码 / 结构 / 教学文本为 MIT；动作缩略图与演示视频等媒体资源 © Gym visual（https://gymvisual.com/），仅获授权以 180×180 重分发，**必须保留 `© Gym visual` 署名**（详情页已内置）。商用前请向 Gym visual 确认授权。

## 设计说明

- **自定义 TabBar**：`app.json` 中 `tabBar.custom: true`，组件在 `custom-tab-bar/`，每个页面 `onShow` 里调用 `this.getTabBar().setData({selected})` 高亮当前项。
- **状态管理**：`utils/store.js` 统一读写 `getApp().globalData` 并 `Storage` 持久化；首页/列表/建议/我的 的统计数据都从同一份状态实时计算。
- **包体积**：媒体资源（已压缩：GIF→MP4、食物图 PNG→JPG）已云端化，包内仅含代码（< 2MB），远低于微信主包 2MB / 总包 20MB 上限；详见下文「媒体资源与包体积」。

## 功能对照（架构文档）

| 模块 | 实现 |
|---|---|
| 首页 | 品牌区 + Slogan、开始训练 CTA、AI 拍照识别（chooseMedia + mock 估算）、QUICK CONTINUE、DAILY STATUS 完成度环、目标进度、记录日历（可展开）、饮食建议入口 |
| 训练 | 今日训练（日期/体重/休息计时）、动作库分类标签、搜索（支持中英文/拼音片段）、创建动作、动作卡（收藏 ♡ / 详情 / + 加入）、已选计数、开始训练 |
| 列表 | 体重记录 / 训练记录切换；记录体重；趋势图（7/30/90/全部，canvas 折线）；最高/最低/记录天数；历史记录；训练日志 |
| 建议 | 减脂/增肌饮食标题、今日营养目标（按体重·目标估算）、饮食建议/记录切换、餐别筛选、推荐卡（图/热量/三大营养素/添加） |
| 我的 | 头像、微信登录（mock）、健康概览（目标/体重/身高/BMI/健身天数）、健康数据设置、训练日报、每日提醒开关 |

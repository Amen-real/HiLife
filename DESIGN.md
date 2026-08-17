# DESIGN.md — 衡力健身记录 · 微信小程序设计系统

> 运动健身类微信小程序设计规范。视觉语言基于真实数据集 `hasaneyldrm/exercises-dataset`（1324 条动作，180×180 缩略图，**媒体 © Gym visual 须保留署名**，教学文本 MIT）。
> 本文件供 Cursor / Claude Code / Google Stitch 等 AI 代理直接消费，所有数值精确、可直接落地。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

- **设计哲学**：活力与克制并存。用高饱和的"能量绿"传递运动激励感，用冷静中性灰承载数据密度，避免廉价花哨。
- **视觉基调**：清爽、 motivating、数据清晰、轻拟物微质感。
- **核心特征关键词**：`energetic` · `clean` · `data-driven` · `rounded` · `trustworthy`
- **质感倾向**：纯扁平为主 + 极轻量投影（shadow-sm/md）；圆角 24rpx 为主；禁 heavy gradient、禁拟物纹理；图片统一圆角裁切。

---

## 2. Color Palette & Roles（调色板与角色）

```css
:root {
  /* Primary — 能量绿，主 CTA / 激活态 / 进度填充 */
  --color-primary:        #00B86B;
  --color-primary-dark:   #008F53;
  --color-primary-soft:   #E6F9F1; /* 浅绿底，标签/选中背景 */

  /* Accent — 活力橙，仅用于能量型强调（休息倒计时 / 卡路里 / PR） */
  --color-accent:         #FF7A3D;
  --color-accent-soft:    #FFEDE3;

  /* Neutral / Gray Scale（冷调灰） */
  --color-gray-50:  #F7F8FA;
  --color-gray-100: #EEF1F5;
  --color-gray-200: #E2E8F0;
  --color-gray-300: #CBD5E1;
  --color-gray-400: #94A3B8;
  --color-gray-500: #64748B;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1E293B;
  --color-gray-900: #0F172A;

  /* Surface & Borders */
  --color-surface:    #FFFFFF;
  --color-bg:         #F7F8FA;
  --color-border:     #E2E8F0;
  --color-border-strong: #CBD5E1;

  /* Semantic */
  --color-success: #16C784;
  --color-warning: #F5A524;
  --color-error:   #F2545B;
  --color-info:    #3E8BFF;

  /* Shadow Colors */
  --shadow-color: rgba(15, 23, 42, 0.08);
  --shadow-color-strong: rgba(15, 23, 42, 0.16);
  --mask-color: rgba(15, 23, 42, 0.50);
}
```

| 角色 | 变量 | HEX | 使用场景 |
|---|---|---|---|
| 主色 | `--color-primary` | #00B86B | 主按钮、激活 Tab、进度环、完成度 |
| 主色深 | `--color-primary-dark` | #008F53 | 主按钮 pressed、渐变收尾 |
| 主色浅 | `--color-primary-soft` | #E6F9F1 | 选中背景、标签底 |
| 强调 | `--color-accent` | #FF7A3D | 休息计时、卡路里数字、PR 标记 |
| 背景 | `--color-bg` | #F7F8FA | 页面底色 |
| 表面 | `--color-surface` | #FFFFFF | 卡片、弹窗、TabBar |
| 边框 | `--color-border` | #E2E8F0 | 卡片描边、输入框、分割线 |
| 成功 | `--color-success` | #16C784 | 记录成功、达标 |
| 警告 | `--color-warning` | #F5A524 | 接近上限、提醒 |
| 错误 | `--color-error` | #F2545B | 删除、校验失败、Danger 按钮 |
| 信息 | `--color-info` | #3E8BFF | 链接、提示 |

> **媒体合规**：所有来自数据集的缩略图/动图均为 **© Gym visual**，UI 中须在动作详情页底部或「关于」页固定展示 `© Gym visual — https://gymvisual.com/` 署名，不可裁剪去除。

---

## 3. Typography Rules（排版规则）

- **Font Family**：`-apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif`
- **数字/计量**：启用 `font-feature-settings: "tnum" 1;`（等宽数字，体重/计数对齐）
- **设计哲学**：标题用 600/700 建立层级，正文 400 保证长文可读；标签/胶囊用 500 微强调；字距默认 0，仅 Nano/Caption 轻加字距提升辨识。

### Type Scale

| Token | 用途 | Size | Weight | Line-Height | Letter-Spacing |
|---|---|---|---|---|---|
| Display Hero | 品牌 Slogan / 大数字 | 64rpx | 700 | 1.10 | -1rpx |
| H1 | 页面标题 | 44rpx | 700 | 1.20 | 0 |
| H2 | 区块标题 | 36rpx | 600 | 1.30 | 0 |
| H3 | 卡片标题 / 动作名 | 32rpx | 600 | 1.35 | 0 |
| Body LG | 引导文案 | 30rpx | 400 | 1.50 | 0 |
| Body | 正文默认 | 28rpx | 400 | 1.50 | 0 |
| Body SM | 次级正文 | 26rpx | 400 | 1.45 | 0 |
| Caption | 标签 / 元信息 | 24rpx | 500 | 1.40 | +0.2rpx |
| Nano | 脚注 / 署名 | 20rpx | 500 | 1.30 | +0.4rpx |

---

## 4. Component Stylings（组件样式）

### Buttons

```css
.btn { display:inline-flex; align-items:center; justify-content:center;
  border-radius:16rpx; padding:24rpx 32rpx; font-size:30rpx; font-weight:600;
  transition:transform .08s ease, background .15s ease; }
.btn-primary { background:var(--color-primary); color:#fff; }
.btn-primary:hover { background:var(--color-primary-dark); }
.btn-primary:active { transform:scale(.98); }
.btn-secondary { background:var(--color-gray-100); color:var(--color-gray-800);
  border:1rpx solid var(--color-border); }
.btn-ghost { background:transparent; color:var(--color-primary);
  border:1rpx solid var(--color-primary); }
.btn-danger { background:var(--color-error); color:#fff; }
.btn[disabled] { opacity:.45; }
```

### Cards

```css
.card { background:var(--color-surface); border:1rpx solid var(--color-border);
  border-radius:24rpx; padding:32rpx; box-shadow:0 2rpx 8rpx var(--shadow-color); }
.card-elevated { box-shadow:0 8rpx 24rpx var(--shadow-color); }
```

### Inputs

```css
.input { background:var(--color-surface); border:1rpx solid var(--color-border);
  border-radius:16rpx; padding:20rpx 24rpx; font-size:28rpx; color:var(--color-gray-800); }
.input::placeholder { color:var(--color-gray-400); }
.input:focus { border-color:var(--color-primary);
  box-shadow:0 0 0 4rpx var(--color-primary-soft); }
```

### Navigation（自定义 TabBar）

```css
.tabbar { position:fixed; left:0; right:0; bottom:0; height:100rpx;
  background:var(--color-surface); border-top:1rpx solid var(--color-border);
  display:flex; z-index:100; padding-bottom:env(safe-area-inset-bottom); }
.tabbar-item { flex:1; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:4rpx; color:var(--color-gray-400); font-size:20rpx; }
.tabbar-item.active { color:var(--color-primary); font-weight:600; }
```

### Badges / Tags

```css
.tag { display:inline-flex; align-items:center; padding:4rpx 16rpx;
  border-radius:999rpx; font-size:24rpx; font-weight:500; }
.tag-primary { background:var(--color-primary-soft); color:var(--color-primary-dark); }
.tag-accent  { background:var(--color-accent-soft);  color:#C2410C; }
```

### Modals / Bottom Sheets

```css
.mask { position:fixed; inset:0; background:var(--mask-color); z-index:1000; }
.sheet { position:fixed; left:0; right:0; bottom:0; background:var(--color-surface);
  border-radius:32rpx 32rpx 0 0; padding:40rpx 32rpx calc(40rpx + env(safe-area-inset-bottom));
  z-index:1001; animation:slideUp .24s ease; }
@keyframes slideUp { from{transform:translateY(100%);} to{transform:translateY(0);} }
```

### 健身专属组件

**完成度环（DAILY STATUS）**：SVG `viewBox="0 0 200 200"`，轨道 `stroke=#E2E8F0` width 16，进度 `stroke=#00B86B` width 16，`stroke-linecap=round`，中心 Display Hero 数字 + Nano 标签。

**进度条**：`height:12rpx; border-radius:999rpx; background:var(--color-gray-100);` 填充 `background:var(--color-primary);`。

**动作卡（Exercise Card）** — 字段来自数据集：

```css
.ex-card { display:flex; gap:24rpx; padding:24rpx; background:var(--color-surface);
  border:1rpx solid var(--color-border); border-radius:24rpx; }
.ex-thumb { width:160rpx; height:160rpx; border-radius:16rpx; object-fit:cover;
  background:var(--color-gray-100); } /* 加载失败显示占位图标 */
.ex-fav { position:absolute; top:16rpx; right:16rpx; color:var(--color-gray-300); }
.ex-fav.on { color:var(--color-accent); }
```

> 数据契约：`name`(动作名) · `body_part`(原始10类，UI 映射6类) · `equipment`(器械，中文标签映射) · `instructions.zh`(单段中文) · `instruction_steps.zh[]`(分步数组) · `image`/`gif_url`(© Gym visual) · `attribution`。

**趋势图容器**：`canvas` 高 400rpx，上方分段控件 `7 / 30 / 90 / 全部`。

---

## 5. Layout Principles（布局原则）

- **单位**：全部尺寸用 `rpx`（750rpx = 屏幕宽，自动随设备缩放）；1px 发丝线、阴影模糊用 `px`。
- **Spacing System**（基数 8rpx）：`4 / 8 / 16 / 24 / 32 / 48 / 64`rpx。
- **Grid**：小程序单列流式，内容左右边距 `32rpx`；多列卡片间隙 `24rpx`。
- **Container**：页面 `padding:24rpx 32rpx`；大屏（iPad）内容 `max-width:750rpx` 居中。
- **Section Spacing**：区块间 `48rpx`；区块内元素 `16–24rpx`。
- **留白哲学**：数据型页面（列表/建议）留白克制、信息密度高；品牌/首页留白宽松、突出 CTA。

---

## 6. Depth & Elevation（深度与层级）

```css
--shadow-xs: 0 1rpx 2rpx  var(--shadow-color);
--shadow-sm: 0 2rpx 8rpx  var(--shadow-color);
--shadow-md: 0 8rpx 24rpx var(--shadow-color);
--shadow-lg: 0 16rpx 40rpx var(--shadow-color-strong);
--shadow-2xl:0 32rpx 64rpx var(--shadow-color-strong);
```

- **Surface Layers**：`bg(#F7F8FA)` → `surface(#FFFFFF)` → `elevated(+shadow-md)` → `overlay(mask/sheet)`。
- **Z-index Scale**：TabBar `100` · 下拉/弹层 `1000` · 弹层内容 `1001` · Toast `2000`。
- **Backdrop**：Bottom Sheet 可用 `backdrop-filter:blur(20rpx)`（不支持时降级为纯 `mask-color`）。

---

## 7. Do's and Don'ts（设计规范与禁忌）

**Do's**
1. 主色只用于主操作与进度，强调橙仅用于能量型数据（休息/卡路里/PR）。
2. 缩略图统一 16rpx 圆角裁切，加载失败必须有占位图。
3. 数字（体重/计数/卡路里）一律启用等宽数字 `tnum`。
4. 动作详情页/关于页固定展示 `© Gym visual` 署名。
5. 触摸目标 ≥ 88rpx；TabBar 图标+文字组合清晰。
6. 空状态用插画占位 + 明确引导按钮。

**Don'ts**
1. 不要滥用强调橙，避免页面"着火"。
2. 不要去除/遮挡缩略图上的版权署名信息。
3. 不要用 `px` 写布局尺寸（会丧失多端适配），仅发丝线/阴影用 px。
4. 不要做超过 2MB 主包；`exercises.js` 已压到 ~803KB，勿回退完整 17MB 数据。
5. 不要在大段正文中使用 600+ 字重，保持可读层级。
6. 不要默认依赖 `raw.githubusercontent.com`（国内常不可达），默认引导走本地离线图。

---

## 8. Responsive Behavior（响应式行为）

- **Breakpoints**（按设备逻辑宽度 px）：`small <375` · `standard 375–414` · `large >414` · `tablet ≥768`（iPad）。rpx 自动缩放，无需为前三类单独改尺寸。
- **大屏策略**：`tablet` 时内容 `max-width:750rpx` 居中，两侧留白；TabBar 仍贴底全宽。
- **Touch Targets**：最小 `88rpx`（≈44px）；按钮高度 ≥ 88rpx。
- **折叠/重排**：首页 DAILY STATUS 环 + 目标在 `small` 下纵向堆叠；`standard+` 可左右并排。
- **Font Scaling**：用 rpx 天然缩放；`large` 设备可在 `app.json` 开启 `text-size-adjust` 兼容系统字体放大。
- **图片策略**：`LOCAL=true` 走 `/images/xxx.jpg`（离线优先，推荐国内）；`false` 走远程并加 `binderror` 占位。

---

## 9. Agent Prompt Guide（AI 代理提示指南）

**Quick Reference**
- 主色 `#00B86B`、强调 `#FF7A3D`；底色 `#F7F8FA`、表面 `#FFFFFF`。
- 单位 rpx；圆角 24rpx（卡）/16rpx（按钮、输入、缩略图）。
- 字体 `-apple-system, "PingFang SC", …`；数字开 `tnum`。
- 数据集字段见 §4 数据契约；媒体必须保留 `© Gym visual` 署名。

**Component Prompts（可直接复制）**
1. `生成训练页"动作卡"组件：左 160rpx 圆角缩略图(image字段,binderror 占位)，右动作名(name)+部位标签(body_part 映射中文)+器械标签(equipment 中文映射)，右上收藏心形(♡/已收藏切 accent 色)，点击跳 action-detail。`
2. `生成首页"DAILY STATUS 完成度环"：SVG 200x200，轨道 #E2E8F0，进度 #00B86B round cap，中心 Display Hero 百分比 + Nano 标签，下方目标进度条。`
3. `生成列表页体重趋势折线图：canvas 高 400rpx，分段控件 7/30/90/全部，标注最高/最低/记录天数，线色 #00B86B、网格 #E2E8F0。`
4. `生成建议页"推荐卡"：缩略图 + 热量大数字(#FF7A3D, tnum) + 蛋白/碳水/脂肪三色条 + 添加按钮(primary)。`
5. `生成 action-detail 动作详情页：标题(name)、部位/器械标签、分步教学(instruction_steps.zh 数组渲染)、gif 动图(gif_url)、底部固定 © Gym visual 署名。`
6. `生成自定义 TabBar：5 项(首页/训练/列表/建议/我的)，未选 #94A3B8、选中 #00B86B，图标+20rpx 文字，safe-area 适配。`

**Iteration Guide（生成后自检）**
1. 所有颜色是否都用 §2 变量，无裸色值？
2. 布局尺寸是否全 rpx（除 1px 发丝线/阴影）？
3. 数字是否启用 `font-feature-settings:"tnum"`？
4. 缩略图是否 `object-fit:cover` + 圆角 16rpx + 加载失败占位？
5. 是否在任何展示数据集图片的页面保留了 `© Gym visual` 署名？
6. 主色使用是否克制（未用于装饰性大面积铺色）？
7. 触摸目标是否 ≥ 88rpx？
8. 是否默认 `LOCAL=true` 离线图（国内可用）？
9. 主包是否仍 < 2MB（`exercises.js` 未回退完整数据）？
10. 组件是否语义化、可在微信开发者工具直接预览？

---

*设计系统版本 v1.0 · 数据基准 hasaneyldrm/exercises-dataset (1324 exercises, © Gym visual media, MIT text)*

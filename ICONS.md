# HiLife 图标设计规范（ICONS.md）

一整套适配「衡力健身记录 / HiLife」浅色主题（暖白底 `#F7F7F5` + 荧光绿 `#C8FF00`）的 SVG 图标。
**71 个图标**，统一栅格、统一描边、跟随主题色、矢量无限清晰。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `icons/svg/<name>.svg` | 矢量源文件（master），可在设计稿 / 浏览器直接引用 |
| `styles/icons.wxss` | 由脚本生成的图标类（mask 方案，**已接入 app.wxss**） |
| `icons/preview.html` | 浏览器预览页，直接打开看全部图标形状 |
| `scripts/gen-icons-svg.cjs` | **单一真源**：改图标只改这里，重跑即重建上面全部 |

## 为什么用 mask 方案（不是 PNG / 不是 `<image>`）

- ⚠️ 微信 `<image>` **不渲染 SVG data-URI**（真机/工具均空白）——旧 `<icon>` 组件靠 base64 **PNG** 绕开，但需栅格化工具且无法跟随主题色。
- ✅ WXSS 的 `mask-image` 支持 SVG data-URI：图标颜色由元素的 `background-color` 决定，因此**自动跟随主题**、**选中态一键变荧光绿**，且矢量不糊。
- 本环境无 SVG→PNG 栅格化工具、且无外网，mask 方案零依赖即可落地。

## 设计系统

- **栅格**：24×24 视窗，内容控制在 2~22，留 1px 安全边。
- **描边**：1.8，圆头 `round` + 圆角 `round join`，视觉统一。
- **描边色**：源文件写死 `#000`——它只用于 mask 的 alpha 通道，真实颜色由 `background-color` 提供（因此源文件本身不带主题色，颜色完全交给样式层）。
- **填充型**：实心图标（如 `play` `staron` `hearton` `chart` 柱 `info` 圆点）在元素上写 `fill="#000"`，mask 下同样表现为不透明。
- **配色语义**（通过修饰类切换 `background-color`）：
  - 默认 `.ico` → `var(--text-sub)` 墨灰（次级）
  - `.ico--ink` → `var(--text)` 近黑（主要）
  - `.ico--muted` → `var(--text-weak)` 浅灰（禁用/占位）
  - `.ico--primary` → `var(--primary)` 荧光绿 `#C8FF00`（选中 / 强调 / Tab 选中态）
  - `.ico--success` / `.ico--warning` / `.ico--info` → 语义色

## 用法

```html
<!-- 基础：默认墨灰 -->
<view class="ico ico-home"></view>

<!-- 选中态：荧光绿（如 Tab 选中） -->
<view class="ico ico-home ico--primary"></view>

<!-- 主色近黑 -->
<view class="ico ico-check ico--ink"></view>

<!-- 自定义尺寸（默认 48rpx） -->
<view class="ico ico-camera" style="width:72rpx;height:72rpx"></view>
```

修饰类可叠加；尺寸用 `style` 覆盖 `.ico` 的 `width/height`（rpx）。

## 图标清单（66）

- **导航/Tab**：home, train, plan, user
- **通用操作**：plus, close, check, search, settings, more, back, arrowleft, arrowright, chevrondown, chevronup, edit, delete, share, refresh, play, pause, camera, album, zoom
- **状态/反馈**：info, warning, success, error, staron, staroff, flame, trophy, goal, idea, chart, clock, trendingup, heart, hearton, calendar, target, myaction, pulse（心率线，用于「耐力」目标模板）
- **健身/身体**：scale, body, musclefront, muscleback, arm, chest, core, leg, shoulder, dumbbell
- **饮食/食物**：foodbowl, foodegg, foodfish, foodmeat, foodnoodle, foodrice, foodsalad, veg, breakfast, lunch, dinner, snack, diet, water

## 与旧 `<icon>` 组件的关系

旧 `components/icon/`（base64 PNG）仍可用，但仅覆盖约 16 个被页面引用的图标且配色固定。
新图标集通过 `styles/icons.wxss` 接入，**推荐新页面直接用 `<view class="ico ...">`**。
若需把新集也灌进旧 `<icon>` 组件（base64 PNG），需在本机装一次栅格化器（cairosvg / @resvg/resvg-js），
把 `icons/svg/*.svg` 转成 `assets/icons/i-<name>.png`，再跑 `scripts/gen-icons-data.cjs`。

## 维护

1. 在 `scripts/gen-icons-svg.cjs` 的 `ICONS` 对象里增改图标（内层 SVG）。
2. `node scripts/gen-icons-svg.cjs` → 重建 `icons/svg/*` + `styles/icons.wxss` + `icons/preview.html`。
3. 开发者工具重新编译即可生效。

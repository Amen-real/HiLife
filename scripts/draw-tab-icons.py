# scripts/draw-tab-icons.py
# 依据 07-diet.html 底部 <nav class="tab"> 的内联 SVG 路径，绘制 5 个 96x96 线稿 PNG，
# 覆盖 assets/icons/{i-home,i-train,i-plan,i-chart,i-user}.png。
# 之后运行 `node scripts/gen-icons-data.cjs` 重新生成 components/icon/icons-data.js，
# custom-tab-bar 即可通过 ICONS['home'|'train'|'plan'|'chart'|'user'] 拿到新图标。
#
# 设计对齐 07-diet.html：
#   - 24x24 viewBox，stroke-only（数据图标含一个 fill 圆点），stroke-width 2，圆角端点/连接
#   - 透明背景，描边色 #0A0A0A（与 active 态的 drop-shadow 绿色配合：非激活 opacity 0.6 显灰，激活显黑+绿光）
#   - 源 96x96（4x 缩放），stroke≈6（≈1.5/24，比 01-home 版的 1.8 更细，贴合 07-diet 的 2/24）
#
# 绘制策略：Pillow 版本对 polygon(line).joint 支持不一，改用「线段 + 顶点圆帽」通用技法——
# 描边用 line/rounded_rectangle/arc/ellipse，顶点与开放端点统一补一个半径 = stroke/2 的实心圆，
# 既保证圆角连接也保证 round linecap，与 07-diet 的 stroke-linecap:round / stroke-linejoin:round 等效。
from PIL import Image, ImageDraw
import os

SIZE = 96
S = SIZE / 24.0       # viewBox 24 → 96 像素的缩放因子
STROKE = 7            # 描边宽度（像素）≈ 1.75/24，介于 07-diet(2) 与 01-home(2.2) 之间，克制清晰
COLOR = (10, 10, 10, 255)   # #0A0A0A，等价 var(--text)
BG = (0, 0, 0, 0)     # 透明
R = STROKE // 2       # 端点/连接圆帽半径


def to_pt(p):
    return (p[0] * S, p[1] * S)


def cap(d, p_vb):
    """在 viewBox 坐标 p 处补一个实心圆，充作该顶点的圆角连接/端点圆帽。"""
    x, y = to_pt(p_vb)
    d.ellipse((x - R, y - R, x + R, y + R), fill=COLOR)


def new_img():
    return Image.new('RGBA', (SIZE, SIZE), BG)


def draw_polyline(d, pts_vb, caps=None):
    """把 viewBox 顶点列表画成折线（每条边单独 line），可选在指定顶点补圆帽。"""
    pts_px = [to_pt(p) for p in pts_vb]
    for i in range(len(pts_vb) - 1):
        d.line([pts_px[i], pts_px[i + 1]], fill=COLOR, width=STROKE)
    if caps:
        for p in caps:
            cap(d, p)


def draw_home():
    # 房子：屋顶三角 M3 11l9-8 9 8  +  主体矩形 M5 10v10h14V10
    img = new_img()
    d = ImageDraw.Draw(img)
    draw_polyline(d, [(3, 11), (12, 3), (21, 11)], caps=[(3, 11), (12, 3), (21, 11)])
    draw_polyline(d, [(5, 10), (5, 20), (19, 20), (19, 10)],
                  caps=[(5, 10), (5, 20), (19, 20), (19, 10)])
    return img


def draw_train():
    # 杠铃/哑铃（带配重片）：
    #   中央把手曲线 M6 4v6a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V4
    #   左侧配重：M4 7h2  M2 9h4    右侧配重：M18 7h2  M18 9h4
    #   两腿：M10 14v6  M14 14v6
    img = new_img()
    d = ImageDraw.Draw(img)
    # 中央把手：用弧线采样点把两段 a4 4 圆弧近似为平滑下凹握把
    handle = [(6, 4), (6, 10), (7.17, 12.83), (10, 14),
              (14, 14), (16.83, 12.83), (18, 10), (18, 4)]
    draw_polyline(d, handle, caps=handle)
    draw_polyline(d, [(4, 7), (6, 7)], caps=[(4, 7), (6, 7)])
    draw_polyline(d, [(2, 9), (6, 9)], caps=[(2, 9), (6, 9)])
    draw_polyline(d, [(18, 7), (20, 7)], caps=[(18, 7), (20, 7)])
    draw_polyline(d, [(18, 9), (22, 9)], caps=[(18, 9), (22, 9)])
    draw_polyline(d, [(10, 14), (10, 20)], caps=[(10, 14), (10, 20)])
    draw_polyline(d, [(14, 14), (14, 20)], caps=[(14, 14), (14, 20)])
    return img


def draw_plan():
    # 日历：圆角矩形框 4,5–20,20 + 表头横线 y=10 + 两个活页环 x=9 / x=15（y=3→7）
    img = new_img()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        (4 * S, 5 * S, 20 * S, 20 * S),
        radius=2 * S,
        outline=COLOR,
        width=STROKE,
    )
    draw_polyline(d, [(4, 10), (20, 10)], caps=[(4, 10), (20, 10)])
    draw_polyline(d, [(9, 3), (9, 7)], caps=[(9, 3), (9, 7)])
    draw_polyline(d, [(15, 3), (15, 7)], caps=[(15, 3), (15, 7)])
    return img


def draw_chart():
    # 趋势折线（向上）：M3 18l5-6 4 3 6-9  +  末端实心圆点 cx=18 cy=6 r=1.5（fill=currentColor）
    img = new_img()
    d = ImageDraw.Draw(img)
    draw_polyline(d, [(3, 18), (8, 12), (12, 15), (18, 6)],
                  caps=[(3, 18), (8, 12), (12, 15), (18, 6)])
    # 圆点：实心（等效 fill=currentColor），半径固定为 1.5*S（与 viewBox r=1.5 一致），不随 stroke 变化
    cx, cy = to_pt((18, 6))
    dr = int(1.5 * S)
    d.ellipse((cx - dr, cy - dr, cx + dr, cy + dr), fill=COLOR)
    return img


def draw_user():
    # 人物：圆头 cx=12 cy=8 r=4  +  肩部曲线 M4 21c0-4 4-7 8-7s8 3 8 7
    img = new_img()
    d = ImageDraw.Draw(img)
    d.ellipse((8 * S, 4 * S, 16 * S, 12 * S), outline=COLOR, width=STROKE)
    # 肩部用三次贝塞尔近似：M4 21 C4 17, 8 14, 12 14 S20 17, 20 21
    d.line(
        [(4 * S, 21 * S), (4 * S, 17 * S), (8 * S, 14 * S),
         (12 * S, 14 * S), (20 * S, 17 * S), (20 * S, 21 * S)],
        fill=COLOR,
        width=STROKE,
        joint='curve',
    )
    cap(d, (4, 21))
    cap(d, (20, 21))
    return img


DRAWERS = {
    'i-home.png': draw_home,
    'i-train.png': draw_train,
    'i-plan.png': draw_plan,
    'i-chart.png': draw_chart,
    'i-user.png': draw_user,
}

if __name__ == '__main__':
    ROOT = r'C:\Users\Admin\WorkBuddy\HiLife'
    ICON_DIR = os.path.join(ROOT, 'assets', 'icons')
    for name, fn in DRAWERS.items():
        img = fn()
        path = os.path.join(ICON_DIR, name)
        img.save(path, 'PNG')
        print('wrote', path, img.size)

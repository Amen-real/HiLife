# scripts/render-sharecard.py
# 把 scripts/_out/sharecard-ops.json（由 scripts/dump-sharecard-ops.cjs 生成）用 PIL 画成 PNG。
#
# 存在的意义：分享卡的版式好不好看，靠脑补坐标是判断不出来的。
# 这个渲染器只消费 layout() 的真实 ops（同一份几何与配色），
# 因此能在不装微信开发者工具、不开真机的情况下把「图文关系」看一眼。
#
# 已知差异（正常）：字体用系统微软雅黑而非微信内置 sans-serif，字宽会有几个像素出入；
# 真机字宽越界由守卫的 estWidth 断言负责，本渲染器只用于**验收版式与观感**。
#
# 产物落在 scripts/_out/ —— `scripts` 是 folder 级打包忽略目录。
# 曾经直接写在仓库根，产物会被算进主包（`scan-main-package.cjs` 因此超限）。
#
# 用法：node scripts/dump-sharecard-ops.cjs && python scripts/render-sharecard.py
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'scripts', '_out')
SRC = os.path.join(OUT_DIR, 'sharecard-ops.json')
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'

_fonts = {}


def font(size, weight):
    key = (size, weight)
    if key not in _fonts:
        path = FONT_BOLD if (weight or 400) >= 700 else FONT_REG
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]


def anchor_of(align, baseline):
    v = 'm' if baseline == 'middle' else ('a' if baseline == 'alphabetic' else 's')
    h = 'l' if align == 'left' else ('r' if align == 'right' else 'm')
    return h + v


def draw_case(case, scale=1.0):
    w = int(case['w'] * scale)
    h = int(case['h'] * scale)
    img = Image.new('RGB', (w, h), case['bg'])
    d = ImageDraw.Draw(img)

    def S(v):
        return v * scale

    for op in case['ops']:
        t = op['t']
        if t == 'rect':
            box = [S(op['x']), S(op['y']), S(op['x'] + op['w']), S(op['y'] + op['h'])]
            d.rounded_rectangle(
                box, radius=S(op.get('r') or 0), fill=op.get('fill'),
                outline=op.get('stroke'), width=max(1, int(round(S(op.get('lw') or 1)))))
        elif t == 'circle':
            box = [S(op['cx'] - op['r']), S(op['cy'] - op['r']), S(op['cx'] + op['r']), S(op['cy'] + op['r'])]
            d.ellipse(box, fill=op['fill'])
        elif t == 'line':
            d.line([S(op['x1']), S(op['y1']), S(op['x2']), S(op['y2'])],
                   fill=op['color'], width=max(1, int(round(S(op.get('lw') or 1)))))
        elif t == 'body':
            for grp in op['polys']:
                for poly in grp['polys']:
                    pts = [(S(p[0]), S(p[1])) for p in poly]
                    if len(pts) < 3:
                        continue
                    d.polygon(pts, fill=grp['fill'])
                    lw = max(1, int(round(S(grp['lw']))))
                    if lw > 1:
                        d.line(pts + [pts[0]], fill=grp['stroke'], width=lw, joint='curve')
                    else:
                        d.polygon(pts, outline=grp['stroke'])
        elif t == 'text':
            f = font(max(8, int(round(S(op['size'])))), op.get('weight'))
            d.text((S(op['x']), S(op['y'])), op['s'], font=f, fill=op['color'],
                   anchor=anchor_of(op.get('align', 'left'), op.get('baseline', 'alphabetic')))
    return img


def main():
    with open(SRC, 'r', encoding='utf-8') as fh:
        cases = json.load(fh)

    made = []
    for i, case in enumerate(cases, 1):
        img = draw_case(case, 1.0)
        name = 'card-%d.png' % i
        img.save(os.path.join(OUT_DIR, name))
        # 版式验收看的是上半张（身份行 + 解剖 + 指标）—— 该区域放大 1.6× 更看得清
        top = img.crop((0, 0, img.width, min(img.height, 700)))
        top = top.resize((int(top.width * 1.6), int(top.height * 1.6)), Image.LANCZOS)
        zoom = 'card-%d-top.png' % i
        top.save(os.path.join(OUT_DIR, zoom))
        made.append((case['title'], img.size, zip([name, zoom], [img.size, top.size])))

    for title, size, files in made:
        print('%s -> %dx%d' % (title, size[0], size[1]))
        for (n, s) in files:
            print('    %s  %dx%d' % (n, s[0], s[1]))


main()

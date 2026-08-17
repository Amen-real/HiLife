#!/usr/bin/env python3
# compress-food.py
# 把 images/food/*.png 转成 JPG（去透明 + 白底 + 质量 85），显著减小 CDN 流量。
# 运行：python compress-food.py   （脚本放在项目根目录即可）
import os, glob
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'images', 'food')
QUALITY = 85

if not os.path.isdir(SRC):
    print('未找到', SRC)
    raise SystemExit(1)

total_before = total_after = 0
count = 0
for png in sorted(glob.glob(os.path.join(SRC, '*.png'))):
    im = Image.open(png).convert('RGBA')
    # 去透明通道：与白底合成，避免转 JPG 后透明区变黑
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(bg, im).convert('RGB')
    jpg = os.path.splitext(png)[0] + '.jpg'
    flat.save(jpg, 'JPEG', quality=QUALITY, optimize=True)
    b = os.path.getsize(png)
    a = os.path.getsize(jpg)
    total_before += b
    total_after += a
    count += 1
    os.remove(png)
    print(f'{os.path.basename(jpg)}: {b // 1024}KB -> {a // 1024}KB')

print(f'\n完成 {count} 张：{total_before / 1024 / 1024:.1f}MB -> {total_after / 1024 / 1024:.1f}MB')

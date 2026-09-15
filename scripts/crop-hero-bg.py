# -*- coding: utf-8 -*-
"""裁「我的」页 Hero 底图 → static/my-bg.jpg（浅色）+ static/my-bg-dark.jpg（深色）

为什么要裁
----------
设计稿给的是 852×1847 的全屏竖图，但 Hero 只占顶部一块；整张进包会白白吃掉主包体积
（白图 844KB / 黑图 1195KB，主包上限 2MB）。内容（人物 + 品牌绿条）包围盒实测：
    白图 y[0..415]   黑图 y[0..428]（x 都从约 474 起，人物贴右边缘裁切）
所以统一裁到 y=560，下方留给 .p-hero-fade（160rpx）做渐隐收口。

为什么两张必须同尺寸（硬约束）
------------------------------
.p-hero 的 min-height 是一个**按底图高度折算成 rpx 的常量**（560px → 750rpx 宽时 493rpx，
wxss 里写死 494rpx）。若明暗两张高度不同，切主题时 Hero 高度就会跳一下。
同宽同理（宽度都是 100% 铺满，但保持严格同尺寸最省心 —— 源头 851/852 差 1px，此处归一）。
该不变式已固化为 scripts/verify-profile.cjs 的 C7 断言，改图后请务必重跑。

用法
----
    python scripts/crop-hero-bg.py            # 用默认桌面路径
    python scripts/crop-hero-bg.py 白图路径 黑图路径
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_LIGHT = os.path.join(ROOT, "static", "my-bg.jpg")
OUT_DARK = os.path.join(ROOT, "static", "my-bg-dark.jpg")

# 裁切高度 = 内容包围盒下沿(428) + 约 130px 渐隐余量；同时等于 Hero 折算高度所依据的 560px
CROP_H = 560
QUALITY = 92

DEFAULT_SRC = [
    r"C:\Users\Admin\Desktop\我的背景图-白.png",
    r"C:\Users\Admin\Desktop\我的背景图-黑.png",
]


def crop_one(src, dst, target_w=None):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    if h < CROP_H:
        raise SystemExit("%s 高度只有 %d，不足裁切高度 %d" % (src, h, CROP_H))
    out = im.crop((0, 0, w, CROP_H))
    if target_w and out.size[0] != target_w:
        # 源头 851 vs 852 的 1px 差异：归一化宽度，保证两张严格同尺寸
        out = out.resize((target_w, CROP_H), Image.LANCZOS)
    out.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    kb = os.path.getsize(dst) / 1024.0
    print("  %-46s %dx%d  ->  %-28s %5.1f KB" % (
        os.path.basename(src), out.size[0], out.size[1], os.path.basename(dst), kb))
    return out.size


def main():
    args = sys.argv[1:]
    light_src = args[0] if len(args) > 0 else DEFAULT_SRC[0]
    dark_src = args[1] if len(args) > 1 else DEFAULT_SRC[1]
    for p in (light_src, dark_src):
        if not os.path.exists(p):
            raise SystemExit("找不到源图：%s" % p)

    print("裁切 Hero 底图（CROP_H=%d, quality=%d）" % (CROP_H, QUALITY))
    lw, lh = crop_one(light_src, OUT_LIGHT)
    # 以浅色图为准对齐宽度；深色源头 851 宽，此处升到 852（0.12%，肉眼不可辨）
    dw, dh = crop_one(dark_src, OUT_DARK, target_w=lw)

    if (lw, lh) != (dw, dh):
        raise SystemExit("明暗两张尺寸不一致：(%d,%d) vs (%d,%d) —— 切主题会跳版" % (lw, lh, dw, dh))
    print("OK：两张同为 %dx%d；Hero 折算高度 = %d rpx（wxss 里 .p-hero 的 min-height 应约为 %d）"
          % (lw, lh, round(lh * 750.0 / lw), round(lh * 750.0 / lw)))
    print("下一步：node scripts/verify-profile.cjs（C7 会校验同尺寸与体积上限）")


if __name__ == "__main__":
    main()

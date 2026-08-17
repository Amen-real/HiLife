#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""动作图超分工具（健身小程序素材管线）。

用法:
  python upscale.py sample  <src_jpg>            # 生成单图 4x 样张
  python upscale.py compare <src_jpg>            # 生成 朴素拉伸 vs Lanczos 对比图
  python upscale.py batch   <src_dir> <out_dir>  # 批量 4x Lanczos（待真AI超分就绪后替换）

默认放大倍数 scale=4 (180->720)。当前用 OpenCV 高质量插值 (LANCZOS4)。
后续若 modelscope/torch 就绪，可在此切换为 Real-ESRGAN/RRDB 真超分。
"""
import os
import sys
import cv2
import numpy as np

SCALE = 4


def upscale(img, scale=SCALE, method=cv2.INTER_LANCZOS4):
    h, w = img.shape[:2]
    return cv2.resize(img, (w * scale, h * scale), interpolation=method)


def label_bar(img, text):
    bar = np.full((64, img.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, text, (16, 44), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (20, 20, 20), 2, cv2.LINE_AA)
    return np.vstack([bar, img])


def do_sample(src):
    img = cv2.imread(src)
    if img is None:
        raise SystemExit("无法读取: " + src)
    out = upscale(img)
    out_path = src.rsplit(".", 1)[0] + f"_x{SCALE}_lanczos.png"
    cv2.imwrite(out_path, out)
    print("saved:", out_path, out.shape[:2])


def do_compare(src):
    img = cv2.imread(src)
    if img is None:
        raise SystemExit("无法读取: " + src)
    bilinear = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LINEAR)
    lanczos = upscale(img)
    strip = np.hstack([label_bar(bilinear, "Bilinear (current app)"),
                       label_bar(lanczos, f"Lanczos x{SCALE}")])
    d = os.path.dirname(src) or "."
    out = os.path.join(d, "sample_compare.png")
    cv2.imwrite(out, strip)
    print("saved:", out, strip.shape[:2])


def do_batch(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    files = [f for f in os.listdir(src_dir) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    print(f"批量处理 {len(files)} 张 -> {out_dir}")
    for f in files:
        img = cv2.imread(os.path.join(src_dir, f))
        if img is None:
            continue
        out = upscale(img)
        base = os.path.splitext(f)[0]
        cv2.imwrite(os.path.join(out_dir, base + f"_x{SCALE}.png"), out)
    print("批量完成")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    if mode == "sample" and len(sys.argv) > 2:
        do_sample(sys.argv[2])
    elif mode == "compare" and len(sys.argv) > 2:
        do_compare(sys.argv[2])
    elif mode == "batch" and len(sys.argv) > 3:
        do_batch(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(1)

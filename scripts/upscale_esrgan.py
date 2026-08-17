"""ESRGAN (Real-ESRGAN / RRDB x4) 真AI超分样张生成。
读取本地 180x180 动作图，输出 720x720 真超分结果，并生成三方对比图：
  - Bilinear  : 小程序当前朴素拉伸（最糊）
  - Lanczos4  : OpenCV 高质量插值（已验证）
  - ESRGAN x4 : 学习的真AI超分（补细节、去模糊）
依赖：.pylibs_torch (torch + modelscope + numpy + pillow)。
"""
import os
import sys

# 依赖装在 Git Bash 把 /c/ 误转成的错位 Windows 路径下；直接硬编码注入，绕开 PYTHONPATH 分隔符问题
sys.path.insert(0, "C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs_torch")
sys.path.insert(0, "C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs")

import cv2
import numpy as np
from PIL import Image

SRC = "F:/exercises-dataset-main/images/0001-2gPfomN.jpg"
OUT = "C:/Users/Admin/WorkBuddy/HiLife/assets/upscale-sample"
MODEL = "iic/cv_rrdb_image_super-resolution"  # Real-ESRGAN x4 (RRDB)
SCALE = 4

os.makedirs(OUT, exist_ok=True)


def load_src():
    img = cv2.imread(SRC)
    if img is None:
        raise SystemExit(f"read failed: {SRC}")
    print(f"[src] {img.shape}")
    return img


def make_baselines(img):
    bil = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LINEAR)
    lan = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LANCZOS4)
    return bil, lan


def esrgan(img):
    from modelscope.pipelines import pipeline
    from modelscope.utils.constant import Tasks
    print("[esrgan] loading pipeline:", MODEL)
    p = pipeline(Tasks.image_super_resolution, model=MODEL)
    # pipeline 接受图片路径或 numpy；输出含放大后的图像
    res = p(SRC)
    out = None
    # 兼容不同返回结构
    if isinstance(res, dict):
        for k in ("output_img", "output", "image", "result"):
            v = res.get(k)
            if v is not None:
                out = v
                break
    else:
        out = res
    if out is None:
        raise SystemExit(f"esrgan returned unexpected: {type(res)} keys={list(res.keys()) if isinstance(res, dict) else res}")
    # out 可能是 PIL.Image 或 numpy(BGR/RGB)
    if isinstance(out, Image.Image):
        arr = np.array(out)
        out = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR) if arr.ndim == 3 else arr
    else:
        out = np.array(out)
        if out.ndim == 3 and out.shape[2] == 3:
            out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    print(f"[esrgan] result {out.shape}")
    return out


def label(im, text):
    bar = np.full((66, im.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, text, (18, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (15, 15, 15), 2, cv2.LINE_AA)
    return np.vstack([bar, im])


def main():
    img = load_src()
    bil, lan = make_baselines(img)
    eso = esrgan(img)
    # 统一尺寸到 720x720（esrgan 可能非整除，做对齐裁剪/缩放）
    target = (720, 720)
    lan = cv2.resize(lan, target, interpolation=cv2.INTER_LANCZOS4)
    bil = cv2.resize(bil, target, interpolation=cv2.INTER_LANCZOS4)
    if eso.shape[0] != 720 or eso.shape[1] != 720:
        eso = cv2.resize(eso, target, interpolation=cv2.INTER_LANCZOS4)
    cv2.imwrite(os.path.join(OUT, "sample_0001_esrgan.png"), eso)
    strip = np.hstack([label(bil, "Bilinear x4 (小程序当前)"),
                       label(lan, "Lanczos x4 (插值)"),
                       label(eso, "ESRGAN x4 (真AI)")])
    cv2.imwrite(os.path.join(OUT, "sample_triple.png"), strip)
    print("[done] saved:", os.listdir(OUT))


if __name__ == "__main__":
    main()

"""
本地运行脚本（非 WorkBuddy 沙箱）：生成动作图真・AI 超分样张 / 批量结果。

为什么不在沙箱跑：
  - 沙箱内 torch CPU 训练性能极差（SRCNN 500 图 8 轮 13 分钟未出图），无法本地训练；
  - GitHub / HuggingFace 被墙、modelscope 模型 ID 已失效、basicsr 在 py3.13 编译失败，
    外部预训练权重在沙箱拿不到。
本地机器（能联网 + 能装包 + 有正常 CPU/GPU）可直接跑此脚本得到真 AI 超分。

依赖安装（本地终端）：
  pip install realesrgan basicsr facexlib torch opencv-python

用法：
  python realesrgan_local.py --sample          # 只出一张样张看效果（输出到 OUT_DIR）
  python realesrgan_local.py --batch           # 批量 1324 张 -> OUT_DIR
  python realesrgan_local.py --batch --upload  # 批量并回传阿里云 OSS（需先填下方 OSS 配置）

说明：
  - RealESRGAN_x4plus 官方权重首次运行会自动从 GitHub 下载（本地需能访问 github.com）。
  - 批量输出为 720x720 PNG（源 180 -> 4x）。回传 OSS 后前端 media() 按文件名拼接，
    若文件名沿用 <id>-<media_id> 需与线上 utils/exercises.js 的 <id>-<hash> 建立映射（见 README 注释）。
"""

import argparse
import os
import glob
import cv2

# ---------- 路径配置（按你本地实际情况修改）----------
SRC_DIR = r"F:\exercises-dataset-main\images"
OUT_DIR = r"F:\exercises-dataset-main\images_x4"
SAMPLE_ID = "0001-2gPfomN"

# ---------- 阿里云 OSS 配置（批量回传时填写，仅在本地执行）----------
OSS_KEY = "你的AccessKeyId"
OSS_SECRET = "你的AccessKeySecret"
OSS_BUCKET = "hilife-test"
OSS_ENDPOINT = "oss-cn-guangzhou.aliyuncs.com"
OSS_PREFIX = "images/"


def build_upsampler():
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet
    import torch
    from urllib.request import urlretrieve

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32)
    weight_url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
    weight_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "RealESRGAN_x4plus.pth")
    if not os.path.exists(weight_path):
        print("下载权重中:", weight_url)
        urlretrieve(weight_url, weight_path)
    upsampler = RealESRGANer(
        scale=4, model_path=weight_path, model=model,
        tile=0, tile_pad=10, pre_pad=0, half=False)
    return upsampler


def enhance_one(upsampler, path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    output, _ = upsampler.enhance(img, outscale=4)
    return output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true", help="只出一张样张看效果")
    ap.add_argument("--batch", action="store_true", help="批量处理全部动作图")
    ap.add_argument("--upload", action="store_true", help="批量完成后回传 OSS")
    args = ap.parse_args()

    upsampler = build_upsampler()
    os.makedirs(OUT_DIR, exist_ok=True)

    if args.sample:
        src = os.path.join(SRC_DIR, SAMPLE_ID + ".jpg")
        out = enhance_one(upsampler, src)
        if out is None:
            print("读取失败:", src)
            return
        dst = os.path.join(OUT_DIR, SAMPLE_ID + "_x4.png")
        cv2.imwrite(dst, out)
        print("样张已生成:", dst)

    if args.batch:
        files = sorted(glob.glob(os.path.join(SRC_DIR, "*.jpg")))
        print("批量处理", len(files), "张 ->", OUT_DIR)
        for i, f in enumerate(files):
            out = enhance_one(upsampler, f)
            if out is None:
                continue
            base = os.path.splitext(os.path.basename(f))[0]
            cv2.imwrite(os.path.join(OUT_DIR, base + "_x4.png"), out)
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(files)} done")
        print("批量完成 ->", OUT_DIR)

    if args.upload:
        import oss2
        auth = oss2.Auth(OSS_KEY, OSS_SECRET)
        bucket = oss2.Bucket(auth, "https://" + OSS_ENDPOINT, OSS_BUCKET)
        cnt = 0
        for f in os.listdir(OUT_DIR):
            bucket.put_object_from_file(OSS_PREFIX + f,
                                         os.path.join(OUT_DIR, f))
            cnt += 1
        print(f"已回传 OSS {OSS_PREFIX}，共 {cnt} 个文件")


if __name__ == "__main__":
    main()

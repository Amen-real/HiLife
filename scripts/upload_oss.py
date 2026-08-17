"""
本地运行：将沙箱生成的 720 高清动作图回传到阿里云 OSS（_x4 版本）。
（沙箱内无 OSS 凭证，此脚本仅在你本地机器执行）

前置：
  pip install oss2
  # 凭证用环境变量，避免明文写入代码：
  set OSS_KEY=你的AccessKeyId
  set OSS_SECRET=你的AccessKeySecret

用法：
  python upload_oss.py

行为：
  - 读取 assets/action_map.json（沙箱已生成：本地高清图 -> 线上文件名_x4 的映射，共 1295 对）
  - 将 assets/upscaled/<本地文件>.jpg 上传为 OSS 的 images/<线上文件>_x4.jpg
  - 上传完成后，前端 utils/media.js 已配好「动作图优先取 _x4」，无需改业务代码
"""

import os
import json
import oss2

OSS_KEY = os.environ.get("OSS_KEY", "你的AccessKeyId")
OSS_SECRET = os.environ.get("OSS_SECRET", "你的AccessKeySecret")
OSS_BUCKET = "hilife-test"
OSS_ENDPOINT = "oss-cn-guangzhou.aliyuncs.com"


def main():
    with open("assets/action_map.json", encoding="utf-8") as f:
        m = json.load(f)
    pairs = m.get("pairs", [])
    print(f"读取映射 {len(pairs)} 对，开始上传 -> images/*_x4.jpg")

    auth = oss2.Auth(OSS_KEY, OSS_SECRET)
    bucket = oss2.Bucket(auth, "https://" + OSS_ENDPOINT, OSS_BUCKET)

    ok = 0
    for i, pair in enumerate(pairs):
        src = pair["src"]          # 本地文件，如 assets/upscaled/3294-A9qxk2F.jpg
        dst = pair["dst"]          # OSS 对象名，如 images/3294-A9qxk2F_x4.jpg
        bucket.put_object_from_file(dst, src)
        ok += 1
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(pairs)}")
    print(f"DONE 上传 {ok} 个文件 -> {OSS_BUCKET}/{OSS_ENDPOINT}")


if __name__ == "__main__":
    main()

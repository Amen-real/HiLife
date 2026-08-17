# convert_gif_mp4.py
# 把 videos/ 下所有 GIF 批量转成更轻的 MP4（H.264 / yuv420p / 480 宽封顶 / crf30）。
# ffmpeg 通过 imageio-ffmpeg 自带二进制提供，无需系统安装。
# 转码成功且产物非空后，删除原 GIF（本地仅留 MP4，且 videos/ 已被 packOptions.ignore 排除，不进包）。
import os, sys, glob, subprocess, concurrent.futures as cf

BASE = os.path.dirname(os.path.abspath(__file__))
VIDEO_DIR = os.path.join(BASE, 'videos')
OUT_EXT = '.mp4'

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception as e:
    print('ERROR: 找不到 ffmpeg（imageio-ffmpeg 未安装？）:', e); sys.exit(1)

VF = "scale=w='trunc(min(480,iw)/2)*2':h=-2:flags=lanczos,format=yuv420p"

def one(gif_path):
    mp4 = os.path.splitext(gif_path)[0] + OUT_EXT
    cmd = [FFMPEG, '-y', '-i', gif_path,
           '-vf', VF, '-c:v', 'libx264', '-crf', '30', '-preset', 'fast',
           '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        if r.returncode == 0 and os.path.exists(mp4) and os.path.getsize(mp4) > 0:
            try: os.remove(gif_path)
            except OSError: pass
            return (gif_path, os.path.getsize(mp4), True, '')
        return (gif_path, 0, False, f'rc={r.returncode}')
    except Exception as e:
        return (gif_path, 0, False, str(e))

def main():
    gifs = sorted(glob.glob(os.path.join(VIDEO_DIR, '*.gif')))
    total = len(gifs)
    print(f'待转换 GIF: {total} 个', flush=True)
    ok = fail = 0
    in_bytes = out_bytes = 0
    failures = []
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for i, (g, sz, ok_flag, msg) in enumerate(ex.map(one, gifs), 1):
            if ok_flag:
                ok += 1; out_bytes += sz
                ib = os.path.getsize(g) if os.path.exists(g) else 0
            else:
                fail += 1; failures.append((os.path.basename(g), msg))
            if i % 100 == 0 or i == total:
                print(f'进度 {i}/{total}  成功 {ok}  失败 {fail}', flush=True)
    print('=== 完成 ===')
    print(f'成功: {ok}  失败: {fail}')
    print(f'MP4 总体积: {out_bytes/1024/1024:.1f} MB')
    if failures:
        print('失败列表(前20):')
        for f, m in failures[:20]: print('  ', f, m)

if __name__ == '__main__':
    main()

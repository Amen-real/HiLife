import sys, os, glob, time
sys.path.insert(0, 'C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs')
import cv2

SRC = "F:/exercises-dataset-main/images"
OUT = "C:/Users/Admin/WorkBuddy/HiLife/assets/upscaled"
TARGET = 720
QUALITY = 85
os.makedirs(OUT, exist_ok=True)

files = sorted(glob.glob(os.path.join(SRC, "*.jpg")))
print(f"source: {len(files)} jpg, target {TARGET}x{TARGET}, q{QUALITY} -> {OUT}", flush=True)
t0 = time.time()
ok = 0
for i, f in enumerate(files):
    im = cv2.imread(f)
    if im is None:
        continue
    up = cv2.resize(im, (TARGET, TARGET), interpolation=cv2.INTER_LANCZOS4)
    base = os.path.basename(f)
    cv2.imwrite(os.path.join(OUT, base), up, [cv2.IMWRITE_JPEG_QUALITY, QUALITY])
    ok += 1
    if (i + 1) % 100 == 0:
        print(f"  {i + 1}/{len(files)}  t={time.time() - t0:.0f}s", flush=True)
print(f"DONE {ok} files in {time.time() - t0:.0f}s -> {OUT}", flush=True)

import os, sys, time, random
sys.path.insert(0, 'C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs_torch')
sys.path.insert(0, 'C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs')
import cv2, numpy as np
import torch, torch.nn as nn, torch.optim as optim

SRC_DIR = "F:/exercises-dataset-main/images"
OUT = "C:/Users/Admin/WorkBuddy/HiLife/assets/upscale-sample"
MODEL_OUT = "C:/Users/Admin/WorkBuddy/HiLife/assets/models/sr_srcnn_x4.pth"
os.makedirs(OUT, exist_ok=True)
DEV = torch.device('cpu')

class SRCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.feat = nn.Sequential(
            nn.Conv2d(3, 64, 9, padding=4), nn.ReLU(True),
            nn.Conv2d(64, 32, 5, padding=2), nn.ReLU(True))
        self.recon = nn.Conv2d(32, 3, 5, padding=2)
    def forward(self, x):
        return x + self.recon(self.feat(x))

print("loading + precomputing LR/HR pairs (one-time)...", flush=True)
t0 = time.time()
files = [f for f in os.listdir(SRC_DIR) if f.lower().endswith('.jpg')]
pairs = []  # (lr_up uint8, hr uint8)
for f in files:
    im = cv2.imread(os.path.join(SRC_DIR, f))
    if im is None:
        continue
    h, w = im.shape[:2]
    if h % 4 or w % 4:
        im = cv2.resize(im, ((w // 4) * 4, (h // 4) * 4))
    lr = cv2.resize(im, (im.shape[1] // 4, im.shape[0] // 4), interpolation=cv2.INTER_CUBIC)
    lr_up = cv2.resize(lr, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC)
    pairs.append((lr_up, im))
print(f"precomputed {len(pairs)} pairs in {time.time()-t0:.0f}s", flush=True)

def to_t(im):
    return torch.from_numpy(im.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)

random.seed(0)
N = min(500, len(pairs))
use = random.sample(pairs, N)
print(f"training on {N} images for 8 epochs", flush=True)

model = SRCNN().to(DEV)
opt = optim.Adam(model.parameters(), lr=1e-3)
crit = nn.MSELoss()
EPOCHS, BATCH = 8, 32
t0 = time.time()
idx = list(range(N))
for ep in range(EPOCHS):
    random.shuffle(idx)
    for i in range(0, N, BATCH):
        xs, ys = [], []
        for j in idx[i:i + BATCH]:
            lr_up, hr = use[j]
            xs.append(to_t(lr_up))
            ys.append(to_t(hr))
        x = torch.cat(xs).to(DEV)
        y = torch.cat(ys).to(DEV)
        opt.zero_grad()
        loss = crit(model(x), y)
        loss.backward()
        opt.step()
    print(f"epoch {ep+1}/{EPOCHS} loss={loss.item():.4f} t={time.time()-t0:.0f}s", flush=True)

torch.save(model.state_dict(), MODEL_OUT)
print("model saved ->", MODEL_OUT, flush=True)

# ---- 单张样张：取第一张，4x 放大三方对比 ----
hr = pairs[0][1]
lr_up = pairs[0][0]
x = to_t(lr_up).to(DEV)
with torch.no_grad():
    ai = model(x)[0].permute(1, 2, 0).numpy()
ai = np.clip(ai * 255, 0, 255).astype(np.uint8)
bil = cv2.resize(hr, None, fx=4, fy=4, interpolation=cv2.INTER_LINEAR)
lan = cv2.resize(hr, None, fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4)
ai4 = cv2.resize(ai, None, fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4)

def lab(im, t):
    bar = np.full((48, im.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, t, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 20), 2, cv2.LINE_AA)
    return np.vstack([bar, im])

strip = np.hstack([
    lab(bil, "Bilinear (now)"),
    lab(lan, "Lanczos x4"),
    lab(ai4, "SRCNN AI x4"),
])
cv2.imwrite(os.path.join(OUT, "sample_ai_compare.png"), strip)
cv2.imwrite(os.path.join(OUT, "sample_srcnn_0001.png"), ai4)
print("saved sample_ai_compare.png + sample_srcnn_0001.png", flush=True)

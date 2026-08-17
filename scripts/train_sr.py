"""离线训练 RRDB 超分模型（用本地 1324 张动作图自监督），训练完直接出对比样张。
优化：启动阶段一次性把全部图读入内存并预计算 LR，训练循环零磁盘 I/O。
"""
import os
import sys
import glob

sys.path.insert(0, "C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs_torch")
sys.path.insert(0, "C:/c/Users/Admin/WorkBuddy/HiLife/.pylibs")

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

from srmodel import SRNet

IMG_DIR = "F:/exercises-dataset-main/images"
SAMPLE = "F:/exercises-dataset-main/images/0001-2gPfomN.jpg"
OUT = "C:/Users/Admin/WorkBuddy/HiLife/assets/upscale-sample"
CKPT = "C:/Users/Admin/WorkBuddy/HiLife/assets/models/sr_x4.pth"
HR_SIZE = 180
SCALE = 4
EPOCHS = 25
BATCH = 8


def preload(paths):
    lrs, hrs = [], []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            continue
        img = cv2.resize(img, (HR_SIZE, HR_SIZE), interpolation=cv2.INTER_AREA)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        hr = torch.from_numpy(img).permute(2, 0, 1)
        lr = F.interpolate(hr.unsqueeze(0), scale_factor=1 / SCALE, mode="bicubic",
                           align_corners=False).squeeze(0)
        lrs.append(lr); hrs.append(hr)
    return lrs, hrs


class MemDataset(Dataset):
    def __init__(self, lrs, hrs):
        self.lrs, self.hrs = lrs, hrs

    def __len__(self):
        return len(self.lrs)

    def __getitem__(self, i):
        return self.lrs[i], self.hrs[i]


def charbonnier(x, y, eps=1e-3):
    return torch.mean(torch.sqrt((x - y) ** 2 + eps ** 2))


def main():
    os.makedirs(os.path.dirname(CKPT), exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    paths = sorted(glob.glob(os.path.join(IMG_DIR, "*.jpg")))
    print(f"[data] loading {len(paths)} images into memory ...", flush=True)
    lrs, hrs = preload(paths)
    print(f"[data] ready: {len(lrs)} samples", flush=True)

    torch.manual_seed(0)
    device = torch.device("cpu")
    model = SRNet(nf=32, nb=6, gc=16, scale=SCALE).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-4)

    ds = MemDataset(lrs, hrs)
    dl = DataLoader(ds, batch_size=BATCH, shuffle=True, num_workers=0)

    model.train()
    for ep in range(EPOCHS):
        tot, n = 0.0, 0
        for lr, hr in dl:
            lr, hr = lr.to(device), hr.to(device)
            sr = model(lr)
            loss = charbonnier(sr, hr)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item() * lr.size(0); n += lr.size(0)
        print(f"[epoch {ep+1}/{EPOCHS}] loss={tot/n:.5f}", flush=True)
        torch.save(model.state_dict(), CKPT)

    print("[train] done, ckpt ->", CKPT, flush=True)

    # ---- 推理样张 ----
    model.eval()
    img = cv2.imread(SAMPLE)
    h, w = img.shape[:2]
    lr = cv2.resize(img, (w // SCALE, h // SCALE), interpolation=cv2.INTER_CUBIC)
    lin = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LINEAR)
    lan = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LANCZOS4)
    t = torch.from_numpy(lr.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0)
    with torch.no_grad():
        sr = model(t).squeeze(0).permute(1, 2, 0).numpy()
    sr = np.clip(sr * 255.0, 0, 255).astype(np.uint8)
    sr = cv2.cvtColor(sr, cv2.COLOR_RGB2BGR)

    target = (w * SCALE, h * SCALE)
    lin = cv2.resize(lin, target, interpolation=cv2.INTER_LINEAR)
    lan = cv2.resize(lan, target, interpolation=cv2.INTER_LANCZOS4)
    sr = cv2.resize(sr, target, interpolation=cv2.INTER_LANCZOS4)

    def label(im, text):
        bar = np.full((66, im.shape[1], 3), 255, np.uint8)
        cv2.putText(bar, text, (18, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (15, 15, 15), 2, cv2.LINE_AA)
        return np.vstack([bar, im])

    cv2.imwrite(os.path.join(OUT, "sample_0001_selfsr.png"), sr)
    strip = np.hstack([label(lin, "Bilinear x4 (小程序当前)"),
                       label(lan, "Lanczos x4 (插值)"),
                       label(sr, "Self-trained RRDB x4 (真AI)")])
    cv2.imwrite(os.path.join(OUT, "sample_triple.png"), strip)
    print("[done] sample_triple.png + sample_0001_selfsr.png saved", flush=True)


if __name__ == "__main__":
    main()

# 自托管 CalorieScan 桥接服务

把「拍菜品图 → 出热量」的视觉模型跑在你自己的服务器上，供微信小程序 `wx.uploadFile` 调用。

- `app.py`：FastAPI 服务，`POST /analyze`（multipart 图片字段名 `image`）→ 返回热量/重量 JSON；`GET /health` 健康检查。
- `analyzer.py`：推理封装。默认 **mock 模式**（无需 GPU/模型即可跑通小程序链路）；设置环境变量后切换为 **CalorieScan 真实推理**。

## 1. 本地开发（mock 模式，零依赖跑通链路）

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
# 或 uvicorn app:app --host 0.0.0.0 --port 8000
```

健康检查：`curl http://localhost:8000/health` → `{"status":"ok","model_loaded":false,"mock":true}`
识别测试：`curl -F image=@demo.jpg http://localhost:8000/analyze`

小程序端 `utils/caloriescan.js` 的 `backendUrl` 默认指向 `http://192.168.1.100:8000`，
开发期在微信开发者工具勾选「不校验合法域名」即可直连本机/局域网服务。

## 2. 接入 CalorieScan 真实模型

1. 克隆官方仓库到服务器（含 YOLOv8 / SAM / MiDaS 权重与 pipeline）：
   `git clone https://github.com/ChenYY-Offical/CalorieScan-Food-Calorie-API.git /opt/caloriescan`
2. 按其 `requirements.txt` 安装推理依赖（torch / ultralytics / segment-anything 等，**建议 GPU + CUDA 版**）。
3. 启动本桥接服务时设置环境变量：

```bash
export CALORIESCAN_REAL=1
export CALORIESCAN_REPO=/opt/caloriescan
export MODELS_DIR=/opt/caloriescan/model_training/outputs
uvicorn app:app --host 0.0.0.0 --port 8000
```

`analyzer.py` 会尝试 `from model_training.caloriscan_api import analyze` 作为推理入口；
不同版本函数名/签名可能不同，按实际仓库在 `analyzer.py` 的 `# ↓↓↓ 按你克隆的...` 处调整导入与 `_map_caloriescan` 字段映射即可。

## 3. 生产部署注意

- 微信小程序 `uploadFile` **要求 HTTPS 且仅允许备案域名**：用 Nginx/Caddy 反代并配置证书，
  在小程序后台「开发设置 → 服务器域名 → uploadFile 合法域名」登记你的域名（不要带端口路径）。
- 建议用 Docker（`Dockerfile` 已就绪）或在有 GPU 的机器上 `docker run --gpus all` 启动，模型加载在内存，避免每次冷启动。
- 真实推理较慢且占显存，生产可加队列/限流，并把 `debug` 图回传关掉只返回 JSON。

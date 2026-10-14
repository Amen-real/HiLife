# 自托管 CalorieScan 桥接服务

把「拍菜品图 → 出热量」的视觉模型跑在你自己的服务器上，供微信小程序 `wx.uploadFile` 调用。

- `app.py`：FastAPI 服务。`POST /analyze`（multipart 图片字段名 `image`，同步）；`POST /task/submit` + `GET /task/{id}`（云托管 `callContainer` 用的异步链路，避开 15s 硬超时）；`GET /health` 健康检查。
- `vision_llm.py`：**多模态大模型识别（生产推荐）** —— 只需环境变量 `LLM_API_KEY`，无需 GPU、无需模型权重。
  当前默认接**智谱 `glm-4.6v-flash`**（永久免费，OpenAI 兼容，视觉推理强于 4v-flash）。注册：https://open.bigmodel.cn →
  手机号注册 → 「API keys」创建密钥。只配 `LLM_API_KEY` 即可（BASE_URL/MODEL 已是智谱默认值）：

  ```bash
  export LLM_API_KEY=你的智谱key
  # 可省略（已是默认）：LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
  # 可省略（已是默认）：LLM_MODEL=glm-4.6v-flash
  # 可省略（已是默认）：LLM_FALLBACK_MODEL=glm-5.3-flashx
  ```

  免费档并发 1-2，高峰 429 是**持续性**的。两级缓冲：① 同模型退避重试 2 次（2s/4s）；
  ② 仍 429 ⇒ **自动故障转移**到 `LLM_FALLBACK_MODEL`（glm-5.3-flashx，付费 tokens 池、
  限流宽松）完成本次识别，用户无感。该备用模型按量计费（输入 2 元/M、输出 7 元/M，
  单次识别约 2000 tokens ≈ 0.4-0.5 分）；设 `LLM_FALLBACK_MODEL=`（空）可禁用转移。
  备选供应商（改 LLM_BASE_URL / LLM_MODEL / LLM_FALLBACK_MODEL 三个环境变量即可切换，无需改代码）：
  - 阿里云百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`：
    ⚠️ 其 VL 模型下线频繁（qwen-vl-plus 2026-07 下线、qwen3-vl-flash 2026-10-10 下线），
    启用前先到模型广场确认在售；当前替代 `qwen3.6-flash` 为混合思考模型，
    **必须**在 `vision_llm.py` 的 payload 加 `"enable_thinking": false`，否则易撞 50s 超时。
- `analyzer.py`：自托管 CalorieScan 推理封装。需 `CALORIESCAN_REAL=1` + `CALORIESCAN_REPO` 指向已克隆仓库。

> ⚠️ **两条路都没配好时不再回退 mock**（2026-09-28 起）：`/analyze` 返回 **503**、异步任务 `status=error`，并带 `{code, message}` —— `code` 供小程序翻成用户文案（`utils/foodvision.js` 的 `userMessage()`），`message` 供运维排查。
> 此前的行为是**静默返回一份写死的示例数据**（鸡胸肉沙拉 280g / 360kcal）。它长得和真实结果一样，用户会把这份假热量当成自己那盘菜记进饮食 —— 那是事故，不是兜底。

## 1. 本地开发

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
# 或 uvicorn app:app --host 0.0.0.0 --port 8000
```

健康检查：`curl http://localhost:8000/health` → `{"status":"ok","llm":false,"model_loaded":false,"ready":false,"reason":"..."}`
`ready=false` 时 `reason` 就是「该配哪一项」；此时识别返回 **503**，**不会**给假数据。
识别测试：`curl -F image=@demo.jpg http://localhost:8000/analyze`
本地想立刻跑通，最省事的是配一个 `LLM_API_KEY`（见 `vision_llm.py`）。需要完全离线的联调请用旁的 `../vision-server/`（独立的开发服务，与生产链路互不影响）。

小程序端不走第三方库：把 `app.js` 的 `globalData.useCallContainer` 置为 `false`，并在
`globalData.visionBackendUrl` 填本机/局域网地址（如 `http://<你的局域网IP>:8000`）。
该字段**默认留空、不入库** —— 局域网地址随机器和网段变化，写死只会误导后来者。
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

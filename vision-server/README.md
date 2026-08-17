# HiLife 食物视觉识别服务（vision-server）

把「拍照 / 选图」变成结构化的食物宏量营养素（热量 + 蛋白 / 碳水 / 脂肪）。

小程序端 `wx.uploadFile` 把图片传到 `POST /analyze`，后端用多模态大模型（视觉 LLM）
识别图中食物并返回 JSON。**未配置任何 key 时自动回退 mock 数据**，链路照样跑通。

## 接口

- `GET /health` → `{"status":"ok","provider":"openai","model_loaded":false,"mock":true}`
- `POST /analyze`（form-data 字段 `image` = 图片文件）→
  ```json
  {
    "foods": [
      {"name":"鸡胸肉（约120g）","portion":"约120g","calories":198,
       "protein":37.0,"carb":0.0,"fat":4.3,"confidence":0.7}
    ],
    "total": {"calories":390,"protein":42.8,"carb":40.4,"fat":5.8},
    "note":"...",
    "mock": true,
    "provider": "openai"
  }
  ```

## 本地运行（开发）

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
# 无 key 即为 mock 模式，可直接联调小程序
```

## 接真实视觉模型（三选一，环境变量）

### 方案 A：OpenAI 兼容接口（推荐，覆盖 OpenAI / Azure / DeepSeek / Moonshot / 通义等）
```bash
export VISION_PROVIDER=openai
export OPENAI_API_KEY=sk-xxxx
export OPENAI_BASE_URL=https://api.openai.com/v1   # 第三方兼容服务改这里
export VISION_MODEL=gpt-4o-mini                    # 或 gpt-4o / 任意支持图片的模型
```

### 方案 B：Google Gemini
```bash
export VISION_PROVIDER=gemini
export GEMINI_API_KEY=xxxx
export GEMINI_MODEL=gemini-1.5-flash               # 或 gemini-2.0-flash
```

> 没设 key 时 `mock=true`，返回演示数据；设了 key 但调用失败也会自动回退 mock 并在 `note/error` 中说明。

## 生产部署（Docker）

```bash
docker build -t hilife-vision .
docker run -d -p 8000:8000 \
  -e VISION_PROVIDER=openai -e OPENAI_API_KEY=sk-xxxx -e VISION_MODEL=gpt-4o-mini \
  hilife-vision
```

建议放在 HTTPS 反向代理（Nginx / Caddy）后，再把域名加到小程序后台
「开发设置 → 服务器域名 → uploadFile 合法域名」。

## 与小程序对接要点

- 小程序端封装在 `utils/foodvision.js`，后端地址读 `app.js` 的 `globalData.visionBackendUrl`。
- 真机调试时把该地址改成后端所在机器的局域网 IP（如 `http://192.168.1.100:8000`），
  并勾选开发者工具「不校验合法域名」。
- 识别结果在小程序「食物识别(food-vision)」页展示，可按餐别记录到今日饮食。

---

## 微信云托管部署（推荐上线方案）

**为什么用云托管**：小程序用 `wx.cloud.callContainer` 调云托管服务时，走微信内网，
**无需在微信后台配置服务器域名、也无需 ICP 备案域名**，最省心。本仓库已为此适配：
- `app.py` 监听云托管注入的 `PORT` 环境变量（本地默认 8000），且 `/analyze`
  **同时支持** multipart（开发期 uploadFile）与 JSON base64（线上 callContainer）。
- `Dockerfile` 用 `uvicorn ... --port ${PORT:-80}` 启动。
- 小程序端 `utils/foodvision.js` 在 `globalData.useCallContainer=true` 时自动走 callContainer
  （前端先把图压到 ~480px / quality 20 再 base64，满足云托管 100K 请求体限制）。

### 后端部署（控制台操作）
1. 登录 [云开发 CloudBase 控制台](https://console.cloud.tencent.com/tcb)，选择你的环境
   （即 `app.js` 里 `cloudEnv` 对应的环境），进入「云托管」→「立即开通」。
2. 「服务管理」→「新建服务」，服务名称填 `hilife-vision`（须与 `app.js` 的 `visionService` 一致），
   访问设置可**关闭公网访问**（仅小程序内网调用即可，顺便防 DDoS）。
3. 部署方式选「代码包 / 镜像」，上传本 `vision-server/` 目录（含 Dockerfile / app.py / vision.py /
   requirements.txt），平台按 Dockerfile 构建镜像。
4. 「服务设置」中：
   - 监听端口填 `80`；
   - 实例副本数**最小设为 1**（避免冷启动导致首请求慢/超时）；
   - 环境变量（关键，key 不落代码）：
     - `VISION_PROVIDER=openai`
     - `OPENAI_API_KEY=sk-你的百炼key`
     - `OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
     - `VISION_MODEL=qwen-vl-max`
5. 部署完成后，点开服务「API 调试」或用 `wx.cloud.callContainer` 自测 `/health`、`/analyze`。

### 小程序侧（代码已就绪，确认两项）
- `app.js` 的 `globalData`：
  - `useCallContainer: true`（走 callContainer，免备案）
  - `cloudEnv: '你的云开发环境ID'`（已填现网环境，若云托管在别的环境改这里）
  - `visionService: 'hilife-vision'`（与控制台服务名一致）
- 开发者工具确认调试基础库 **>= 2.13.1**（`wx.cloud.init` 已在 `app.js` 的 `onLaunch` 调用）。

### 关键约束 / 注意
- **100K 请求体**：callContainer 对请求体有 100K 限制，故前端强制压缩图片；若日后需要更高画质，
  可改为「云托管对象存储先传图、后端拉取」或走「公网访问 + 备案域名 + 普通 uploadFile」。
- **超时 15s**：视觉模型识别可能偏慢，若频繁超时可在云托管「服务设置」调大容器规格。
- 想切回「自有服务器 + 备案域名」模式：把 `useCallContainer` 改为 `false`，并将
  `visionBackendUrl` 改为 `https://你的备案域名`，再到微信后台把该域名加入
  「服务器域名 → uploadFile 合法域名」即可，后端无需改动。

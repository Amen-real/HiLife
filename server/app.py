# server/app.py
# HiLife 食物识别桥接服务（FastAPI）
#
# 三条调用路径：
#   POST /analyze        同步识别（multipart 图片字段 image）—— 局域网 wx.uploadFile 用，向后兼容
#   POST /task/submit    异步提交（multipart 图片 或 JSON {"image":"data:image/..;base64,.."}）
#                        —— 云托管 callContainer 用（callContainer 有 15s 硬超时，识别必须异步）
#   GET  /task/{task_id} 轮询任务：{status: processing|done|error, result?}
#
# 识别引擎优先级：LLM（需环境变量 LLM_API_KEY，见 vision_llm.py）→ CalorieScan 真实模型 → mock
import base64
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware

import analyzer

try:
    import vision_llm
except Exception:  # pragma: no cover
    vision_llm = None

app = FastAPI(title="HiLife Food Vision", version="2.0.0")

# 允许跨域：本地开发/小程序调用需开启；生产可收紧为具体域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- 异步任务存储（单实例内存态；云托管最小实例数保持 1 即可） ----------
TASKS = {}        # task_id -> {"status": processing|done|error, ...result}
TASK_ORDER = []   # 插入顺序，用于淘汰旧任务

def _remember(task_id: str, value: dict):
    TASKS[task_id] = value
    TASK_ORDER.append(task_id)
    while len(TASK_ORDER) > 200:
        TASKS.pop(TASK_ORDER.pop(0), None)

def _run_task(task_id: str, data: bytes, filename: str):
    try:
        if vision_llm is not None and vision_llm.llm_ready():
            result = vision_llm.analyze_bytes(data, filename)
        else:
            result = analyzer.analyze(data, filename)  # CalorieScan / mock 回退
        result["status"] = "done"
        _remember(task_id, result)
    except Exception as e:  # noqa: BLE001
        _remember(task_id, {"status": "error", "message": str(e)})

def _decode_b64_image(s: str) -> bytes:
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    return base64.b64decode(s)


@app.get("/health")
def health():
    llm_on = bool(vision_llm is not None and vision_llm.llm_ready())
    return {
        "status": "ok",
        "model_loaded": analyzer.is_ready(),
        "mock": analyzer.is_mock() and not llm_on,
        "llm": llm_on,
    }


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    data = await image.read()
    return analyzer.analyze(data, image.filename or "image.jpg")


@app.post("/task/submit")
async def task_submit(request: Request, image: UploadFile = File(None)):
    """异步提交：立即返回 {taskId}，识别在后台线程执行。"""
    ct = (request.headers.get("content-type") or "").lower()
    if "application/json" in ct:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            return {"status": "error", "message": "invalid json body"}
        try:
            data = _decode_b64_image(body.get("image") or "")
        except Exception:  # noqa: BLE001
            return {"status": "error", "message": "invalid base64 image"}
        filename = (body.get("filename") if isinstance(body, dict) else None) or "camera.jpg"
    else:
        if image is None:
            return {"status": "error", "message": "missing image"}
        data = await image.read()
        filename = image.filename or "image.jpg"

    if not data:
        return {"status": "error", "message": "empty image"}

    task_id = uuid.uuid4().hex
    _remember(task_id, {"status": "processing"})
    threading.Thread(target=_run_task, args=(task_id, data, filename), daemon=True).start()
    return {"taskId": task_id, "status": "processing"}


@app.get("/task/{task_id}")
def task_get(task_id: str):
    t = TASKS.get(task_id)
    if not t:
        return {"status": "error", "message": "task not found or expired"}
    return t


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

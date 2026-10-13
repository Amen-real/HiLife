# server/app.py
# HiLife 食物识别桥接服务（FastAPI）
#
# 三条调用路径：
#   POST /analyze        同步识别（multipart 图片字段 image）—— 局域网 wx.uploadFile 用，向后兼容
#   POST /task/submit    异步提交（multipart 图片 或 JSON {"image":"data:image/..;base64,.."}）
#                        —— 云托管 callContainer 用（callContainer 有 15s 硬超时，识别必须异步）
#   GET  /task/{task_id} 轮询任务：{status: processing|done|error, result?}
#
# 识别引擎：LLM（需环境变量 LLM_API_KEY，见 vision_llm.py）优先 → CalorieScan 真实模型。
# 两者都不可用时**明确报错**（503 / task.status=error），不再回退 mock ——
# 静默返回假热量会让用户把示例数据当成自己那餐记录，见 analyzer.py 顶部说明。
#
# VISION_MODE=fixture：**显式开关**下启用固定夹具（见 fixture.py）。
#   存在的意义：让「拍照 → 识别 → 纠错 → 入库 → 复盘」整条回路在
#   不调大模型（花钱、慢）的前提下也能跑通，供 CI 与离线演示使用。
#   ⚠️ 它**只可能优先于真实引擎，绝不可能兜底**：真实引擎不可用时照旧抛
#     EngineNotReady。fixture 抢兜底位 = 把「服务坏了」变成「返回假热量」。
#   ⚠️ 默认关闭。开关名拼错（如 'Fixture'）一律视为未启用 ⇒ 照旧走真实链路。
import base64
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import analyzer
import fixture

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

# ---------- 异步任务存储（单实例内存态） ----------
# ⚠️ 部署前提：云托管**必须固定为 1 个实例**（最小实例数 = 1、最大实例数 = 1）。
#    这张表只在进程内存里 ⇒ 一旦扩到多实例、或缩容/发布重启，轮询就会打到「没有这个 taskId」
#    的实例，用户侧表现为**随机失败**（见 task_get 的 VISION_TASK_LOST）。
#    客户端已加「任务丢失 → 自动重提一次」兜底，但那只是补救，不是允许你把实例数放开。
TASKS = {}        # task_id -> {"status": processing|done|error, ...result}
TASK_ORDER = []   # 插入顺序，用于淘汰旧任务

def _remember(task_id: str, value: dict):
    TASKS[task_id] = value
    TASK_ORDER.append(task_id)
    while len(TASK_ORDER) > 200:
        TASKS.pop(TASK_ORDER.pop(0), None)

def _run_task(task_id: str, data: bytes, filename: str):
    try:
        # ⚠️ 判定顺序 = 「显式开关 > 真实引擎」。fixture 只可能排在真实引擎**之前**，
        #   永远不可能出现在 except / else 里 —— 这条是 fixture.py 铁律 1 的落点。
        if fixture.fixture_enabled():
            result = fixture.analyze(data, filename)
        elif vision_llm is not None and vision_llm.llm_ready():
            result = vision_llm.analyze_bytes(data, filename)
        else:
            result = analyzer.analyze(data, filename)  # CalorieScan 真实模型（无 mock 兜底）
        result["status"] = "done"
        _remember(task_id, result)
    except analyzer.EngineNotReady as e:
        # 引擎不可用：message 是给运维排查的人话，code 才是跨端给用户翻译用的键
        print("[vision] 引擎不可用：", e)
        _remember(task_id, {"status": "error", "code": e.code, "message": str(e)})
    except Exception as e:  # noqa: BLE001
        # 把异常自带的 code 带出去：vision_llm.LLMError 会分门别类（超时 / 额度 / 鉴权 / 模型名）。
        # 旧实现无论什么异常都写死 VISION_FAILED ⇒ 上游 401/429 也被翻成
        # 「换一张更清晰的照片再试试」，用户重拍一百次也没用。只有真没有 code 的才兜底。
        code = getattr(e, "code", None) or "VISION_FAILED"
        print("[vision] 识别失败(%s)：" % code, repr(e))
        _remember(task_id, {"status": "error", "code": code, "message": str(e)})

def _decode_b64_image(s: str) -> bytes:
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    return base64.b64decode(s)


@app.get("/health")
def health():
    """健康检查。/ready=false 时 reason 里是「该配哪一项」的人话，可直接拿去排查。"""
    # 夹具开启时如实上报，绝不让「跑的是假数据」这件事只能靠翻日志发现。
    fx = fixture.describe()
    if fx["fixture"]:
        out = {"status": "ok", "fixture": True, "ready": True, "mode": fx["mode"], "warning": fx["warning"]}
        return out
    llm_on = bool(vision_llm is not None and vision_llm.llm_ready())
    model_on = analyzer.is_ready()
    out = {
        "status": "ok",
        "llm": llm_on,
        "model_loaded": model_on,
        "ready": llm_on or model_on,
        "fixture": False,
    }
    if not out["ready"]:
        out["reason"] = analyzer.not_ready_reason()
    return out


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    data = await image.read()
    try:
        if fixture.fixture_enabled():
            return fixture.analyze(data, image.filename or "image.jpg")
        return analyzer.analyze(data, image.filename or "image.jpg")
    except analyzer.EngineNotReady as e:
        # 引擎不可用是**服务端配置问题**，不是用户输入问题 → 503 而不是 400，
        # 并把「该配哪一项」原样带出去，让小程序端能直接弹给用户 / 让运维一眼看到。
        raise HTTPException(status_code=503, detail={"code": e.code, "message": str(e)})


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
        # 必须带 code。不带 code 会被客户端兜底成 VISION_FAILED ⇒ 用户看到
        # 「换一张更清晰的照片再试试」，而实际上是任务在这台实例上不存在（丢了）。
        # 客户端拿到 VISION_TASK_LOST 会**自动重提一次**，用户通常感觉不到。
        return {
            "status": "error",
            "code": "VISION_TASK_LOST",
            "message": "task not found or expired（本实例上没有此任务：可能重启 / 缩容 / 多实例）",
        }
    return t


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

# server/analyzer.py
# CalorieScan 推理封装：真实模式调用自托管 CalorieScan 的视觉模型。
#
# ⚠️ 这里**没有 mock 兜底**（2026-09-28 移除）。
#   原先「未配置模型」时会静默返回一份写死的示例数据（鸡胸肉沙拉 280g / 360kcal）。
#   它长得和真实结果一模一样，小程序端还会把它带「（示例数据）」一起写进今日饮食 ——
#   用户会把这份假热量当成自己那盘菜记下来。**那是事故，不是兜底。**
#   现在：引擎未就绪 / 推理失败，一律抛 EngineNotReady，由 app.py 变成明确的
#   HTTP 503 或 task.status=error，小程序端据此提示「识别服务未就绪」。宁可报错，不给假数据。
#
#   本地联调请二选一（不要靠 mock）：
#     · 配 LLM_API_KEY（推荐，见 vision_llm.py）—— 生产走的也是这条
#     · CALORIESCAN_REAL=1 + CALORIESCAN_REPO 指向已克隆的 CalorieScan 仓库
#   （局域网联调用的独立开发服务在 ../vision-server/，那边的 mock 与生产链路无关。）
#
# 输入：图片字节 bytes
# 输出：统一合约 dict
# {
#   "success": bool,
#   "name": str,
#   "items": [ {"name": str, "weight_g": int, "calories": int} ],
#   "total_weight_g": int,
#   "total_calories": int,
#   "confidence": float|null,
#   "mock": bool,          # 恒 False：本模块已无 mock 路径，保留字段是为了让合约不变
#   "note": str
# }

import os


class EngineNotReady(RuntimeError):
    """视觉识别引擎不可用。

    message 是**给运维排查的人话**（含「去配哪个环境变量」），会进 /health 与日志；
    **不要直接甩给终端用户**。跨端只传 code，由小程序 utils/foodvision.js 的 userMessage()
    翻成用户看得懂的一句话（那里是「用户可见文案」的唯一真源）。
    """

    code = "VISION_NOT_READY"

    def __init__(self, message, code=None):
        super().__init__(message)
        if code:
            self.code = code


# ---- 配置（环境变量）----
# 克隆的 CalorieScan 仓库根目录，例如 /opt/CalorieScan-Food-Calorie-API
CALORIESCAN_REPO = os.environ.get("CALORIESCAN_REPO", "")
# 模型权重目录
MODELS_DIR = os.environ.get("MODELS_DIR", "models")
# 是否启用真实模型（1 启用）
USE_REAL = os.environ.get("CALORIESCAN_REAL", "0") == "1"

_ready = False
_analyzer_fn = None
_load_error = ""

if USE_REAL:
    try:
        import sys
        if CALORIESCAN_REPO and CALORIESCAN_REPO not in sys.path:
            sys.path.insert(0, CALORIESCAN_REPO)
        # 该仓库 model_training/caloriscan_api.py 提供完整推理 pipeline。
        # 常见入口为 analyze / predict / run_pipeline，签名为 (image) -> dict。
        from model_training.caloriscan_api import analyze as _cs_analyze
        _analyzer_fn = _cs_analyze
        _ready = True
    except Exception as e:  # noqa: BLE001
        _load_error = repr(e)
        print("[CalorieScan] 真实模型加载失败：", _load_error)


def is_ready():
    return _ready


def not_ready_reason():
    """引擎为什么不可用 —— 直接给用户看的人话，含「该配哪一项」。"""
    if not USE_REAL:
        return (
            "食物识别服务未就绪：服务端未启用识别引擎。"
            "请在云托管服务设置里配置环境变量 LLM_API_KEY（推荐，走多模态大模型）；"
            "或设 CALORIESCAN_REAL=1 并把 CALORIESCAN_REPO 指向已克隆的 CalorieScan 仓库。"
        )
    return (
        "食物识别服务未就绪：CalorieScan 模型加载失败（"
        + (_load_error or "原因未知")
        + "）。请检查 CALORIESCAN_REPO / MODELS_DIR 与模型权重是否就位。"
    )


def _map_caloriescan(raw):
    """将 CalorieScan 返回结构映射为本服务合约。
    按实际字段调整：常见返回含 weight / calories / confidence 等。"""
    if not isinstance(raw, dict):
        raise EngineNotReady(
            "CalorieScan 返回结构无法解析（期望 dict，实际 %s）。" % type(raw).__name__,
            code="VISION_FAILED",
        )
    total_cal = raw.get("calories") or raw.get("total_calories") or raw.get("kcal")
    total_w = raw.get("weight") or raw.get("total_weight_g") or raw.get("weight_g")
    items = raw.get("items") or []
    name = raw.get("name") or (items[0].get("name") if items else "识别到的食物")
    if not total_cal:
        # 没热量的「识别结果」对本 App 毫无意义，而且会让用户看到一张空卡
        raise EngineNotReady(
            "模型未返回热量数值。", code="VISION_FAILED"
        )
    return {
        "success": True,
        "name": name,
        "items": items,
        "total_weight_g": total_w,
        "total_calories": total_cal,
        "confidence": raw.get("confidence"),
        "mock": False,
        "note": raw.get("note") or "由自托管 CalorieScan 模型识别。",
    }


def analyze(image_bytes: bytes, filename: str = "image.jpg"):
    if not _ready or _analyzer_fn is None:
        raise EngineNotReady(not_ready_reason())
    try:
        import io
        import tempfile

        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # 兼容不同签名：先传 PIL.Image，失败再传临时文件路径
        try:
            raw = _analyzer_fn(img)
        except TypeError:
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.write(image_bytes)
            tmp.close()
            raw = _analyzer_fn(tmp.name)
        return _map_caloriescan(raw)
    except EngineNotReady:
        raise
    except Exception as e:  # noqa: BLE001
        print("[CalorieScan] 推理异常：", repr(e))
        # 不再「回退 mock」：把失败如实报出去，让用户看到原因，而不是看到一份假热量
        raise EngineNotReady("模型推理出错（%s）。" % e, code="VISION_FAILED")

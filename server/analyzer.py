# server/analyzer.py
# CalorieScan 推理封装：真实模式调用自托管 CalorieScan 的视觉模型，
# 未配置/加载失败时回退 mock 模式，保证小程序端链路可联调。
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
#   "mock": bool,
#   "note": str
# }

import os

# ---- 配置（环境变量）----
# 克隆的 CalorieScan 仓库根目录，例如 /opt/CalorieScan-Food-Calorie-API
CALORIESCAN_REPO = os.environ.get("CALORIESCAN_REPO", "")
# 模型权重目录
MODELS_DIR = os.environ.get("MODELS_DIR", "models")
# 是否启用真实模型（1 启用；0 或缺失则用 mock）
USE_REAL = os.environ.get("CALORIESCAN_REAL", "0") == "1"

_ready = False
_analyzer_fn = None

if USE_REAL:
    try:
        import sys
        if CALORIESCAN_REPO and CALORIESCAN_REPO not in sys.path:
            sys.path.insert(0, CALORIESCAN_REPO)
        # ↓↓↓ 按你克隆的 CalorieScan 仓库调整导入 ↓↓↓
        # 该仓库 model_training/caloriscan_api.py 提供完整推理 pipeline。
        # 常见入口为 analyze / predict / run_pipeline，签名为 (image) -> dict。
        from model_training.caloriscan_api import analyze as _cs_analyze
        _analyzer_fn = _cs_analyze
        _ready = True
    except Exception as e:  # noqa: BLE001
        print("[CalorieScan] 真实模型加载失败，回退 mock 模式：", repr(e))
        _ready = False


def is_ready():
    return _ready


def is_mock():
    return not _ready


def mock_result():
    items = [{"name": "鸡胸肉沙拉", "weight_g": 280, "calories": 360}]
    return {
        "success": True,
        "name": "鸡胸肉沙拉",
        "items": items,
        "total_weight_g": 280,
        "total_calories": 360,
        "confidence": 0.68,
        "mock": True,
        "note": "示例数据（mock 模式）。部署真实模型后返回实际识别结果；"
                "建议以银行卡等参照物入镜以提高精度。",
    }


def _map_caloriescan(raw):
    """将 CalorieScan 返回结构映射为本服务合约。
    按实际字段调整：常见返回含 weight / calories / confidence 等。"""
    if not isinstance(raw, dict):
        return mock_result()
    total_cal = raw.get("calories") or raw.get("total_calories") or raw.get("kcal")
    total_w = raw.get("weight") or raw.get("total_weight_g") or raw.get("weight_g")
    items = raw.get("items") or []
    name = raw.get("name") or (items[0].get("name") if items else "识别到的食物")
    conf = raw.get("confidence")
    return {
        "success": True,
        "name": name,
        "items": items,
        "total_weight_g": total_w,
        "total_calories": total_cal,
        "confidence": conf,
        "mock": False,
        "note": raw.get("note") or "由自托管 CalorieScan 模型识别。",
    }


def analyze(image_bytes: bytes, filename: str = "image.jpg"):
    if _ready and _analyzer_fn is not None:
        try:
            import io
            from PIL import Image
            import tempfile

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
        except Exception as e:  # noqa: BLE001
            print("[CalorieScan] 推理异常，回退 mock：", repr(e))
            r = mock_result()
            r["note"] = "真实模型推理失败，已返回示例数据：" + str(e)
            return r
    return mock_result()

# server/vision_llm.py
# 多模态大模型食物识别（OpenAI 兼容 chat.completions + image_url）
#
# 环境变量（云托管控制台 → 服务设置 → 环境变量 配置）：
#   LLM_API_KEY   必填。阿里云百炼 / 其它 OpenAI 兼容服务的 API Key；
#                 未配置则识别明确报 503（**无 mock 兜底**，见 analyzer.py 顶部说明）
#   LLM_BASE_URL  默认 https://dashscope.aliyuncs.com/compatible-mode/v1 （阿里云百炼 Qwen-VL）
#   LLM_MODEL     默认 qwen-vl-plus（可换 qwen-vl-max / qwen-vl-flash / MiMo 兼容模型）
#
# 返回结构与 analyzer.analyze 保持一致：
#   { name, items:[{name, weight_g, calories}], total_weight_g, total_calories, confidence, mock, provider }
import base64
import json
import os
import re

import requests

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-vl-plus"

PROMPT = (
    "你是食物营养分析助手。识别图片中的全部食物，只输出一个 JSON 对象，"
    "不要输出 markdown 代码块或其它文字。结构："
    '{"name":"菜名","items":[{"name":"食材名","weight_g":克数,"calories":该食材热量kcal}],'
    '"total_weight_g":总克数,"total_calories":总热量kcal,'
    '"protein":总蛋白质g,"carb":总碳水化合物g,"fat":总脂肪g,'
    '"confidence":0到1的置信度}。'
    "克数、热量与三大营养素为估算值，取整数；confidence 为 0-1 小数。"
)


def llm_ready() -> bool:
    return bool(os.environ.get("LLM_API_KEY"))


def _extract_json(text: str):
    """从模型回复中剥离 ```json 围栏 / 前后杂讯，解析出 JSON 对象。"""
    txt = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", txt, re.S)
    if fence:
        txt = fence.group(1)
    else:
        brace = re.search(r"\{.*\}", txt, re.S)
        if brace:
            txt = brace.group(0)
    return json.loads(txt)


def analyze_bytes(data: bytes, filename: str = "image.jpg") -> dict:
    key = os.environ.get("LLM_API_KEY")
    base = (os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    model = os.environ.get("LLM_MODEL") or DEFAULT_MODEL

    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "jpeg").lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpeg"
    b64 = base64.b64encode(data).decode("ascii")

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/%s;base64,%s" % (ext, b64)}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    }
    resp = requests.post(
        base + "/chat/completions",
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    d = _extract_json(content)

    items = []
    for it in (d.get("items") or []):
        try:
            items.append({
                "name": str(it.get("name") or "食物"),
                "weight_g": int(float(it.get("weight_g") or 0)),
                "calories": int(float(it.get("calories") or 0)),
            })
        except (TypeError, ValueError):
            continue

    def _num(v, default=0):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default

    conf = d.get("confidence")
    try:
        conf = float(conf)
    except (TypeError, ValueError):
        conf = 0.9
    if conf > 1:  # 兼容 0-100 写法
        conf = conf / 100.0

    return {
        "name": str(d.get("name") or "识别到的食物"),
        "items": items,
        "total_weight_g": _num(d.get("total_weight_g")),
        "total_calories": _num(d.get("total_calories")),
        "protein": _num(d.get("protein")),
        "carb": _num(d.get("carb")),
        "fat": _num(d.get("fat")),
        "confidence": round(conf, 2),
        "mock": False,
        "provider": "llm:" + model,
    }

"""
vision.py — 多模态大模型视觉识别封装
把一张食物图片变成结构化营养结果：
{
  "foods": [
    {"name": str, "portion": str, "calories": int,
     "protein": float, "carb": float, "fat": float, "confidence": float}
  ],
  "note": str,
  "mock": bool
}

支持两种 provider（环境变量切换）：
  - openai : OpenAI 兼容接口（OpenAI / Azure / DeepSeek / Moonshot / 通义等，
            只要把 OPENAI_BASE_URL 指过去即可），用 chat/completions + 图片
  - gemini : Google Gemini（gemini-1.5-flash / gemini-2.0-flash 等）

没有配置任何 key 时，自动回退到 mock 数据，保证整条链路在没接真模型时也能跑通。
"""
import base64
import json
import os
import re

import requests

# ---- 可调提示词（要求模型只输出 JSON） ----
SYSTEM_PROMPT = (
    "你是一个严谨的营养分析助手。用户会发来一张食物图片。"
    "请识别图中所有可辨认的食物，对每种食物估算份量（用中文描述，如'约150g'、'1碗'、'半块'），"
    "并估算热量（千卡）与三大宏量营养素（蛋白质/碳水/脂肪，单位克）。"
    "只输出一个 JSON 对象，不要任何额外文字或代码块标记，格式严格如下："
    '{"foods":[{"name":"食物名","portion":"份量描述","calories":数字,'
    '"protein":数字,"carb":数字,"fat":数字,"confidence":0到1的小数}],'
    '"note":"一句话说明，如识别不确定时的提醒或整体估算依据"}'
    "如果完全无法识别图片中的食物，返回："
    '{"foods":[],"note":"无法识别图片中的食物，请重新拍摄或选择更清晰的图片"}'
)


def _provider():
    return (os.environ.get("VISION_PROVIDER") or "openai").lower()


def _has_key():
    p = _provider()
    if p == "gemini":
        return bool(os.environ.get("GEMINI_API_KEY"))
    # openai 兼容
    return bool(os.environ.get("OPENAI_API_KEY"))


def _extract_json(text):
    """从模型返回中尽量稳健地抠出 JSON 对象。"""
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _normalize(raw):
    """把模型输出规范成统一结构，并补默认值。"""
    foods = []
    for f in (raw.get("foods") or []) if isinstance(raw, dict) else []:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        if not name:
            continue
        foods.append({
            "name": name,
            "portion": str(f.get("portion") or "").strip(),
            "calories": int(round(float(f.get("calories") or 0))),
            "protein": round(float(f.get("protein") or 0), 1),
            "carb": round(float(f.get("carb") or 0), 1),
            "fat": round(float(f.get("fat") or 0), 1),
            "confidence": round(min(max(float(f.get("confidence") or 0.6), 0.0), 1.0), 2),
        })
    return {
        "foods": foods,
        "note": str(raw.get("note") or "") if isinstance(raw, dict) else "",
        "mock": False,
    }


# ---------- OpenAI 兼容 ----------
def _call_openai(image_bytes, mime):
    base_url = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("VISION_MODEL") or "gpt-4o-mini"
    api_key = os.environ.get("OPENAI_API_KEY")
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": "请分析这张食物图片。"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]},
        ],
        "max_tokens": 1200,
        "temperature": 0.2,
    }
    resp = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return _normalize(_extract_json(content) or {})


# ---------- Google Gemini ----------
def _call_gemini(image_bytes, mime):
    model = os.environ.get("GEMINI_MODEL") or "gemini-1.5-flash"
    api_key = os.environ.get("GEMINI_API_KEY")
    b64 = base64.b64encode(image_bytes).decode("ascii")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "contents": [{
            "parts": [
                {"text": SYSTEM_PROMPT + "\n请分析这张食物图片。"},
                {"inline_data": {"mime_type": mime, "data": b64}},
            ]
        }],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1200},
    }
    resp = requests.post(url, headers={"Content-Type": "application/json"}, json=body, timeout=60)
    resp.raise_for_status()
    parts = resp.json()["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts)
    return _normalize(_extract_json(text) or {})


# ---------- Mock 兜底 ----------
def _mock_result():
    return {
        "foods": [
            {"name": "鸡胸肉（约120g）", "portion": "约120g", "calories": 198,
             "protein": 37.0, "carb": 0.0, "fat": 4.3, "confidence": 0.7},
            {"name": "糙米饭（约150g）", "portion": "约150g", "calories": 165,
             "protein": 3.5, "carb": 35.0, "fat": 1.2, "confidence": 0.7},
            {"name": "西兰花（约80g）", "portion": "约80g", "calories": 27,
             "protein": 2.3, "carb": 5.4, "fat": 0.3, "confidence": 0.6},
        ],
        "note": "演示数据（未配置视觉模型 key），仅用于跑通链路。接入真实模型后此处为模型估算结果。",
        "mock": True,
    }


def analyze(image_bytes, filename="image.jpg"):
    mime = "image/jpeg"
    if filename:
        ext = filename.lower().split(".")[-1]
        if ext in ("png", "webp", "bmp", "gif"):
            mime = f"image/{ext}" if ext != "jpg" else "image/jpeg"
    if not _has_key():
        return _mock_result()
    try:
        if _provider() == "gemini":
            return _call_gemini(image_bytes, mime)
        return _call_openai(image_bytes, mime)
    except Exception as e:  # 真模型调用失败时，回退 mock，避免小程序端整链路断掉
        res = _mock_result()
        res["note"] = f"视觉模型调用失败（{type(e).__name__}: {e}），已回退演示数据。"
        res["error"] = str(e)
        return res

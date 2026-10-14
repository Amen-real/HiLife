# server/vision_llm.py
# 多模态大模型食物识别（OpenAI 兼容 chat.completions + image_url）
#
# 环境变量（云托管控制台 → 服务设置 → 环境变量 配置）：
#   LLM_API_KEY   必填。智谱开放平台 / 阿里云百炼等 OpenAI 兼容服务的 API Key；
#                 未配置则识别明确报 503（**无 mock 兜底**，见 analyzer.py 顶部说明）
#   LLM_BASE_URL  默认智谱 https://open.bigmodel.cn/api/paas/v4
#                 备选：阿里云百炼 https://dashscope.aliyuncs.com/compatible-mode/v1
#   LLM_MODEL     默认 glm-4.6v-flash（智谱，永久免费，视觉推理强于 4v-flash）
#
# ⚠️ 供应商选择史（2026-10-14）——百炼的 VL 模型下线太频繁，别把鸡蛋放一个篮子：
#   · qwen-vl-plus / qwen-vl-max   2026-07-13 下线（公告 #118344 前身波次）
#   · qwen3-vl-flash               2026-10-10 下线（官方替代 qwen3.6-flash，1.2/7.2 元，
#                                  ⚠️ 混合思考模型 thinking 默认开，接它必须在 payload
#                                  加 "enable_thinking": false，否则可能撞 50s 超时）
#   · 智谱 glm-4v-flash 永久免费但感知/推理较弱 → 用户实测「营养估不准」后，
#     2026-10-14 升级为 **glm-4.6v-flash**（同平台同免费档，视觉推理更强）。
#     免费档并发 1-2，高峰偶发 429（客户端按 VISION_QUOTA 提示重试即可）。
#     想再省延迟可退回 glm-4v-flash：改 LLM_MODEL 即可，不用重新发版。
#
# 返回结构与 analyzer.analyze 保持一致：
#   { name, items:[{name, weight_g, calories}], total_weight_g, total_calories, confidence, mock, provider }
import base64
import json
import os
import re

import requests

DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
DEFAULT_MODEL = "glm-4.6v-flash"

# 单次上游请求超时（秒）。**必须小于客户端的轮询总窗口**，否则服务端还在算、
# 客户端已经弹「识别超时」了 —— 用户拿到的是超时，而不是「到底为什么慢」。
# 客户端窗口见 utils/foodvision.js 的 POLL_DEADLINE_MS（70s）。
REQ_TIMEOUT = 50

PROMPT = (
    "你是食物营养分析助手。先在心里按以下步骤推演，最终只输出一个 JSON 对象，"
    "不要输出 markdown 代码块或任何解释文字："
    "①识别菜名与主要食材（调料忽略）；"
    "②借助图中参照物（碗、盘、筷子、手机）和常见餐具容量估算每种食材的克数；"
    "③按中国食物成分表中该食材的常见每100克营养值，估算蛋白质、碳水、脂肪克数；"
    "④热量用 4+4+9 千卡系数由营养素算出（热量必须与营养素一致，不许另拍一个数）；"
    "⑤用常识校验总量（如一碗米饭约200g/230kcal、一份番茄炒蛋约350-500kcal），明显离谱就修正。"
    "输出结构："
    '{"name":"菜名","items":[{"name":"食材名","weight_g":克数,"calories":该食材热量kcal}],'
    '"total_weight_g":总克数,"total_calories":总热量kcal,'
    '"protein":总蛋白质g,"carb":总碳水化合物g,"fat":总脂肪g,'
    '"confidence":置信度}。'
    # 限量是**为了速度**：输出 token 数直接决定生成耗时，放任模型列十几个调料会让
    # 一次识别多等十几秒（用户感知就是「识别很慢」）。4 项足够覆盖一餐的主要热量来源。
    "items 最多列 4 项（只列主要食材，调料可忽略）。"
    "克数、热量与三大营养素为估算值，取整数；confidence 为 0-1 小数："
    "参照物充足且是常见菜给 0.7-0.95，混合菜/酱料多/看不清分量给 0.3-0.6。"
)

def _reconcile_nutrition(d):
    """营养素 × Atwater 系数（4/4/9）对 total_calories 做交叉校验（纯函数，可单测）。

    模型常见毛病：宏量营养素和总热量各说各话——营养素像「成分表检索」的结果，
    热量却是拍脑袋的整数。两层校验，优先级：宏量推算 > 逐项加和 > 模型原值：
      ① protein/carb/fat 齐全时：atwater = p×4 + c×4 + f×9；
      ② 否则退回 Σ(逐项 calories)；
      ③ 与 total_calories 偏差 >30%（或原值 ≤0）→ 以校验值为准，并把 confidence
        打 8 折（下限 0.3）——告诉下游「这个数是修出来的，没那么有把握」。
    只在拿到更可信的数时才改写，不引入新的不准。"""
    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    atwater = _f(d.get("protein")) * 4 + _f(d.get("carb")) * 4 + _f(d.get("fat")) * 9
    items_sum = sum(_f(it.get("calories")) for it in (d.get("items") or []))
    ref = atwater if atwater > 40 else (items_sum if items_sum > 40 else 0)
    total = _f(d.get("total_calories"))
    if ref > 0 and (total <= 0 or abs(total - ref) / ref > 0.30):
        d["total_calories"] = int(round(ref))
        try:
            d["confidence"] = round(max(0.3, float(d.get("confidence")) * 0.8), 2)
        except (TypeError, ValueError):
            d["confidence"] = 0.5
    return d


class LLMError(RuntimeError):
    """上游多模态大模型调用失败。

    message 是**给运维排查**的（含状态码/上游原文），code 才是跨端给用户翻译用的键 ——
    与 analyzer.EngineNotReady 同一约定：app.py 会把 e.code 原样带进 task error，
    客户端 utils/foodvision.js 的 userMessage() 再翻成人话。

    分类的意义＝**区分「你的照片不行」与「我们这边出问题」**。
    旧实现把所有上游异常一股脑记成 VISION_FAILED，用户看到的是
    「没能认出这道菜，换一张更清晰的照片再试试」—— 明明是密钥失效 / 额度用尽 /
    模型没开通，他重拍一百次也没用，只会觉得「这东西经常识别不出来」。
    """

    code = "VISION_FAILED"

    def __init__(self, message, code=None):
        super().__init__(message)
        if code:
            self.code = code


def _code_for_http(status_code):
    """上游 HTTP 状态码 → 跨端 code。

    ⚠️ 这里每加一个 code，**必须**同步 utils/foodvision.js 的 USER_TEXT ——
    守卫 scripts/verify-vision-result.cjs [D] 会反查「服务端说过的每个 code 都有用户文案」。
    """
    if status_code in (401, 403):
        return "VISION_AUTH"       # 密钥无效 / 无权限
    if status_code == 429:
        return "VISION_QUOTA"      # 限流 / 额度用尽
    if status_code == 400:
        return "VISION_MODEL"      # 模型名写错 / 该模型未开通（百炼对这两种都回 400）
    if status_code >= 500:
        return "VISION_UPSTREAM"   # 供应商侧故障
    return "VISION_FAILED"


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

    # glm-4.6v 系列是混合思考模型：思考模式更准但显著更慢（食物识别不需要深思，
    # PROMPT 已内置估算方法论）。默认关思考保住 50s 预算；要更高精度可改成
    # {"type": "enabled"}，改完先真机看耗时是否撞 REQ_TIMEOUT。
    # ⚠️ 只对 glm-4.6 系列注入：切回百炼/其它供应商时带上这个未知字段会被 400。
    if model.startswith("glm-4.6"):
        payload["thinking"] = {"type": "disabled"}

    # 网络层：超时与连不上要分开报 —— 超时是「再试可能就好」，连不上是「上游/出网有问题」
    try:
        resp = requests.post(
            base + "/chat/completions",
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            json=payload,
            timeout=REQ_TIMEOUT,
        )
    except requests.exceptions.Timeout:
        raise LLMError("上游模型响应超时（> %ds）。" % REQ_TIMEOUT, code="VISION_TIMEOUT")
    except requests.exceptions.RequestException as e:
        raise LLMError("连接上游模型服务失败：%r" % (e,), code="VISION_UPSTREAM")

    # 不 raise_for_status()：**要把状态码分门别类**，而不是笼统一个 4xx。
    # 上游原文只进日志/运维 message，绝不弹给用户（见 LLMError 的约定）。
    if resp.status_code >= 400:
        raise LLMError(
            "上游模型返回 %d：%s" % (resp.status_code, (resp.text or "")[:200]),
            code=_code_for_http(resp.status_code),
        )

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001
        raise LLMError("上游返回结构无法解析：%r" % (e,), code="VISION_FAILED")

    try:
        d = _extract_json(content)
    except Exception as e:  # noqa: BLE001
        # 模型答了，但不是 JSON —— 换张照片确实可能有用，归 VISION_FAILED（引导重拍）是对的
        raise LLMError("模型没有返回可解析的 JSON：%r" % (e,), code="VISION_FAILED")

    if not isinstance(d, dict):
        raise LLMError("模型返回的不是 JSON 对象。", code="VISION_FAILED")

    # 模型给了数 ≠ 数可信：热量与营养素交叉校验（见 _reconcile_nutrition）
    d = _reconcile_nutrition(d)

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

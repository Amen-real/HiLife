# server/vision_llm.py
# 多模态大模型食物识别（OpenAI 兼容 chat.completions + image_url）
#
# 环境变量（云托管控制台 → 服务设置 → 环境变量 配置）：
#   LLM_API_KEY   必填。智谱开放平台 / 阿里云百炼等 OpenAI 兼容服务的 API Key；
#                 未配置则识别明确报 503（**无 mock 兜底**，见 analyzer.py 顶部说明）
#   LLM_BASE_URL  默认智谱 https://open.bigmodel.cn/api/paas/v4
#                 备选：阿里云百炼 https://dashscope.aliyuncs.com/compatible-mode/v1
#   LLM_MODEL     默认 glm-5.3-flash（智谱，多模态，始终思考型）
#   LLM_FALLBACK_MODEL  默认 glm-5.3-flashx。主模型 429 重试耗尽后
#                 自动用它完成本次识别；设为空字符串可禁用故障转移。
#
# ⚠️ 供应商/模型选择史——百炼的 VL 模型下线太频繁，别把鸡蛋放一个篮子：
#   · qwen-vl-plus / qwen-vl-max   2026-07-13 下线（公告 #118344 前身波次）
#   · qwen3-vl-flash               2026-10-10 下线（官方替代 qwen3.6-flash，1.2/7.2 元，
#                                  ⚠️ 混合思考模型 thinking 默认开，接它必须在 payload
#                                  加 "enable_thinking": false，否则可能撞 50s 超时）
#   · 智谱 glm-4v-flash → glm-4.6v-flash（2026-10-14）：免费档并发 1-2，
#     高峰 429 是**持续性**的（限流窗口常超重试总时长 6s），同模型退避救不回来。
#   · 2026-10-15：用户在 glm-5.3-flash 有 15M 推理 tokens（付费池、限流宽松），
#     **弃用 glm-4.6 系列**，主模型切 glm-5.3-flash、备用 glm-5.3-flashx（3M tokens）。
#     glm-5.3 系列始终思考：payload 注入 thinking:{type:enabled} + reasoning_effort:"low"
#     （见 _payload_for；disabled 会被 400 拒绝，错误码 1210）。
#     想省 token 可退回 glm-4.6v-flash（免费）：改 LLM_MODEL 即可，不用重新发版。
#
# 返回结构与 analyzer.analyze 保持一致：
#   { name, items:[{name, weight_g, calories, protein?, carb?, fat?}], total_weight_g, total_calories, confidence, mock, provider }
#   items 分项宏量（protein/carb/fat，1 位小数）：成分表命中 ⇒ 真表精确重算；
#   未命中 ⇒ 模型输出（prompt 要求），模型也没给就不带键（前端该行显示 —）。
import base64
import json
import os
import re
import time

import requests

import food_db

DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
DEFAULT_MODEL = "glm-5.3-flash"
# 故障转移模型：主模型 429 重试耗尽时兜底（同为付费 tokens 池，限流宽松）。
# 置空（LLM_FALLBACK_MODEL=""）可禁用。换供应商时记得同步改，别跨平台混用同一把 key。
DEFAULT_FALLBACK_MODEL = "glm-5.3-flashx"

# 上游 429 限流（免费档高峰常态，智谱错误码 1305）自动重试：次数与退避秒数。
# 退避 2s/4s；429 是快速失败不占生成时间，最坏 2+4=6s 附加，远小于 REQ_TIMEOUT 余量。
# ⚠️ 真机实测：高峰限流窗口常**超过** 6s，同模型重试救不回来 ⇒ 真正的解法是
# 模型级故障转移（DEFAULT_FALLBACK_MODEL，见 analyze_bytes），重试只是第一道缓冲。
RETRY_ON_429 = 2
RETRY_BACKOFF_SEC = 2

# 单次上游请求超时（秒）。**必须小于客户端的轮询总窗口**，否则服务端还在算、
# 客户端已经弹「识别超时」了 —— 用户拿到的是超时，而不是「到底为什么慢」。
# 客户端窗口见 utils/foodvision.js 的 POLL_DEADLINE_MS（70s）。
REQ_TIMEOUT = 50

PROMPT = (
    "你是食物营养分析助手。先在心里按以下步骤推演（推演务必简短，每步一两行即可，"
    "不要长篇展开——思考越短回复越快），最终只输出一个 JSON 对象，"
    "不要输出 markdown 代码块或任何解释文字："
    "①识别菜名与主要食材（调料忽略）；"
    "②借助图中参照物（碗、盘、筷子、手机）和常见餐具容量估算每种食材的克数；"
    "③按中国食物成分表中该食材的常见每100克营养值，估算蛋白质、碳水、脂肪克数；"
    "④热量用 4+4+9 千卡系数由营养素算出（热量必须与营养素一致，不许另拍一个数）；"
    "⑤用常识校验总量（如一碗米饭约200g/230kcal、一份番茄炒蛋约350-500kcal），明显离谱就修正。"
    "输出结构："
    '{"name":"菜名","items":[{"name":"食材名","weight_g":克数,"calories":该食材热量kcal,'
    '"protein":该食材蛋白质g,"carb":该食材碳水g,"fat":该食材脂肪g}],'
    '"total_weight_g":总克数,"total_calories":总热量kcal,'
    '"protein":总蛋白质g,"carb":总碳水化合物g,"fat":总脂肪g,'
    '"confidence":置信度}。'
    # 限量是**为了速度**：输出 token 数直接决定生成耗时，放任模型列十几个调料会让
    # 一次识别多等十几秒（用户感知就是「识别很慢」）。4 项足够覆盖一餐的主要热量来源。
    "items 最多列 4 项（只列主要食材，调料可忽略）；"
    "即使图中只有一种食物，items 也要列出该食材本身（如一碗米饭 → items 一项「米饭」），不许留空。"
    # 分项宏量：用户核心感知就是「明细卡里有每个食材的蛋白质/碳水/脂肪」（约 +60~100
    # 输出 token / +2~3s，在 50s 预算内）；成分表命中的项会被服务端真表数值覆盖，更准。
    "items 每项都要给出蛋白质/碳水/脂肪克数。"
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


def provider_info():
    """/health 观测用：如实上报当前**生效**的供应商与模型，及是否被环境变量覆盖。

    「改了代码默认值但线上没变化」九成是环境里残留了旧的 LLM_MODEL/LLM_BASE_URL
    （环境变量 > 代码默认值）。把这两件事都亮出来，排查就不用靠猜。"""
    fallback = (os.environ.get("LLM_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL) or "").strip()
    return {
        "model": os.environ.get("LLM_MODEL") or DEFAULT_MODEL,
        "fallback": fallback or None,
        "base": (os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        "overridden": {
            "model": bool(os.environ.get("LLM_MODEL")),
            "base_url": bool(os.environ.get("LLM_BASE_URL")),
        },
    }


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


def _payload_for(model: str, b64: str, ext: str) -> dict:
    """按模型组装 chat.completions payload（故障转移要逐模型重建，model 在 payload 里）。"""
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
    # 思考参数按模型家族分治（2026-10-14 真机实测 glm-5.3-flashx 400 错误码 1210 的教训）：
    # · glm-4.6 系列：混合思考，可关 —— disabled 保住 50s 预算（食物识别不需要深思，
    #   PROMPT 已内置估算方法论）。
    # · glm-5.3 系列：**始终思考，disabled 会被 400 拒绝**（错误码 1210「该模型始终思考，
    #   不支持关闭思考」）。官方迁移口径 = enabled + reasoning_effort 低档，这里选
    #   "low"（轻量推理）：识别是单轮图片→JSON，max 档只会烧 token 和时间。
    # ⚠️ 其它模型（glm-4v-flash、百炼等）一律不注入：老模型/他厂带未知字段会被 400。
    if model.startswith("glm-5"):
        payload["thinking"] = {"type": "enabled"}
        payload["reasoning_effort"] = "low"
    elif model.startswith("glm-4.6"):
        payload["thinking"] = {"type": "disabled"}
    return payload


def _post_with_429_retry(url: str, key: str, payload: dict):
    """单模型请求 + 429 退避重试（429 是快速失败不占生成时间）。

    网络层：超时与连不上要分开报 —— 超时是「再试可能就好」，连不上是「上游/出网有问题」。
    仅重试 429（免费档高峰限流，智谱错误码 1305「访问量过大」）：其它状态码重试没有意义。
    注意：**超时不在重试范围**——一次 50s 超时已吃掉客户端 70s 窗口的大半，再重试
    只会让用户等到超时弹窗，拿不到任何结果。
    """
    resp = None
    for attempt in range(RETRY_ON_429 + 1):
        try:
            resp = requests.post(
                url,
                headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
                json=payload,
                timeout=REQ_TIMEOUT,
            )
        except requests.exceptions.Timeout:
            raise LLMError("上游模型响应超时（> %ds）。" % REQ_TIMEOUT, code="VISION_TIMEOUT")
        except requests.exceptions.RequestException as e:
            raise LLMError("连接上游模型服务失败：%r" % (e,), code="VISION_UPSTREAM")
        if resp.status_code != 429 or attempt >= RETRY_ON_429:
            return resp
        wait = RETRY_BACKOFF_SEC * (attempt + 1)
        print("[vision_llm] 模型 %s 上游 429 限流，%.0fs 后第 %d/%d 次重试：%s"
              % (payload.get("model"), wait, attempt + 1, RETRY_ON_429, (resp.text or "")[:200]))
        time.sleep(wait)
    return resp


def analyze_bytes(data: bytes, filename: str = "image.jpg") -> dict:
    key = os.environ.get("LLM_API_KEY")
    base = (os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    primary = os.environ.get("LLM_MODEL") or DEFAULT_MODEL
    fallback = (os.environ.get("LLM_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL) or "").strip()

    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "jpeg").lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpeg"
    b64 = base64.b64encode(data).decode("ascii")

    # 模型链：主模型 → 备用模型（仅当主模型重试耗尽仍 429）。
    # 只对 429 故障转移：401/403 换模型也救不了（同一把 key）、400 是模型配置问题、
    # 超时已吃掉大半时间预算——这三种继续换模型只会白等。
    chain = [primary]
    if fallback and fallback != primary:
        chain.append(fallback)

    url = base + "/chat/completions"
    resp = None
    model = primary
    for idx, model in enumerate(chain):
        resp = _post_with_429_retry(url, key, _payload_for(model, b64, ext))
        if resp.status_code == 429 and idx < len(chain) - 1:
            print("[vision_llm] 主模型 %s 重试 %d 次后仍 429，改用备用模型 %s"
                  % (primary, RETRY_ON_429, chain[idx + 1]))
            continue
        break

    # 不 raise_for_status()：**要把状态码分门别类**，而不是笼统一个 4xx。
    # ⚠️ 上游原文**只进服务端日志**，绝不放进 LLMError message —— 那条 message 会经
    #   app.py 存进 TASKS 并随 /task/{id} 回到客户端（可被抓包），原文里可能带
    #   供应商账户/配额/endpoint 信息。运维细节在 print 里，够排查了。
    if resp.status_code >= 400:
        print("[vision_llm] 上游 %d 原文：%s" % (resp.status_code, (resp.text or "")[:500]))
        raise LLMError(
            "上游模型返回 %d（详情见服务端日志）。" % resp.status_code,
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

    # 成分表校准（必须在 _reconcile_nutrition 之前：让 Σitems 交叉校验用上真表数值）。
    # 只改「查营养」这一环——克数估计是模型的活，匹配不上保留原值，宁缺毋错。
    # 命中时热量与分项宏量（p/c/f）一并按克数精确重算——明细卡的分项宏量
    # 必须与分项热量同源，否则会出现「热量来自真表、宏量来自模型」的自相矛盾。
    _matched = 0
    for it in (d.get("items") or []):
        try:
            w = int(float(it.get("weight_g") or 0))
        except (TypeError, ValueError):
            continue
        entry = food_db.match_food(it.get("name"))
        if entry and w > 0:
            it["calories"] = int(round(entry["kcal"] * w / 100.0))
            it["protein"] = round(entry["p"] * w / 100.0, 1)
            it["carb"] = round(entry["c"] * w / 100.0, 1)
            it["fat"] = round(entry["f"] * w / 100.0, 1)
            _matched += 1
    if _matched:
        print("[vision_llm] 成分表校准：%d/%d 项命中" % (_matched, len(d.get("items") or [])))

    # 模型给了数 ≠ 数可信：热量与营养素交叉校验（见 _reconcile_nutrition）
    d = _reconcile_nutrition(d)

    def _f1(v):
        """分项宏量归一：可解析 → 1 位小数；缺失/不可解析 → None（输出时不带键）。"""
        try:
            return round(float(v), 1)
        except (TypeError, ValueError):
            return None

    items = []
    for it in (d.get("items") or []):
        try:
            one = {
                "name": str(it.get("name") or "食物"),
                "weight_g": int(float(it.get("weight_g") or 0)),
                "calories": int(float(it.get("calories") or 0)),
            }
        except (TypeError, ValueError):
            continue
        # 分项宏量：三项齐全才输出（半缺不可信）。分项热量与分项宏量必须自洽——
        # 模型给了宏量却没给（或给了 0）calories 时，用 Atwater 4/4/9 兜出，
        # 避免明细卡出现「宏量齐全但热量为 0」的自相矛盾行。
        p, c, f = _f1(it.get("protein")), _f1(it.get("carb")), _f1(it.get("fat"))
        if p is not None and c is not None and f is not None:
            one["protein"], one["carb"], one["fat"] = p, c, f
            if one["calories"] <= 0:
                one["calories"] = int(round(p * 4 + c * 4 + f * 9))
        items.append(one)

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

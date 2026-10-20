# server/fixture.py
# 固定夹具识别器：**只在显式开关下生效**的假引擎。
#
# 存在的理由（借鉴 openGym 的 fixture provider 形态，见 deliverables/openGym竞品分析与优化参考.md）：
#   没有它，「拍照 → 识别 → 纠错 → 入库 → 复盘」这条整条回路**只能在配了大模型
#   （花钱、慢）或本机有 CalorieScan 权重的前提下**才跑得通。CI、离线演示、
#   新人第一次跑项目，全都卡在这道门槛外。
#
# ⚠️⚠️ 三条铁律，任何改动都必须同时满足（守卫见 verify-vision-fixture.cjs）：
#   1) **绝不在兜底分支里**。真实引擎不可用时必须照旧抛 EngineNotReady（503 / task.error）。
#      fixture 抢兜底位 = 把「服务坏了」变成「返回假热量」= 用户把假数据当自己那餐记下来。
#      那不是降级，是事故（这正是 2026-09-28 移除 mock 的原因，见 analyzer.py 顶部）。
#   2) **只在 VISION_MODE=fixture 时生效**，且开关名不与任何真实配置名重叠（避免误配）。
#      默认必须是「不生效」—— 环境变量缺失/拼错时表现应当是「照旧走真实链路并可能报错」，
#      而不是「悄悄切到假数据」。
#   3) **返回值必须自带可辨识标记**（`fixture: True` + note 明说），
#      且 **mock 字段恒为 False**。理由见下。
#
# ⚠️ 关于 mock 字段为什么是 False（这是最容易做错的一处）：
#   客户端 utils/foodvision.js 的统一出口有一条「最后一道防线」——
#   凡是带 mock:true 的结果一律**拒绝**并归为「引擎不可用」
#   （守卫 verify-vision-result B4/B4b）。
#   那条防线是为「示例数据冒充真实识别」设的，**它是对的，不该为了让 fixture 跑通而放宽**。
#   所以 fixture 绝不能自称 mock：那会让它被这道防线拦下，fixture 也就白做了。
#   但「不自称 mock」不等于「可以骗用户」——
#   所以这里另开一个**独立字段** `fixture: True`，并在 note 里写明来源，
#   由「是否把 fixture 结果当真」这件事**显式落在调用方/测试脚本**，
#   而不是靠一个会被客户端拦下的字段来暗示。
import os

import analyzer   # 只为复用 EngineNotReady 与合约字段名，不产生真实依赖


# VISION_MODE 的合法取值。默认空串 = 不启用任何 fixture。
MODE_ENV = "VISION_MODE"
MODE_FIXTURE = "fixture"


def fixture_enabled() -> bool:
    """是否启用夹具。**必须**是精确等值比较：拼错成 'Fixture'/'fixture ' 一律视为未启用。"""
    return (os.environ.get(MODE_ENV) or "").strip() == MODE_FIXTURE


# 固定夹具内容（单一菜品，字段与 analyzer 合约逐字对齐）。
# 刻意选一个「热量与重量不成正比」的值：若有人拿它当回归基准，
# 「先减重量再看热量」这种直觉错误会立刻暴露。
# 分项宏量与分项热量 Atwater 自洽：10×4 + 30×4 + 11.1×9 = 259.9 ≈ 260。
_FIXTURE_NAME = "示例餐"
_FIXTURE_ITEMS = [
    {"name": "示例餐", "weight_g": 200, "calories": 260,
     "protein": 10.0, "carb": 30.0, "fat": 11.1},
]
_FIXTURE_TOTAL_WEIGHT_G = 200
_FIXTURE_TOTAL_CALORIES = 260
# confidence 刻意给一个不高不低的中间值：既不假装很确定，也不显得没用。
_FIXTURE_CONFIDENCE = 0.6


def fixture_result() -> dict:
    """返回与 analyzer 合约完全同构的结果（字段名/类型逐一对应）。

    ⚠️ mock 恒为 False —— 理由见文件顶部铁律 3。
    ⚠️ fixture=True 是独立字段：客户端不认它（客户端只拦 mock:true），
       因此「能不能把这份结果当真」由调用方决定，不由服务端悄悄决定。
    """
    return {
        "success": True,
        "name": _FIXTURE_NAME,
        "items": [dict(i) for i in _FIXTURE_ITEMS],
        "total_weight_g": _FIXTURE_TOTAL_WEIGHT_G,
        "total_calories": _FIXTURE_TOTAL_CALORIES,
        "confidence": _FIXTURE_CONFIDENCE,
        # 与 analyzer 合约一致：本模块不是 mock 路径
        "mock": False,
        # 独立可辨识标记（见文件顶部铁律 3）
        "fixture": True,
        # note 明说来源，避免「以为自己在测真实链路」
        "note": "fixture：固定示例数据，非识别结果（VISION_MODE=fixture）",
    }


def analyze(data: bytes, filename: str = "image.jpg") -> dict:
    """与 analyzer.analyze 同签名，便于在 app.py 里对调。"""
    # 故意不校验 data：夹具的意义就是「有张图就能跑通回路」，
    # 而 CI 里往往只有一张1x1 的占位 png。若这里加严格校验，
    # 就把「省掉真模型」又变成了「省不掉真实输入」，与本模块目的相反。
    return fixture_result()


def is_ready() -> bool:
    """夹具永远「就绪」（它不需要模型）。仅在开关打开时有意义。"""
    return fixture_enabled()


def not_ready_reason() -> str:
    """夹具不存在「未就绪」；保留此函数只为让 app.py 的调用面与 analyzer 一致。"""
    return ""


def describe() -> dict:
    """/health 里暴露当前模式，便于运维一眼确认「这台实例跑的是不是夹具」。"""
    mode = (os.environ.get(MODE_ENV) or "").strip()
    return {
        "mode": mode or "default",
        "fixture": mode == MODE_FIXTURE,
        "warning": "当前为固定夹具，返回的不是真实识别结果" if mode == MODE_FIXTURE else "",
    }
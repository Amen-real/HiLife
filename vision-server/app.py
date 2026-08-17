"""
app.py — 食物视觉识别桥接服务（FastAPI）
供微信小程序调用：
  - 开发期：小程序 wx.uploadFile 上传 multipart 图片到 POST /analyze
  - 上线（微信云托管）：小程序 wx.cloud.callContainer 以 JSON(base64 图片) 调 POST /analyze
  GET /health  健康检查（含当前是否使用 mock）

运行：
  uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
  微信云托管会注入 PORT 环境变量，本地不设则默认 8000
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

import vision

app = FastAPI(title="HiLife Food Vision API")

# 开发期放开跨域；云托管由平台处理，* 不影响
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "provider": vision._provider(),
        "model_loaded": vision._has_key(),
        "mock": not vision._has_key(),
    }


@app.post("/analyze")
async def analyze(request: Request):
    ctype = request.headers.get("content-type", "")
    data = None

    if "application/json" in ctype:
        # 云托管 callContainer 模式：图片以 base64 传入（受 100K 限制，需前端压缩）
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(status_code=400, content={"error": "invalid json body"})
        b64 = body.get("image") or body.get("image_base64") or ""
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        if b64:
            try:
                import base64
                data = base64.b64decode(b64)
            except Exception:
                return JSONResponse(status_code=400, content={"error": "invalid base64 image"})
    else:
        # 开发期 uploadFile 模式：multipart/form-data 的 image 字段
        form = await request.form()
        upload = form.get("image")
        if upload is not None:
            data = await upload.read()

    if not data:
        return JSONResponse(
            status_code=400,
            content={"error": "missing image (need multipart 'image' or json 'image' base64)"},
        )

    result = vision.analyze(data, "image.jpg")

    # 把多个食物的热量/宏量加总，方便小程序直接展示
    total = {"calories": 0, "protein": 0.0, "carb": 0.0, "fat": 0.0}
    for f in result.get("foods", []):
        total["calories"] += int(f.get("calories") or 0)
        total["protein"] += float(f.get("protein") or 0)
        total["carb"] += float(f.get("carb") or 0)
        total["fat"] += float(f.get("fat") or 0)
    result["total"] = {
        "calories": total["calories"],
        "protein": round(total["protein"], 1),
        "carb": round(total["carb"], 1),
        "fat": round(total["fat"], 1),
    }
    result["provider"] = vision._provider()
    return result


if __name__ == "__main__":
    import uvicorn, os
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

# server/app.py
# HiLife 自托管 CalorieScan 桥接服务（FastAPI）
# 供微信小程序 wx.uploadFile 调用：POST /analyze 上传菜品图片 -> 返回热量/重量 JSON
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import analyzer

app = FastAPI(title="HiLife CalorieScan Bridge", version="1.0.0")

# 允许跨域：本地开发/小程序调用需开启；生产可收紧为具体域名
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
        "model_loaded": analyzer.is_ready(),
        "mock": analyzer.is_mock(),
    }


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    data = await image.read()
    return analyzer.analyze(data, image.filename or "image.jpg")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

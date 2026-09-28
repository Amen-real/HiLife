# server/Dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
# 基础依赖（fastapi / uvicorn / requests / pillow）足够跑 LLM 路径 —— 只要配 LLM_API_KEY；
# 如需自托管 CalorieScan 真实推理，再额外安装 torch / ultralytics / segment-anything 等。
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 真实模式：把克隆的 CalorieScan 仓库挂到 /caloriescan 并设置以下环境变量
# ENV CALORIESCAN_REAL=1
# ENV CALORIESCAN_REPO=/caloriescan
# ENV MODELS_DIR=/caloriescan/model_training/outputs

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

# server/Dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
# 仅装基础依赖即可启动 mock 模式；如需真实推理，改为安装完整依赖
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 真实模式：把克隆的 CalorieScan 仓库挂到 /caloriescan 并设置以下环境变量
# ENV CALORIESCAN_REAL=1
# ENV CALORIESCAN_REPO=/caloriescan
# ENV MODELS_DIR=/caloriescan/model_training/outputs

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

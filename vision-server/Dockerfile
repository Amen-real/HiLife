FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 生产环境用环境变量注入 key（微信云托管控制台配置）：
#   VISION_PROVIDER=openai
#   OPENAI_API_KEY=sk-xxx
#   OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
#   VISION_MODEL=qwen-vl-max
ENV VISION_PROVIDER=openai

# 微信云托管会注入 PORT 环境变量；本地不设则默认 80
EXPOSE 80
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-80}"]

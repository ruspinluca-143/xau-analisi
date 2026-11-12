FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV PYTHONUNBUFFERED=1
ENV XAU_ONLINE=1
CMD ["python", "-I", "server.py"]

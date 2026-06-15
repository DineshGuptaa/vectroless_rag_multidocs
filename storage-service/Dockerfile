FROM python:3.11-slim

WORKDIR /app

COPY storage-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY storage-service/ .
COPY shared/ ./shared/

EXPOSE 8005

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8005", "--reload"]

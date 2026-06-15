FROM python:3.11-slim

WORKDIR /app

COPY cache-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cache-service/ .
COPY shared/ ./shared/

EXPOSE 8006

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8006", "--reload"]

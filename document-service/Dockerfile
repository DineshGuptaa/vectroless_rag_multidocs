FROM python:3.11-slim

WORKDIR /app

COPY document-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY document-service/ .
COPY shared/ ./shared/

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]

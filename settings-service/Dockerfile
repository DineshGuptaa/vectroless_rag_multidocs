FROM python:3.11-slim

WORKDIR /app

COPY settings-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY settings-service/ .
COPY shared/ ./shared/

EXPOSE 8007

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8007", "--reload"]

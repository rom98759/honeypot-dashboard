FROM node:24-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY --from=frontend-build /frontend/dist/ static/

RUN useradd --no-create-home --uid 1000 --shell /usr/sbin/nologin dashboard \
    && install -d -o dashboard -g dashboard /data

ENV DASHBOARD_DB_PATH=/data/dashboard.sqlite3
EXPOSE 8000

USER dashboard
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

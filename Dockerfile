# ── Stage 1: build the React/TS frontend into static files ───────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build          # produces frontend/dist

# ── Stage 2: the Python backend, serving the built frontend ──────────────────
FROM python:3.12-slim AS backend
WORKDIR /app

# System deps some Python libs need (pdfplumber/Pillow), kept minimal.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Backend source
COPY . .
# Bring in the built frontend from stage 1
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Network-exposed inside the container; compose maps it to the host.
ENV HOST=0.0.0.0 PORT=5051
EXPOSE 5051

# Gunicorn = production WSGI server (handles many concurrent users far better
# than Flask's dev server). `app:app` = the module-level app in app.py.
CMD ["gunicorn", "--bind", "0.0.0.0:5051", "--workers", "4", "--timeout", "120", "app:app"]

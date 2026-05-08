FROM python:3.11-slim

# ── System packages ─────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    default-jre \
    gcc \
    g++ \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# ── Working directory ───────────────────────────────────────────
WORKDIR /app

# ── Install dependencies ───────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Copy project ───────────────────────────────────────────────
COPY . .

# ── Render runtime ─────────────────────────────────────────────
ENV PYTHONUNBUFFERED=1

# ── Expose port ────────────────────────────────────────────────
EXPOSE 10000

# ── Start application ──────────────────────────────────────────
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "10000"]
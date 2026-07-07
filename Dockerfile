# StadiumIQ — multi-stage build: deps compiled in a builder layer,
# runtime runs as a non-root user on a slim base.
FROM python:3.14-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.14-slim
LABEL org.opencontainers.image.title="StadiumIQ" \
      org.opencontainers.image.description="GenAI operations copilot for FIFA World Cup 2026 venues"

# Never run as root inside the container.
RUN useradd --create-home --uid 10001 stadiumiq
WORKDIR /srv/stadiumiq

COPY --from=builder /install /usr/local
COPY app ./app
COPY static ./static

USER stadiumiq
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS build
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 ai
COPY --from=build /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build /usr/local/bin/uvicorn /usr/local/bin/uvicorn
USER ai
EXPOSE 8600
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8600/healthz', timeout=2)"
CMD ["uvicorn", "liwan_ai_service.service:app", "--host", "0.0.0.0", "--port", "8600"]

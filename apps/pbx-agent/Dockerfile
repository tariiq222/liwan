FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS build
WORKDIR /app
# Every package comes from the hashed lock (requirements.txt, regenerated as README.md describes). The runtime set
# goes to its own prefix, so nothing from the build environment reaches the final image.
COPY requirements.txt requirements-build.txt ./
RUN pip install --no-cache-dir --require-hashes --prefix=/install -r requirements.txt \
    && pip install --no-cache-dir --require-hashes -r requirements-build.txt
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir --no-deps --no-build-isolation --prefix=/install .

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
WORKDIR /app
# TZ=UTC is the reconciliation contract: Asterisk's CEL eventtime column is a wall clock, and the agent reads it as
# UTC, so the Asterisk container of the same package must run with this value too.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=UTC
RUN useradd --create-home --uid 10002 pbx \
    && mkdir -p /var/lib/pbx-agent /recordings \
    && chown -R pbx:pbx /var/lib/pbx-agent /recordings
COPY --from=build /install/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
USER pbx
EXPOSE 8601
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8601/health', timeout=2)"
CMD ["python", "-m", "pbx_agent"]

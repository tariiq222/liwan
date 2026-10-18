# deploy/odoo/Dockerfile — build context: repository root
FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq5 libldap-2.5-0 libsasl2-2 libxml2 libxslt1.1 libjpeg62-turbo \
      fonts-noto-core wkhtmltopdf postgresql-client \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG ODOO_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential libpq-dev libldap2-dev libsasl2-dev \
    && rm -rf /var/lib/apt/lists/*
RUN test -n "$ODOO_COMMIT" \
    && git init -q /opt/odoo && cd /opt/odoo \
    && git fetch -q --depth 1 https://github.com/odoo/odoo.git "$ODOO_COMMIT" \
    && git checkout -q FETCH_HEAD && rm -rf .git
# Pinned OCA repositories (deploy/oca-addons.json), fetched here and never copied into the repository.
COPY tools/oca_addons.py /tmp/oca/tools/oca_addons.py
COPY deploy/oca-addons.json /tmp/oca/deploy/oca-addons.json
RUN python /tmp/oca/tools/oca_addons.py fetch --dest /opt/oca \
    && find /opt/oca -name .git -prune -exec rm -rf {} +
COPY deploy/odoo/requirements-python312-linux.txt /tmp/requirements.txt
RUN python -m venv /opt/venv && /opt/venv/bin/pip install -r /tmp/requirements.txt

FROM base
ARG ODOO_COMMIT
ARG WEBVUE_REVISION=unknown
LABEL sa.webvue.revision=$WEBVUE_REVISION sa.webvue.odoo-commit=$ODOO_COMMIT
COPY --from=build /opt/odoo /opt/odoo
COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/oca /opt/oca
COPY odoo-addons /opt/webvue/addons
COPY tools/oca_addons.py /opt/webvue/tools/oca_addons.py
COPY deploy/oca-addons.json /opt/webvue/deploy/oca-addons.json
COPY deploy/security/odoo_secure.py /opt/webvue/odoo_secure.py
COPY deploy/shared/launch_odoo.py deploy/shared/validate_odoo_config.py /opt/webvue/shared/
COPY deploy/odoo/entrypoint.sh /usr/local/bin/webvue-odoo
RUN chmod 0755 /usr/local/bin/webvue-odoo \
    && useradd --system --uid 10001 --home-dir /var/lib/odoo --create-home odoo \
    && chmod -R a-w /opt/odoo /opt/oca /opt/webvue
ARG TARGETARCH
COPY deploy/odoo/vendor/wkhtmltox_0.12.6.1-3.bookworm_${TARGETARCH}.deb /tmp/wkhtmltox/
COPY deploy/odoo/vendor/SHA256SUMS /tmp/wkhtmltox/
RUN cd /tmp/wkhtmltox \
    && sha256sum -c --ignore-missing SHA256SUMS \
    && apt-get update \
    && apt-get remove -y wkhtmltopdf \
    && apt-get install -y --no-install-recommends "./wkhtmltox_0.12.6.1-3.bookworm_${TARGETARCH}.deb" \
    && rm -rf /tmp/wkhtmltox /var/lib/apt/lists/*
USER odoo
VOLUME /var/lib/odoo
EXPOSE 8069 8072
ENTRYPOINT ["webvue-odoo"]

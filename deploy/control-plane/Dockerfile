# deploy/control-plane/Dockerfile — build context: repository root.
# The control plane API, the ordinary worker, the migrate command and the admin CLI (apps/control-plane/src). One image, the process
# is chosen by the Compose `command`. The shared worker is NOT started from this image: it needs a Docker client and the host's
# state directories, so it stays a systemd unit (deploy/control-plane/liwan-shared-worker.service).
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/
COPY packages/commercial-contracts/package.json packages/commercial-contracts/
# The other workspace manifests keep the lockfile consistent for `npm ci`; their code is not part of this image.
COPY apps/web/package.json apps/web/
COPY apps/vendor-admin/package.json apps/vendor-admin/
COPY packages/ui/package.json packages/ui/
COPY packages/commercial-ui/package.json packages/commercial-ui/
COPY packages/contracts/package.json packages/contracts/
# tsx is a development dependency of the control plane and is how every entry point runs; --include=dev installs it.
RUN npm ci --ignore-scripts --include=dev --workspace apps/control-plane

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
ENV NODE_ENV=production
# The vendor console validates a catalog with `tools/catalog_check.py` (a standard-library Python script) before it publishes one.
RUN apk add --no-cache python3
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/control-plane apps/control-plane
COPY packages/commercial-contracts packages/commercial-contracts
# LIWAN_REPOSITORY_ROOT=/app: the catalog sources, the catalog check and the Odoo manifests it cross-checks.
COPY deploy/catalog deploy/catalog
COPY tools/catalog_check.py tools/
COPY tools/liwan_cli tools/liwan_cli
COPY odoo-addons odoo-addons
USER node
EXPOSE 4187
WORKDIR /app/apps/control-plane
# The health check is in the Compose file: the API serves HTTPS outside loopback, so the probe needs the TLS settings.
CMD ["node", "--import", "tsx", "src/main.ts"]

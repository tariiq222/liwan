FROM docker:28-cli AS cli
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/control-plane/package.json apps/control-plane/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/commercial-contracts/package.json packages/commercial-contracts/
RUN npm ci --ignore-scripts
CMD ["npm", "-w", "apps/control-plane", "run", "dev"]

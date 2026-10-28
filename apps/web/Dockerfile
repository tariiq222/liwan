FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/commercial-contracts/package.json packages/commercial-contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/control-plane/package.json apps/control-plane/
RUN npm ci
COPY . .
# Nuxt proxy rules are compiled; runtime-only shared mode is insufficient.
ARG WEBVUE_TENANCY_MODE=dedicated
ENV WEBVUE_TENANCY_MODE=${WEBVUE_TENANCY_MODE}
RUN npm -w apps/web run build

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
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
ARG LIWAN_TENANCY_MODE=dedicated
ENV LIWAN_TENANCY_MODE=${LIWAN_TENANCY_MODE}
RUN npm -w apps/web run build

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/vendor-admin/package.json apps/vendor-admin/
COPY packages/ui/package.json packages/ui/
COPY packages/commercial-ui/package.json packages/commercial-ui/
COPY packages/commercial-contracts/package.json packages/commercial-contracts/
# The other workspace manifests keep the lockfile consistent for `npm ci`; their code is not part of this image.
COPY apps/web/package.json apps/web/
COPY apps/control-plane/package.json apps/control-plane/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --ignore-scripts
COPY . .
RUN npm -w apps/vendor-admin run build

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0
COPY --from=build /repo/apps/vendor-admin/.output ./.output
USER node
EXPOSE 3100
CMD ["node", ".output/server/index.mjs"]

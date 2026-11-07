FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
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

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0
COPY --from=build /repo/apps/vendor-admin/.output ./.output
USER node
EXPOSE 3100
CMD ["node", ".output/server/index.mjs"]

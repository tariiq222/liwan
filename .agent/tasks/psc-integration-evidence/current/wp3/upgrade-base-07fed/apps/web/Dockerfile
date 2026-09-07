FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY . .
RUN npm -w apps/web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

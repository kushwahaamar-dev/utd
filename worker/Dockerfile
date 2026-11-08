# Build from the repository root: docker build -f worker/Dockerfile -t iynk-worker .
# The worker bundles the app's engines from ../src, so the image is built from the whole tree.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY worker/package.json worker/package-lock.json worker/
RUN npm --prefix worker ci --ignore-scripts
COPY src src
COPY worker worker
RUN npm --prefix worker run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/worker/dist ./dist
USER node
CMD ["node", "dist/main.mjs"]

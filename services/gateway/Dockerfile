FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY services/accounts/package.json services/accounts/package.json
COPY services/gateway/package.json services/gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --workspace @airem/gateway --include-workspace-root
COPY packages/contracts packages/contracts
COPY services/gateway services/gateway
RUN npm run build --workspace @airem/contracts && npm run build --workspace @airem/gateway
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY services/accounts/package.json services/accounts/package.json
COPY services/gateway/package.json services/gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --omit=dev --workspace @airem/gateway --include-workspace-root && npm cache clean --force
COPY --from=build --chown=node:node /app/services/gateway/dist dist
COPY --chown=node:node services/gateway/migrations migrations
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

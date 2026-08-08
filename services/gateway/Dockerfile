FROM node:22-alpine AS contracts-build
WORKDIR /app/packages/contracts
COPY packages/contracts/package.json packages/contracts/package-lock.json packages/contracts/tsconfig.json ./
RUN npm ci
COPY packages/contracts/src ./src
RUN npm run build

FROM node:22-alpine AS gateway-build
WORKDIR /app
COPY --from=contracts-build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=contracts-build /app/packages/contracts/dist ./packages/contracts/dist
WORKDIR /app/services/gateway
COPY services/gateway/package.json services/gateway/package-lock.json ./
RUN npm ci
COPY services/gateway/tsconfig.json ./
COPY services/gateway/src ./src
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=contracts-build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=contracts-build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
WORKDIR /app/services/gateway
COPY --chown=node:node services/gateway/package.json services/gateway/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=gateway-build --chown=node:node /app/services/gateway/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

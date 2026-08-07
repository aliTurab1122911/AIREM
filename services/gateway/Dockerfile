FROM node:22-alpine AS build
WORKDIR /app/services/gateway
COPY packages/contracts /app/packages/contracts
COPY services/gateway/package*.json ./
RUN npm install
COPY services/gateway/tsconfig.json ./
COPY services/gateway/src src
RUN npm run build
FROM node:22-alpine
WORKDIR /app/services/gateway
ENV NODE_ENV=production
COPY packages/contracts /app/packages/contracts
COPY services/gateway/package*.json ./
RUN npm install --omit=dev
RUN npm cache clean --force
COPY --from=build --chown=node:node /app/services/gateway/dist dist
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

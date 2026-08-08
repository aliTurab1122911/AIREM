FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY services/accounts/package.json services/accounts/package.json
COPY services/gateway/package.json services/gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY e2e/package.json e2e/package.json
COPY frontend/scripts frontend/scripts
RUN npm ci --workspace airem-frontend --include-workspace-root
COPY frontend frontend
COPY packages/contracts packages/contracts
RUN npm run build --workspace @airem/contracts && npm run build --workspace airem-frontend

FROM nginx:1.27-alpine AS production
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/proxy_params /etc/nginx/proxy_params
COPY --from=build --chown=nginx:nginx /app/frontend/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080 8443

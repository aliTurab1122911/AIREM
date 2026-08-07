FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts scripts
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY proxy_params /etc/nginx/proxy_params
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080 8443

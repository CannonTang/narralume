FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

RUN mkdir -p /runtime/apps/server /runtime/packages \
  && cp -r apps/server/dist /runtime/apps/server/ \
  && cp apps/server/package.json /runtime/apps/server/ \
  && cp package.json package-lock.json /runtime/ \
  && cp -r node_modules /runtime/ \
  && for package in context contracts domain harness llm narrative persistence services; do \
       mkdir -p "/runtime/packages/$package"; \
       cp -r "packages/$package/dist" "/runtime/packages/$package/"; \
       cp "packages/$package/package.json" "/runtime/packages/$package/"; \
     done

FROM node:24-bookworm-slim AS server
WORKDIR /app
COPY --from=build /runtime ./
ENV NODE_ENV=production
ENV NARRATIVE_SERVER_HOST=0.0.0.0
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4317
CMD ["node", "apps/server/dist/main.js"]

FROM nginx:stable-alpine AS web
ENV NGINX_ENVSUBST_FILTER='^NARRATIVE_AUTH_TOKEN$'
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

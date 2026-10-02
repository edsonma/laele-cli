# Builds the web version (web/) and serves it as static files with Caddy.
# Used by Railway; works anywhere Docker does:
#   docker build -t laele-web . && docker run --rm -e PORT=8080 -p 8080:8080 laele-web

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# web/ imports ../slang.json (shared with the Go CLI), so the build context is the repo root
COPY slang.json ./slang.json
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- serve ----
FROM caddy:2-alpine
COPY web/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
ENV PORT=8080
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

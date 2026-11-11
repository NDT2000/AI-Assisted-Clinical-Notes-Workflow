# Production image for the web app: the built frontend served by nginx,
# which also forwards /api and the live connection to the API.
# Build from the repository root (the build reads the shared contract/):
#   docker build -f frontend/Dockerfile -t clinical-notes-web .

# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app/frontend

# Dependencies first, in their own layer, so code changes do not reinstall
# them. Exact versions from package-lock.json.
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# The workflow rules and API description shared with the backend.
COPY contract /app/contract
COPY frontend ./

# Type check and build. The API is on the same address, so no API URL.
RUN npm run build

# ---- Run stage -------------------------------------------------------------
# nginx as a regular user (uid 101), listening on 8080.
FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

# Where nginx forwards /api; Compose names the API service `api`.
ENV API_UPSTREAM=api:8000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

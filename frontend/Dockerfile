# frontend — multi-stage: build the Vite SPA, then serve it with nginx as both a
# static SPA host AND a same-origin reverse proxy to a backend.
#
# ONE image is reused by BOTH frontend services (frontend-python, frontend-ts).
# The image is backend-AGNOSTIC: the SPA is built with VITE_API_BASE_URL=/api so
# the app always calls SAME-ORIGIN /api/* (which also keeps the MSW mock OFF,
# since it only starts when VITE_API_BASE_URL is unset). Which backend a given
# container talks to is decided at RUNTIME by the BACKEND_UPSTREAM env var, which
# is substituted into the nginx config at container start.
#
# Build context is frontend/. The repo-root `.env` is never copied.

FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies against the lockfile (deterministic).
COPY package.json package-lock.json ./
RUN npm ci

# Build the SPA. Same-origin API base => MSW stays off and the app calls /api/*.
ENV VITE_API_BASE_URL=/api
COPY . .
RUN npm run build

# ---- runtime: nginx serving the SPA + proxying /api/ ----
FROM nginx:1.27-alpine

# Compiled SPA.
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx:alpine auto-runs envsubst over /etc/nginx/templates/*.template at start,
# writing the result to /etc/nginx/conf.d/. Restrict substitution to our own
# BACKEND_* vars so nginx runtime vars ($host, $uri, ...) are left intact.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^BACKEND_
# Sensible default upstream; docker-compose overrides per frontend instance.
ENV BACKEND_UPSTREAM=http://backend-python:8000

EXPOSE 80

# backend-ts (NestJS) — multi-stage node build.
#
# Stage 1 (builder): `npm ci` (all deps, incl. dev for the Nest compiler) then
# `npm run build` → dist/main.js.
# Stage 2 (runtime): a slim node image with ONLY production deps + the compiled
# dist/. Runs `node dist/main.js`, listening on 0.0.0.0:3000.
#
# Build context is backend-ts/. The repo-root `.env` is NOT in this context and
# is never copied; DATABASE_URL/TS_API_PORT are injected via docker-compose.

FROM node:22-slim AS builder

WORKDIR /app

# Install ALL dependencies against the lockfile (deterministic) for the build.
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# Prune to production-only dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# Bring over only what running the server needs: production node_modules,
# the compiled output, and package.json (for module resolution / metadata).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Drop privileges: the official node image ships a non-root `node` user.
USER node

EXPOSE 3000

# NestJS (Express) listens on all interfaces by default; main.ts honors
# TS_API_PORT (default 3000). The nginx frontend proxies /api/ here.
CMD ["node", "dist/main.js"]

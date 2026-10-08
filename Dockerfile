# syntax=docker/dockerfile:1.7
#
# LearnLoop production image.
#
#   docker build -t learnloop .
#   docker run -p 3000:3000 --env-file .env -v learnloop-storage:/app/storage learnloop
#
# Usually started through docker-compose.yml (app + Caddy for HTTPS); see
# DEPLOYMENT.md. The database is PostgreSQL (Supabase): DATABASE_URL and
# DIRECT_URL come from the environment, and every start runs
# `prisma migrate deploy` first (scripts/docker-entrypoint.sh). Locally stored
# uploads, generated video renditions and backups (JSON exports) live in
# /app/storage, which should be a volume (or use S3 for uploads).

ARG NODE_IMAGE=node:24-slim

# ---------------------------------------------------------------------------
# 1. Dependencies (cached until package-lock.json changes)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# openssl: Prisma picks its query engine for the installed OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `npm ci` runs `prisma generate` (postinstall), which reads the schema.
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# 1b. The Prisma CLI for `prisma migrate deploy` at start-up, on its own
#     (the standalone server does not include dev dependencies). Its schema
#     engine is fetched here, at build time, for this platform.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS migrator
WORKDIR /migrator
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json ./app-package.json
RUN --mount=type=cache,target=/root/.npm \
  PRISMA_VERSION="$(node -p "require('./app-package.json').devDependencies.prisma")" \
  && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund --no-save "prisma@${PRISMA_VERSION}" \
  && node node_modules/prisma/build/index.js version

# ---------------------------------------------------------------------------
# 2. Build (`output: "standalone"` in next.config.ts)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Runtime secrets are not needed (or wanted) at build time: the start-up
# checks in src/lib/env-check.ts skip `next build`, and no page reads the
# database while it is prerendered, so the build has no DATABASE_URL.
ENV DATABASE_URL="" \
    DIRECT_URL="" \
    STORAGE_DIR=/tmp/learnloop-build/storage \
    UPLOAD_DIR=/tmp/learnloop-build/uploads
# The build output must never carry data or secrets (next.config.ts already
# excludes them from tracing; this removes anything that slipped through).
RUN npm run build \
  && rm -rf .next/standalone/storage .next/standalone/.env .next/standalone/.env.* .next/standalone/tests

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# ffmpeg/ffprobe: HLS conversion, video duration and thumbnails.
# ca-certificates: outgoing HTTPS (Stripe, Razorpay, SMTP over TLS, S3, webhooks).
# tini: forwards signals so `docker stop` shuts the server down cleanly.
# openssl: needed by Prisma's query and schema engines.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini openssl \
  && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}

# The standalone server, static assets and public files. The database
# command-line tools (`node scripts/db-backup.mjs`, …) need their helpers, the
# database modules they import and the Prisma client (already in the
# standalone node_modules); migrations need the Prisma CLI and prisma/.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src/lib/db/data-core.mjs /app/src/lib/db/backup-core.mjs /app/src/lib/db/postgres-core.mjs /app/src/lib/db/postgres-tables.mjs ./src/lib/db/
COPY --from=migrator --chown=node:node /migrator/node_modules ./migrator/node_modules
# (A Windows checkout may have given the script CRLF line endings, which sh cannot run.)
RUN sed -i 's/$//' /app/scripts/docker-entrypoint.sh && chmod +x /app/scripts/docker-entrypoint.sh

# Files the app keeps (backups, local uploads, SEO files); the image cache
# (.next/cache) must be writable too. /app/storage starts empty: Docker seeds a
# new named volume from the image's copy of this folder, so it must never
# contain data or backups.
RUN rm -rf /app/storage && mkdir -p /app/storage /app/.next/cache && chown -R node:node /app/storage /app/.next/cache
VOLUME ["/app/storage"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Migrations first (prisma migrate deploy; MIGRATE_ON_START=false skips them), then the server.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]

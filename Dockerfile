# syntax=docker/dockerfile:1.7
#
# LearnLoop production image.
#
#   docker build -t learnloop .
#   docker run -p 3000:3000 --env-file .env -v learnloop-storage:/app/storage learnloop
#
# Usually started through docker-compose.yml (app + Caddy for HTTPS); see
# DEPLOYMENT.md. The database (SQLite), uploads, generated video renditions and
# backups all live in /app/storage, which must be a volume.

ARG NODE_IMAGE=node:24-slim

# ---------------------------------------------------------------------------
# 1. Dependencies (cached until package-lock.json changes)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# 2. Build (`output: "standalone"` in next.config.ts)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Runtime secrets are not needed (or wanted) at build time: the start-up
# checks in src/lib/env-check.ts skip `next build`. Pages prerendered during
# the build (the web manifest reads the settings) open a database; keep that
# throw-away database outside /app, without demo data, so nothing from the
# build can end up in the image or seed the production volume.
ENV SEED_DEMO_DATA=false     SQLITE_PATH=/tmp/learnloop-build/lms.sqlite     DATA_FILE=/tmp/learnloop-build/db.json     UPLOAD_DIR=/tmp/learnloop-build/uploads
# The build output must never carry data or secrets (next.config.ts already
# excludes them from tracing; this is the belt to those braces).
RUN npm run build   && rm -rf .next/standalone/storage .next/standalone/.env .next/standalone/.env.* .next/standalone/tests

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# ffmpeg/ffprobe: HLS conversion, video duration and thumbnails.
# ca-certificates: outgoing HTTPS (Stripe, Razorpay, SMTP over TLS, S3, webhooks).
# tini: forwards signals so `docker stop` shuts the server down cleanly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}

# The standalone server, static assets and public files. The backup/restore
# command-line tools (`node scripts/db-backup.mjs`, …) only need Node built-ins,
# their helpers and the two database modules they import.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src/lib/db/sqlite-core.mjs /app/src/lib/db/backup-core.mjs ./src/lib/db/

# Persistent data; the image cache (.next/cache) must be writable too.
# /app/storage starts empty: Docker seeds a new named volume from the image's
# copy of this folder, so it must never contain a database or backups.
RUN rm -rf /app/storage && mkdir -p /app/storage /app/.next/cache && chown -R node:node /app/storage /app/.next/cache
VOLUME ["/app/storage"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

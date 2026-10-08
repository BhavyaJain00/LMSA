#!/bin/sh
# Container start-up (see Dockerfile): bring the PostgreSQL tables up to date
# with `prisma migrate deploy` (the same as `npm run db:setup`), then start
# the server. Safe on every start: applied migrations are skipped. An empty
# database is filled by the app itself on its first request (SEED_DEMO_DATA /
# bootstrap admin). Set MIGRATE_ON_START=false to run migrations yourself.
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. The app stores everything in PostgreSQL (Supabase): add DATABASE_URL and DIRECT_URL to .env (see ENV-SETUP.md, section 3 \"Database\")." >&2
  exit 1
fi

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  if [ -z "${DIRECT_URL:-}" ]; then
    echo "[entrypoint] DIRECT_URL is not set; migrating through DATABASE_URL (with Supabase, set DIRECT_URL to the port 5432 connection)." >&2
    export DIRECT_URL="$DATABASE_URL"
  fi
  echo "[entrypoint] applying database migrations (prisma migrate deploy)"
  node /app/migrator/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma
fi

exec "$@"

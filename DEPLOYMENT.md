# Deploying LearnLoop

LearnLoop is a single Next.js server that keeps its records in **PostgreSQL**, normally a [Supabase](https://supabase.com) project (any PostgreSQL 13 or newer works; [section 15](#15-the-database-supabase-or-your-own-postgresql) also shows a local PostgreSQL in Docker for people without Supabase). There is no other database: the server refuses to start without `DATABASE_URL`. Next to the database the app needs one data folder for files: database backups (JSON exports), the SEO files and, unless you use object storage, the uploaded files and video renditions. That folder is the `/app/storage` volume with Docker, or a folder outside the project such as `/opt/learnloop/storage` without Docker (see section 3 for why it must be outside). For production, the owner's choice for uploads is an **AWS S3** bucket ([section 9](#9-object-storage-aws-s3-and-a-cdn)); the server's own disk stays the default for development.

A small VPS (2 vCPU, 4 GB RAM, 40 GB disk) runs a school with thousands of learners; video conversion is the only CPU-heavy job.

Contents:

1. [Requirements and sizing](#1-requirements)
2. [VPS with Docker and Caddy (recommended)](#2-vps-with-docker-and-caddy-recommended)
3. [Without Docker: Linux with systemd or pm2, Windows](#3-without-docker)
4. [Environment variables](#4-environment-variables)
5. [Scheduled jobs (cron)](#5-scheduled-jobs-cron)
6. [Backups and restores (with an off-site copy)](#6-backups-and-restores)
7. [Payments: Stripe and Razorpay webhooks](#7-payments-stripe-and-razorpay-webhooks)
8. [Email (SMTP providers)](#8-email-smtp-providers)
9. [Object storage (AWS S3) and a CDN](#9-object-storage-aws-s3-and-a-cdn)
10. [ffmpeg](#10-ffmpeg)
11. [Monitoring: health check and error log](#11-monitoring-health-check-and-error-log)
12. [Upgrading](#12-upgrading)
13. [Search engines: Search Console and the sitemap](#13-search-engines-search-console-and-the-sitemap)
14. [Pre-launch checklist](#14-pre-launch-checklist)
15. [The database: Supabase or your own PostgreSQL](#15-the-database-supabase-or-your-own-postgresql)

---

## 1. Requirements

- A domain (or sub-domain such as `learn.example.com`) whose DNS `A`/`AAAA` record points at the server.
- Ports 80 and 443 open to the internet (Caddy needs both to obtain and renew certificates).
- **A PostgreSQL database**: a Supabase project (free to start; choose the region closest to your app server and students, for India **Mumbai / ap-south-1**), or the local PostgreSQL container from `docker-compose.yml`. [Section 15](#15-the-database-supabase-or-your-own-postgresql) shows both.
- **Docker route:** Docker Engine 24+ with the Compose plugin (v2.23+ for the optional cron service).
- **Without Docker:** Node.js 24, ffmpeg, and a reverse proxy for HTTPS (Caddy or nginx).
- **For uploads in production (recommended):** an AWS account with an S3 bucket, see [section 9](#9-object-storage-aws-s3-and-a-cdn).

### Sizing

The app loads every record into memory when it starts and afterwards writes only the records a request changed, one small PostgreSQL transaction at a time. Run **one** app process per database (no cluster mode, no second replica and no serverless instance on the same database) and scale up with a larger server rather than more processes.

`tests/store-scale.test.ts` checks the store itself at school scale on every `npm test`, on an in-memory test database (no network): 5,000 learners, 50 courses with 1,000 lessons, 50,000 enrollments, 100,000 lesson-progress and 100,000 video-progress records, which is about 256,000 records (59 MB as JSON). Measured on an 8-core desktop with Node 24:

| What | Measured | Test fails above |
| --- | --- | --- |
| Cold start: load all 256,300 records | 1.6 s, about 300 MB of memory afterwards | 20 s |
| 1,000 sequential heartbeat-style `mutate()` calls, each saved in its own transaction (one record compared, one row written) | p50 1.6 ms, **p95 4.2 ms**, p99 5.7 ms | p95 60 ms |
| 1,000 concurrent heartbeats on 400 records | saved in 1 transaction of 400 rows | more than 3 transactions |
| Background sweep of all 256,300 records (looks for edits made outside `mutate()`) | about 140 slices, 1.2 s of work, longest slice 13 ms | slice over 50 ms |

The figures are printed as test diagnostics in the `npm test` output, so you can measure your own server. With PostgreSQL every save adds a network round trip to the database, which is why the database region should be close to the app server. Saving cost depends on what changed, not on how big the school is. Memory grows with the number of records: allow about 1.5 GB of RAM per million records, plus the operating system and ffmpeg. A 2 vCPU / 4 GB server handles a school of this size with room to spare.

Database size: the Supabase Free plan allows a 500 MB database (Pro: 8 GB included). A school of the size above fits easily; uploads and videos never go into the database.

## 2. VPS with Docker and Caddy (recommended)

The repository contains a multi-stage `Dockerfile` (Node 24 slim, ffmpeg, non-root user, health check), `docker-compose.yml` (the app plus Caddy with automatic HTTPS) and a `Caddyfile`. On every start the container first runs `prisma migrate deploy` (the same as `npm run db:setup`) through `scripts/docker-entrypoint.sh`, so the database tables are created on the first start and updated after every upgrade.

1. **Create the database.** Make a Supabase project and copy its two connection strings, `DATABASE_URL` and `DIRECT_URL` ([section 15](#15-the-database-supabase-or-your-own-postgresql), or ENV-SETUP.md section 3). Without Supabase, see "A local PostgreSQL in Docker" in section 15.

2. **Install Docker** (Ubuntu/Debian):

   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"   # log out and back in
   ```

3. **Get the code** onto the server:

   ```sh
   git clone <your repository URL> learnloop && cd learnloop
   ```

4. **Create `.env`** from the example and fill in at least these values:

   ```sh
   cp .env.example .env
   openssl rand -hex 32        # paste the output as APP_SECRET
   ```

   ```ini
   APP_URL=https://learn.example.com
   APP_SECRET=<64 hex characters>
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
   DIRECT_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DOMAIN=learn.example.com          # used by Caddy
   ACME_EMAIL=you@example.com        # certificate expiry notices
   SEED_DEMO_DATA=false
   ADMIN_NAME=Your Name
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<a long password, change it after the first sign-in>
   MAIL_TRANSPORT=smtp
   SMTP_HOST=...                     # see section 8
   ```

   `docker-compose.yml` sets `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, `STORAGE_DIR` and `UPLOAD_DIR` for you, and stops with "Set DATABASE_URL in .env" when `DATABASE_URL` is missing. Add the `STORAGE_DRIVER=s3` and `S3_*` lines from [section 9](#9-object-storage-aws-s3-and-a-cdn) now or later.

5. **Start it:**

   ```sh
   docker compose up -d --build
   docker compose logs -f app       # "[entrypoint] applying database migrations", then "Ready"
   ```

   Caddy requests a certificate the first time someone opens `https://learn.example.com` (usually within seconds). The first request fills the empty database with your administrator account (`SEED_DEMO_DATA=false`). If the app refuses to start, the log lists the missing settings (see [section 4](#4-environment-variables)).

6. **Sign in** with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, change the password, turn on two-factor authentication, then work through the [pre-launch checklist](#14-pre-launch-checklist).

7. **Turn on the scheduler**: copy the cron key from *Admin → Settings → Email*, add `CRON_KEY=<key>` to `.env`, then:

   ```sh
   docker compose --profile cron up -d
   ```

Useful commands:

| Task | Command |
| --- | --- |
| Status and health | `docker compose ps` (the app shows `healthy`) |
| Logs | `docker compose logs -f app` / `docker compose logs -f caddy` |
| Restart | `docker compose restart app` |
| Shell in the container | `docker compose exec app sh` |
| Manual backup (JSON export) | `docker compose exec app node scripts/db-backup.mjs` |

The records are in PostgreSQL. The `learnloop_storage` volume (`docker volume inspect learnloop_storage` shows where it is on disk) holds the backups, the SEO files and, without S3, the uploads. Never run `docker compose down -v`: `-v` deletes the volumes, including those files (and, with the local `postgres` profile, the database itself).

To run the migrations yourself instead of on every start, set `MIGRATE_ON_START=false` in `.env` and run `npm run db:setup` from a checkout of the same version before you start the new image.

### Reverse proxy and client IPs

LearnLoop rate-limits sign-ins, password resets, sign-ups, contact forms and error reports per client IP, and shows the IP in the login history and security emails. Behind a proxy every request comes from the proxy's address, so the app reads the client IP from `X-Forwarded-For`, counting `TRUST_PROXY_HOPS` entries from the right:

- `TRUST_PROXY_HOPS=0` (default): no proxy headers are trusted. Every visitor shares one rate-limit bucket (per-email limits still apply), and IPs are shown as unknown. Use this only when the app is reached directly.
- `TRUST_PROXY_HOPS=1`: one proxy (Caddy, nginx, a load balancer). This is what `docker-compose.yml` sets.
- `TRUST_PROXY_HOPS=2`: a CDN or load balancer in front of Caddy/nginx (for example Cloudflare proxying to Caddy).

Never set it higher than the real number of proxies: visitors could then forge their IP and dodge rate limits.

## 3. Without Docker

### Linux with systemd

```sh
# Node.js 24 and ffmpeg (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg

sudo useradd --system --create-home --home-dir /opt/learnloop learnloop
# The data folder lives OUTSIDE the project (see "Where the files live" below).
sudo -u learnloop mkdir -p /opt/learnloop/storage
sudo -u learnloop git clone <your repository URL> /opt/learnloop/app
cd /opt/learnloop/app
sudo -u learnloop cp .env.example .env   # fill it in (section 4): DATABASE_URL, DIRECT_URL, TRUST_PROXY_HOPS=1 and the paths below
sudo -u learnloop npm ci
sudo -u learnloop npm run db:setup       # creates the tables in PostgreSQL (prisma migrate deploy)
sudo -u learnloop npm run build
# The standalone server needs the static files next to it:
sudo -u learnloop cp -r public .next/standalone/ && sudo -u learnloop cp -r .next/static .next/standalone/.next/
```

`npm run build` does not touch the database, so it also works on a machine without `DATABASE_URL`; `npm run db:setup` needs both `DATABASE_URL` and `DIRECT_URL`.

**Where the files live.** Add these lines to `.env` (absolute paths):

```sh
STORAGE_DIR=/opt/learnloop/storage
UPLOAD_DIR=/opt/learnloop/storage/uploads
```

The standalone server (`.next/standalone/server.js`) changes into its own folder when it starts, so the default relative paths (`storage`, `storage/uploads`) would put the backups and uploads inside `.next/standalone/`, and the next `npm run build` deletes that folder with everything in it. In production the server therefore refuses to start from `.next/standalone` while `STORAGE_DIR` or `UPLOAD_DIR` is relative. Backups (`/opt/learnloop/storage/backups/`), the SEO files (`/opt/learnloop/storage/seo/`) and the app's other small files go into `STORAGE_DIR`, and the `npm run db:*` scripts read the same `.env`, so they use the same database and backups folder.

`/etc/systemd/system/learnloop.service`:

```ini
[Unit]
Description=LearnLoop
After=network-online.target
Wants=network-online.target

[Service]
User=learnloop
# server.js changes into its own folder anyway; the files are NOT here but in the
# absolute STORAGE_DIR / UPLOAD_DIR from .env (/opt/learnloop/storage).
WorkingDirectory=/opt/learnloop/app/.next/standalone
EnvironmentFile=/opt/learnloop/app/.env
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node /opt/learnloop/app/.next/standalone/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now learnloop
journalctl -u learnloop -f
```

Put Caddy in front (`sudo apt install caddy`) with this `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`:

```caddyfile
learn.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000 {
		transport http {
			read_timeout 30m
			write_timeout 30m
		}
	}
}
```

With nginx instead, set `client_max_body_size 0;` (large video uploads), `proxy_read_timeout 1800s;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Proto $scheme;`, and get a certificate with certbot.

### Linux or Windows with pm2

```sh
npm install -g pm2
npm ci && npm run db:setup && npm run build
# copy public/ and .next/static/ next to the standalone server as shown above
pm2 start .next/standalone/server.js --name learnloop --time
pm2 save
pm2 startup        # Linux: prints the command that starts pm2 at boot
```

As with systemd, keep the files outside the project and give the server absolute paths (see "Where the files live" above): `STORAGE_DIR=/opt/learnloop/storage` and `UPLOAD_DIR=/opt/learnloop/storage/uploads`, or on Windows for example `STORAGE_DIR=D:\learnloop-data` and `UPLOAD_DIR=D:\learnloop-data\uploads`. The server refuses to start with relative paths, because they would resolve inside `.next\standalone`, which every build deletes.

pm2 does not read `.env` by itself for the standalone server: export the variables in the shell first, or use an `ecosystem.config.cjs` with an `env` block (`NODE_ENV: "production"`, `APP_URL`, `APP_SECRET`, `DATABASE_URL`, `DIRECT_URL`, the two paths, …). On Windows, start pm2 at boot with `pm2-installer` or the Task Scheduler (`pm2 resurrect` at log-on), install ffmpeg with `winget install Gyan.FFmpeg`, and put Caddy for Windows (`caddy run` as a service via `sc.exe` or NSSM) in front for HTTPS.

**Installed earlier with relative paths?** Your files may be in `.next/standalone/storage/`. Before the next build: stop the app, move that folder's contents to the new data folder (`mv .next/standalone/storage/* /opt/learnloop/storage/`), set the two absolute paths in `.env`, then build and start again. If that folder holds an `lms.sqlite` or `db.json` from an older version, copy its records into PostgreSQL with `npm run db:to-postgres` (section 15).

## 4. Environment variables

The server checks its configuration at start-up (`src/lib/env-check.ts`). In every environment, including development, it **refuses to start** without `DATABASE_URL`. In production it also **refuses to start** when `APP_SECRET` is missing or shorter than 32 characters, when `APP_URL` is not `https://` (except on localhost), or when a half-configured integration would fail (SMTP without a host, Razorpay without its secret, S3 without its keys). Warnings are printed to the log and shown at the top of *Admin → Error log*. The checks never run during `next build`, so build machines do not need secrets.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Public `https://` origin without a trailing slash. Used in emails, payment callbacks, calendar feeds, canonical URLs and the sitemap. |
| `APP_SECRET` | yes | ≥ 32 random characters (`openssl rand -hex 32`). Signs protected video URLs, unsubscribe and calendar links and the cron key; encrypts 2FA secrets. Changing it breaks those links and 2FA enrolments, so set it once. |
| `TRUST_PROXY_HOPS` | behind a proxy | Number of reverse proxies (see above). `1` behind Caddy/nginx. |
| `SEED_DEMO_DATA` | yes (`false`) | `true` loads demo courses and demo accounts with public passwords into a new database. Always `false` in production. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start | The administrator created in a new, empty database. |
| `MAIL_TRANSPORT` | yes (`smtp`) | `log` keeps emails in the outbox without sending them. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | with SMTP | See [section 8](#8-email-smtp-providers). |
| `SMTP_REQUIRE_TLS` | no (default `true`) | Refuses to send over an unencrypted connection to a remote server. Set `false` only for a trusted relay without TLS: password-reset links would travel in clear text. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | with Stripe | See [section 7](#7-payments-stripe-and-razorpay-webhooks). |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | with Razorpay | See section 7. |
| `STORAGE_DRIVER`, `S3_*` | production: recommended | `local` (default: files in `UPLOAD_DIR`) or `s3` (AWS S3 bucket: `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `S3_ENDPOINT` empty for AWS; optional `S3_PUBLIC_BASE_URL`, `S3_FORCE_PATH_STYLE`). See [section 9](#9-object-storage-aws-s3-and-a-cdn). |
| `DATABASE_URL`, `DIRECT_URL` | **yes** | PostgreSQL is the only database. The app's connection (Supabase: transaction pooler, port 6543, `?pgbouncer=true&connection_limit=5`) and the one `npm run db:setup` (`prisma migrate deploy`) uses (session pooler or direct, port 5432). The server refuses to start without `DATABASE_URL`, in every environment (see ENV-SETUP.md, section 3, and [section 15](#15-the-database-supabase-or-your-own-postgresql)). Older settings for a file database are no longer used: the server warns when it still finds them. |
| `TEST_DATABASE_URL` | tests only | A throwaway PostgreSQL for `npm run test:pg`; never a real site's database. |
| `STORAGE_DIR`, `UPLOAD_DIR` | without Docker | Defaults `storage` (backups as JSON exports in `backups/`, SEO files in `seo/`) and `storage/uploads`. Docker: keep the defaults (`docker-compose.yml` sets them). Without Docker: **absolute** paths outside the project, see section 3; a production server started from `.next/standalone` refuses relative ones. |
| `IMAGE_HOSTS` | no | Extra HTTPS hosts the image optimizer (`/_next/image`) may fetch from, comma-separated (`cdn.example.com,*.example.org`). `APP_URL`, `S3_PUBLIC_BASE_URL` and the S3 bucket are always allowed; every other host is refused so the optimizer cannot be used as an open proxy. Read at build time. |
| `DB_AUTO_BACKUP`, `DB_BACKUP_KEEP` | no | Daily automatic backup (a JSON export of the database into `STORAGE_DIR/backups`) on/off (default `true`) and how many daily backups to keep (default 14, 1–3650). |
| `MAX_VIDEO_UPLOAD_MB`, `MAX_FILE_UPLOAD_MB` | no | Upload limits in MB (defaults 10240, i.e. 10 GB, and 25). Video uploads are chunked and resumable, so files over 5 GB work; a reverse proxy only needs to accept one chunk per request. |
| `UPLOAD_MIN_FREE_MB`, `UPLOAD_LEARNER_DAILY_MB` | no | Refuse uploads when the disk has less free space than this (default 1024), and the daily upload allowance of a learner account (default 500). |
| `SESSION_DAYS`, `SESSION_COOKIE_NAME`, `COOKIE_SECURE` | no | Sign-in session length (30), cookie name, HTTPS-only cookie (on by default in production). |
| `FFMPEG_PATH`, `FFPROBE_PATH` | no | When ffmpeg is not on the `PATH`. |
| `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | no | Automatic captions through a Whisper-compatible API. |
| `ANTHROPIC_API_KEY` | no | AI tutor and AI features (can also be set in *Admin → Settings → AI tutor*). |
| `SEO_CANONICAL_HOST` | no | `www` (default: redirect the www twin of `APP_URL`), `all` (redirect every other host name; only when the proxy forwards the visitor's Host header), `off`. |
| `QUIZ_ATTEMPT_SECRET` | no | Separate signing key for quiz attempts (generated otherwise). |
| `TZ` | no | Server time zone, used for dates printed on certificates (e.g. `Asia/Kolkata`). |
| `APP_VERSION` | no | Shown by `/api/health` (the Docker build passes it through). |
| `DOMAIN`, `ACME_EMAIL`, `CRON_KEY`, `POSTGRES_PASSWORD` | Docker only | Read by `docker-compose.yml` for Caddy, the cron service and the optional `postgres` service, not by the app. |
| `MIGRATE_ON_START` | Docker only | `false` stops the container from running `prisma migrate deploy` before the server starts (default: it runs on every start). |

Development only, ignored in production: `LL_DEV_LOGIN` (test sign-in route; the server warns when it is set, so remove it), `WEBHOOKS_ALLOW_PRIVATE_NETWORK` (outgoing webhooks to localhost) and `DEBUG` (stack traces from the `npm run db:*` scripts). `.env.example` lists every variable with a one-line comment.

## 5. Scheduled jobs (cron)

Every job also runs lazily while people use the site, but a schedule keeps queued emails, renewals and conversions on time after quiet periods and restarts. All endpoints share one **cron key**, derived from `APP_SECRET` and shown in *Admin → Settings → Email*. Send it as `?key=<key>` or as `Authorization: Bearer <key>` (preferred: it stays out of access logs).

| Endpoint | Schedule | What it does |
| --- | --- | --- |
| `/api/cron/emails` | every minute | Delivers queued emails and retries; removes sent mail older than 90 days. |
| `/api/cron/webhooks` | every minute | Outgoing webhook deliveries and retries. |
| `/api/cron/comms` | every 1–5 minutes | Scheduled broadcasts, email sequences, campaign statistics. |
| `/api/cron/media` | every 10 minutes | Video conversions (HLS), expired resumable uploads, unused renditions, moving files to S3. |
| `/api/cron/commerce` | hourly | Membership renewals and expiry, trial reminders, installment plans, scheduled gifts, abandoned-checkout reminders, missed gateway webhooks, analytics retention. |

With Docker, `docker compose --profile cron up -d` runs exactly this schedule (it needs `CRON_KEY` in `.env`). Without Docker, add to the crontab of any user (`crontab -e`):

```cron
KEY=<cron key>
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/emails
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/webhooks
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/comms
*/10 * * * * curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/media
17 * * * *   curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/commerce
```

On Windows use the Task Scheduler with `curl.exe` and the same URLs. Changing `APP_SECRET` changes the key, so update `CRON_KEY` and your crontab afterwards. A wrong or missing key returns `401 Unauthorized`; test a URL once by hand (`curl -i -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/emails`) and expect `200` with a JSON summary.

## 6. Backups and restores

There are two kinds of database backups, and a live site should use both:

- **Supabase's own backups** of the PostgreSQL database (*Database → Backups* in the Supabase dashboard). On the Pro plan they are made daily and kept for 7 days, and point-in-time recovery is a paid add-on. The Free plan does not include automatic backups, so on that plan the app's own backups below are your only copy. With your own PostgreSQL server (section 15) you look after its backups yourself (for example `pg_dump` against `DIRECT_URL`).
- **The app's backups**: JSON exports of every record and the settings. The app makes one automatically on the first request of each day and keeps the newest 14 (`DB_AUTO_BACKUP`, `DB_BACKUP_KEEP`); *Admin → Settings → Backup & restore* (`/admin/settings/data`) lists them, makes manual backups, downloads them, accepts an uploaded JSON export and restores any of them. They are written to the `backups/` folder inside `STORAGE_DIR` (`/app/storage/backups/` in Docker, `/opt/learnloop/storage/backups/` in the section 3 layout), safely while the app runs. `npm run db:backup` makes the same export from the command line.

The data folder (`STORAGE_DIR`) must be writable by the app and survive restarts and redeploys: besides `backups/` it holds `seo/` (the IndexNow key and generated SEO files) and, with local storage, the uploads.

**Uploads are not inside the database backup.** With AWS S3 (section 9) the files are in the bucket; otherwise back up the uploads folder (`UPLOAD_DIR`) together with the backups.

The exports contain password hashes, sessions and payment records: keep downloaded copies somewhere safe.

### Nightly backup with an off-site copy

A backup on the app server's disk does not survive a lost server. Copy it elsewhere every night, for example with [rclone](https://rclone.org) to S3, Backblaze B2 or Google Drive (use a different bucket from the uploads bucket):

```sh
# /etc/cron.d/learnloop-backup  (Docker)
30 2 * * * root cd /home/deploy/learnloop && docker compose exec -T app node scripts/db-backup.mjs --auto >/dev/null \
  && docker run --rm -v learnloop_storage:/data:ro -v /root/.config/rclone:/config/rclone rclone/rclone \
     sync /data remote:learnloop-backups/storage --exclude "hls/**"
```

Without Docker (files in `/opt/learnloop/storage`, section 3): `cd /opt/learnloop/app && npm run db:backup -- --auto && rclone sync /opt/learnloop/storage remote:learnloop-backups/storage --exclude "hls/**"`. `--auto` makes today's automatic backup only when it does not exist yet, so it is safe to run from cron even on busy days. Check once that the folder you copy really holds `backups/` with `.json` files. Keep at least 30 days of copies (enable bucket versioning or lifecycle rules) and encrypt them (`rclone crypt`): they contain personal data.

### Restoring

Test a restore before launch and then a few times a year. The easiest way is *Admin → Settings → Backup & restore*: choose a backup (or upload a JSON export) and restore it. From the command line:

```sh
docker compose exec app node scripts/db-backup.mjs --list          # what is there
docker compose stop app
docker compose run --rm --no-deps app node scripts/db-restore.mjs latest --dry-run
docker compose run --rm --no-deps app node scripts/db-restore.mjs <backup name or path> --force --yes
docker compose start app
```

A restore replaces everything in the database (`DATABASE_URL`) in one transaction and checks the record counts before it commits. A database that already holds data, which is always the case on a live site, is only replaced with `--force`; the current data is then first saved as a "safety" backup, so the restore can itself be undone. Without Docker the same commands are `npm run db:backup -- --list` and `npm run db:restore -- <backup> --force`. To restore a Supabase backup instead, use *Database → Backups* in the Supabase dashboard and restart the app afterwards.

To move to a new server, point the new server at the same database (the same `DATABASE_URL` and `DIRECT_URL`), copy the data folder (backups, and the uploads when they are not in S3) and use the same `.env` (the same `APP_SECRET`, or 2FA and signed links stop working).

## 7. Payments: Stripe and Razorpay webhooks

Choose the gateway and currency in *Admin → Settings → Payments*. Webhooks confirm payments that finish after the buyer closes the tab, renewals, failed charges and refunds; without them orders are only confirmed when the buyer returns to the site.

**Stripe** (Dashboard → Developers → Webhooks → Add endpoint):

- URL: `https://learn.example.com/api/payments/stripe/webhook`
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`, the secret key into `STRIPE_SECRET_KEY`, and restart.

**Razorpay** (Dashboard → Account & Settings → Webhooks → Add new webhook):

- URL: `https://learn.example.com/api/payments/razorpay/webhook`
- Secret: a random string, also set as `RAZORPAY_WEBHOOK_SECRET`
- Events: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, and for memberships `subscription.activated`, `subscription.authenticated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`
- Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from API Keys.

Test with test-mode keys first (Stripe card `4242 4242 4242 4242`), then switch to live keys and make one real low-value purchase and refund it.

## 8. Email (SMTP providers)

Set `MAIL_TRANSPORT=smtp`, then send a test from *Admin → Settings → Email*. Use a sender on a domain whose SPF, DKIM and DMARC records your provider has verified, or mail lands in spam.

| Provider | `SMTP_HOST` | `SMTP_PORT` / `SMTP_SECURE` | `SMTP_USER` / `SMTP_PASS` |
| --- | --- | --- | --- |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` / `false` | SES SMTP credentials (not the IAM keys) |
| Postmark | `smtp.postmarkapp.com` | `587` / `false` | server API token as both user and password |
| SendGrid | `smtp.sendgrid.net` | `587` / `false` | `apikey` / the API key |
| Mailgun | `smtp.mailgun.org` (`smtp.eu.mailgun.org` in the EU) | `587` / `false` | domain SMTP login / password |
| Brevo | `smtp-relay.brevo.com` | `587` / `false` | account login / SMTP key |
| Google Workspace | `smtp.gmail.com` | `465` / `true` | address / app password (low sending limits) |

```ini
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<token>
SMTP_PASS=<token>
MAIL_FROM="Acme Academy <no-reply@acme.example>"
```

Many VPS providers block outgoing port 25; ports 587 and 465 are usually open (some ask you to request it).

## 9. Object storage (AWS S3) and a CDN

By default uploads are stored on the server's disk (`STORAGE_DRIVER=local`, folder `UPLOAD_DIR`), which is right for development. For a live school the chosen storage is an **AWS S3** bucket: videos and their converted versions grow quickly, and a bucket does not fill up the server's disk. Cloudflare R2, Backblaze B2, MinIO and other S3-compatible services also work (set `S3_ENDPOINT`, see the end of this section), but AWS S3 is the documented path.

**How the app uses the bucket.** The browser never talks to the bucket. Uploads go from the browser to the app, which sends them on to S3 (large files in parts). Videos, images and documents are read from S3 by the app and passed on to the viewer; protected lesson videos keep working because the app checks and signs every request. The only signed links to the bucket itself are used by the server: by ffmpeg to read a video while converting it, and by **Test connection**.

### AWS Free Tier: what it covers (checked October 2026)

AWS changed its free tier on **15 July 2025**. Which rules apply depends on when your AWS account was created:

- **Accounts created on or after 15 July 2025** get USD 100 in credits at sign-up and can earn up to USD 100 more by completing activities in the console. At sign-up you choose a plan:
  - **Free plan**: you are never charged, but only some services are available, and the plan ends after **6 months or when the credits are used up, whichever comes first**. The account is then closed: you lose access to the bucket and the files in it. AWS keeps the data for 90 days; upgrading to the Paid plan within those 90 days reopens the account, otherwise AWS deletes the account and everything in it. A live school must therefore **upgrade to the Paid plan before the 6 months end** (Billing and Cost Management → **Upgrade plan**); leftover credits carry over.
  - **Paid plan**: all services; the credits pay the bills first, and anything beyond the credits (or after they expire, 12 months after the account was created) is charged at normal pay-as-you-go prices.
- **Accounts created before 15 July 2025** have the older ("legacy") free tier: 12 months from the day the account was opened, including **5 GB of S3 Standard storage** per month (AWS's older terms also listed 20,000 GET and 2,000 PUT requests per month). After the 12 months you pay normal pay-as-you-go prices. Since every such account is older than 15 July 2025, this 12-month period has already ended for all of them, so these accounts now pay normal S3 prices.
- **For everyone**: the first **100 GB of data transfer out to the internet each month** is free, added up across all AWS services and regions.

Sources: [AWS Free Tier plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [AWS Free Tier FAQs](https://aws.amazon.com/free/free-tier-faqs/), [Legacy Free Tier FAQs](https://aws.amazon.com/free/legacy/free-tier-faqs), [S3 pricing](https://aws.amazon.com/s3/pricing/). AWS changes these terms from time to time: check the pages before you sign up.

### Setting up AWS S3, step by step

**Step 1: create the AWS account.** Go to [aws.amazon.com/free](https://aws.amazon.com/free) → **Create free account**, and choose the **Free plan** or the **Paid plan** (see above). A card is needed either way. Then, signed in as the account owner ("root user"), open the account menu (your name, top right) → **Security credentials** → **Assign MFA device** and add an authenticator app. Use the root user only for billing and account settings.

**Step 2: set a budget alert first ($1 a month).** Before creating anything that can cost money:

1. In the search box at the top of the console, open **Billing and Cost Management** → **Budgets** → **Create budget**.
2. Choose **Use a template (simplified)** → **Monthly cost budget**.
3. Name it `learnloop-monthly`, set the **budgeted amount** to `1` (USD) and enter your email address.
4. **Create budget.** AWS emails you when the month's costs reach the alert thresholds of the template (part of the amount, the full amount, and when the forecast says you will go over).

Also look at **Billing and Cost Management → Free Tier** (and **Credits**) once a month: it shows what you have used, the credits left and, on the Free plan, when the plan ends.

**Step 3: create the bucket.**

1. Open **S3** and pick the region nearest your students in the region menu at the top right, for example **Asia Pacific (Mumbai) ap-south-1** for India. Use the same region as your Supabase project and app server where you can.
2. **Create bucket**: type **General purpose**, a name that is unique across all of AWS, lowercase, with hyphens and without dots, for example `yourschool-learnloop-media`.
3. **Object Ownership**: **ACLs disabled** (the default).
4. **Block Public Access settings for this bucket**: keep **Block all public access** turned **on**. The app reads every file with its own keys, so nothing needs to be public.
5. **Bucket Versioning**: **Disable** (versioning would keep paying for every deleted or replaced video).
6. **Default encryption**: keep the default (SSE-S3).
7. **Create bucket.**

**Step 4: add a lifecycle rule for interrupted uploads.** Large uploads go to S3 in parts. The app cancels a failed upload itself, but parts left behind by a crash or a restart stay in the bucket and are billed until they are removed.

1. Open the bucket → **Management** tab → **Create lifecycle rule**.
2. Name: `abort-incomplete-uploads`. Scope: **Apply to all objects in the bucket** (tick the confirmation).
3. Under **Lifecycle rule actions** tick **Delete expired object delete markers or incomplete multipart uploads**, then **Delete incomplete multipart uploads**, and enter `1` (1 to 3 days is fine) as the number of days.
4. **Create rule.**

**Step 5: create an IAM user that can use only this bucket.**

1. Open **IAM** → **Policies** → **Create policy** → the **JSON** tab, and paste this, with your bucket name in both places:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ListTheBucket",
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::yourschool-learnloop-media"
       },
       {
         "Sid": "ReadWriteFilesInTheBucket",
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject",
           "s3:AbortMultipartUpload"
         ],
         "Resource": "arn:aws:s3:::yourschool-learnloop-media/*"
       }
     ]
   }
   ```

   **Next**, name it `learnloop-media-bucket`, **Create policy**.

   What each permission is for (these are exactly the operations in `src/lib/storage/s3.ts`): `s3:PutObject` uploads files, including the parts of large uploads and finishing them; `s3:GetObject` reads files and their size (playback, downloads, conversions, the signed link in the connection test); `s3:DeleteObject` removes files, one at a time or in batches (deleted lessons, unused renditions, the connection test); `s3:AbortMultipartUpload` cancels a failed large upload; `s3:ListBucket` lists the files of a folder before deleting it (and lets S3 answer "not found" instead of "access denied" for a missing file). The app never lists the parts of an upload, so `s3:ListMultipartUploadParts` is not needed.
2. **IAM** → **Users** → **Create user**, name `learnloop-app`. Do **not** give it access to the AWS console. **Next** → **Attach policies directly** → tick `learnloop-media-bucket` → **Next** → **Create user**.
3. Open the user → **Security credentials** → **Create access key** → choose **Application running outside AWS** → **Create access key**. Copy the **Access key** and the **Secret access key** now: AWS shows the secret only once. Keep them in your password manager, never in git or a chat.

**Step 6: put the values in `.env`** and restart the app (`docker compose up -d`, or `sudo systemctl restart learnloop`):

```ini
STORAGE_DRIVER=s3
S3_REGION=ap-south-1
S3_BUCKET=yourschool-learnloop-media
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=
S3_PUBLIC_BASE_URL=
S3_FORCE_PATH_STYLE=
```

- `S3_ENDPOINT` stays **empty** for AWS: the app then uses `s3.<region>.amazonaws.com`.
- Always set `S3_REGION` to the bucket's region. Empty (or `auto`) means `us-east-1` for AWS, and a bucket in Mumbai then answers with an error that names the right value ("Set S3_REGION=ap-south-1").
- Leave `S3_PUBLIC_BASE_URL` empty with a private bucket (see "A CDN" below).
- In production the server refuses to start when `STORAGE_DRIVER=s3` is set but `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing.

**Step 7: test it.** Sign in as an administrator and open *Admin → Settings → Storage & video* (`/admin/settings/storage`). The **File storage** card should show Provider *Amazon S3*, your bucket and region, the access key (shortened), Secret key *Set* and Public URL *None: every file is served through this server*. Click **Test connection**: it writes a small file, reads it back, fetches it through a signed link and deletes it, and each of the four steps should be green. Typical errors: *AccessDenied* (the bucket name in the policy does not match `S3_BUCKET`), *InvalidAccessKeyId* or *SignatureDoesNotMatch* (a key was copied wrongly), or a message naming the bucket's real region (fix `S3_REGION`).

**Step 8: move files uploaded earlier.** Files that were uploaded before the bucket was set up are listed on the same page under **Files still on this server**. `/api/cron/media` moves them to the bucket over time; **Move to bucket** moves a batch at once.

**CORS is not needed** in this setup, because the browser never loads anything from the bucket directly. You only need CORS rules if you add a CDN (below).

### Costs to watch

- **Storage grows fast with video.** Every lesson video is kept as uploaded, and the conversion adds one copy per quality chosen under *Admin → Settings → Storage & video → Qualities to produce* (only qualities at or below the uploaded resolution are made). A library therefore takes noticeably more space than the files you uploaded. Fewer qualities means less storage. S3 Standard storage is charged per GB per month; see the [S3 pricing page](https://aws.amazon.com/s3/pricing/) for your region.
- **Watching videos is mostly data transfer out of S3.** Protected videos (and, without a CDN, every file) are streamed through the app server: each time a student watches, the video leaves S3 towards your server, and AWS counts that as data transfer out to the internet when the server is not inside AWS. The first 100 GB a month are free, then it is charged per GB. As a rough guide, the HD (720p) version is limited to about 2.8 Mbit/s, so an hour of watching moves at most about 1.3 GB. Your server's provider also counts the same traffic towards the server's bandwidth.
- **Requests** (uploads, reads, deletes) are charged per thousand; for a school they are small next to storage and transfer.
- Keep the $1 budget alert. When it fires, look at **Billing and Cost Management → Bills** to see which item grew, and raise the budget to what you expect to pay.

### A CDN (optional)

`S3_PUBLIC_BASE_URL` (or the CDN base URL in *Admin → Settings → Storage & video*) sends files that are **not** protected (images, documents, and videos when *Admin → Settings → Video → Protect uploaded videos* is off) straight from that address with a redirect, which saves the app server's bandwidth. With a private AWS bucket, this needs **CloudFront**: give CloudFront access to the bucket through Origin Access Control and use the CloudFront domain as `S3_PUBLIC_BASE_URL`. Never point it at the private bucket's own address: the redirected files would fail with "access denied". Then:

- `S3_PUBLIC_BASE_URL` must be `https://`, or browsers block the media.
- Allow `GET` and `HEAD` from your `APP_URL` origin in the CDN's (and bucket's) CORS rules, and expose the `Content-Range`, `Content-Length` and `Accept-Ranges` headers. Unprotected HLS playlists and segments are then fetched from the CDN by the player with `fetch()`, so a missing CORS rule stops those videos from playing.
- CloudFront has its own pricing and free allowance; add it to your budget.

### Other S3-compatible services

Set `S3_ENDPOINT` to the service's address and `S3_REGION` as the service says: for **Cloudflare R2** `S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com` and `S3_REGION=auto`, with an R2 API token with *Object Read & Write* for the bucket (R2 charges no egress fees); for **MinIO** also `S3_FORCE_PATH_STYLE=true`. Add the same lifecycle rule for incomplete multipart uploads where the service supports it.

Put the whole site behind a CDN (for example Cloudflare's proxy) only with `TRUST_PROXY_HOPS` increased by one, and do not cache HTML (`/_next/static/*` and `/images/*` are safe to cache; Next sends long-lived headers for them).

## 10. ffmpeg

ffmpeg converts uploaded lesson videos to adaptive HLS, reads their duration and makes thumbnails. Without it videos are still served as MP4 and `/api/health` reports `degraded`.

- Docker: already in the image.
- Debian/Ubuntu: `sudo apt-get install -y ffmpeg`
- RHEL/Alma/Rocky: enable RPM Fusion, then `sudo dnf install ffmpeg`
- macOS: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg` (or download a build and set `FFMPEG_PATH` / `FFPROBE_PATH` to the `.exe` files)

Check with `ffmpeg -version`. Conversion is CPU-bound; on a 2-vCPU server a one-hour video takes roughly as long as it plays.

## 11. Monitoring: health check and error log

- `GET /api/health` returns `200` with `{"status":"ok"}` (or `"degraded"` when only ffmpeg is missing) and `503` when the database or storage fails. Anyone sees only the status, the app version and whether each check passed; a signed-in administrator also sees the ffmpeg build, per-check timings and the uptime. It never shows configuration values. Docker uses it as the container `HEALTHCHECK`; point an uptime monitor (UptimeRobot, Better Stack, …) at it too.
- *Admin → Error log* groups server errors (failed pages, API routes, server actions) and errors visitors saw in their browser by message and page, with the stack trace, count and last occurrence. Administrators get an in-app notification for each new error; a resolved error reopens if it happens again. Request bodies, query strings and cookies are never stored.
- *Admin → Audit log* records administrative actions, with CSV export. Both logs are purged after the retention period set in *Admin → Settings → Legal pages*.

## 12. Upgrading

1. Make a backup (*Admin → Settings → Backup & restore*, or `docker compose exec app node scripts/db-backup.mjs --note "before upgrade"`; without Docker, `cd /opt/learnloop/app && npm run db:backup -- --note "before upgrade"`, which writes a JSON export into the `backups/` folder of `STORAGE_DIR`). With Supabase on a paid plan its daily backup is a second safety net.
2. Get the new code: `git pull`.
3. Rebuild and restart:
   - Docker: `docker compose up -d --build` (set `APP_VERSION` in `.env` to tag the image; `docker image prune` afterwards frees space). The container applies new database migrations (`prisma migrate deploy`) before the server starts.
   - systemd/pm2: `npm ci`, then `npm run db:setup` (applies new database migrations), then `npm run build`, copy `public/` and `.next/static/` into `.next/standalone/` again, then `sudo systemctl restart learnloop` or `pm2 restart learnloop`. The build replaces `.next/` completely, which is why the files must live outside it (section 3); if `.next/standalone/storage/` exists, move it out first as described there.
4. Check `/api/health` and *Admin → Error log*.
5. Run **Recalculate points** once after upgrading: *Admin → Settings → Points & leaderboard* (`/admin/settings/gamification`) → **Recalculate points from history** → **Recalculate**. It rescores existing lessons, quizzes and certificates with the current rules, so points and leaderboards stay correct when a release changed gamification. It is safe to run again.

**Upgrading from a version that used SQLite or `db.json`:** follow "Moving an existing site from an older version" in [section 15](#15-the-database-supabase-or-your-own-postgresql) before starting the new version.

**Service worker version.** Whenever `public/sw.js` changes, bump its `VERSION` constant (for example `1.0.1` → `1.0.2`) in the same release. Installed apps only pick up a new service worker, and drop old cached pages, when that value changes.

## 13. Search engines: Search Console and the sitemap

Do this once the site is live on its final `https://` address (canonical URLs and the sitemap are built from `APP_URL`) and *Admin → Settings → SEO → Hide the entire site from search engines* is off.

1. **Verify the site.** In [Google Search Console](https://search.google.com/search-console) choose *Add property → URL prefix*, enter `https://learn.example.com` and pick **HTML tag**. Paste the tag (or its `content` value) into *Admin → Settings → SEO → Google Search Console*, save, then click **Verify** in Search Console. Bing Webmaster Tools works the same way (`msvalidate.01` tag).
2. **Submit the sitemap.** In Search Console open **Sitemaps**, enter `https://learn.example.com/sitemap.xml` and click **Submit** (do the same in Bing). Once is enough: the sitemap is rebuilt on every request and splits into `/sitemaps/…` files above 50,000 addresses. `robots.txt` points crawlers to it and keeps them out of admin, account, checkout and API pages.
3. **Check a page** with Search Console's URL inspection tool (home page and one course).
4. **IndexNow** (Bing, Yandex and others) needs no setup: the key is generated on first publish and served at `/indexnow.txt`. After launch you can click **Send all pages** in *Admin → Settings → SEO → Indexing*.

## 14. Pre-launch checklist

- [ ] Legal pages (privacy policy, terms, refund policy, cookie policy) reviewed with a lawyer, edited and published (*Admin → Settings → Legal pages*; the "Template" banner disappears once edited). Cookie banner enabled if you use analytics or marketing pixels.
- [ ] `APP_SECRET` set to a long random value and stored somewhere safe (a password manager), together with the rest of `.env` (including the database password and the S3 keys).
- [ ] `APP_URL` is the final `https://` address; `TRUST_PROXY_HOPS` matches the number of proxies.
- [ ] `DATABASE_URL` and `DIRECT_URL` point at the live database (Supabase in the region near your students, on a plan with backups), and *Admin → Settings → Backup & restore* shows *PostgreSQL*.
- [ ] `SEED_DEMO_DATA=false`, and the demo accounts and demo content removed: start from a fresh database, or in *Admin → Members* search for `learnloop.test` and delete or disable every demo account (`admin`, `maya`, `daniel`, `priya`, `alex`, `sofia`, `liam`, `emma`), whose password `password123` is public.
- [ ] Administrator password changed and two-factor authentication turned on for every administrator.
- [ ] Uploads: `STORAGE_DRIVER=s3` with the AWS bucket (section 9), **Test connection** green in *Admin → Settings → Storage & video*, the lifecycle rule for incomplete uploads added, and the $1 AWS budget alert set up. On the AWS Free plan: a reminder to upgrade to the Paid plan before the 6 months end.
- [ ] Test purchase made with live keys (and refunded); the order, receipt email and enrolment all appeared; Stripe/Razorpay webhooks show successful deliveries.
- [ ] Test email sent from *Admin → Settings → Email* and received (check the spam folder and SPF/DKIM results); password reset tried end to end.
- [ ] Backup restore tested on a copy (section 6), and the nightly off-site copy is running.
- [ ] HTTPS works on the domain (and `www` redirects); `http://` redirects to `https://`.
- [ ] Scheduled jobs running: queued messages in *Admin → Outbox* are delivered within a minute or two.
- [ ] `/api/health` returns `ok` and an uptime monitor watches it; *Admin → Error log* shows no open errors and no configuration warnings.
- [ ] Google Search Console property verified, `https://learn.example.com/sitemap.xml` submitted, and the site checked in the URL inspection tool (section 13).
- [ ] Ran **Recalculate points** once if you upgraded an existing database (section 12).

## 15. The database: Supabase or your own PostgreSQL

PostgreSQL is the app's only database, reached through Prisma. The app loads every record into memory at start-up and writes only what changed, one transaction per save, so it runs as **one** server process (no second replica or serverless instance on the same database). Uploads, video renditions and backups are files, not database rows (data folder or S3, sections 6 and 9).

The schema is generated from the store's collections (`npm run prisma:schema`, see `prisma/schema.prisma`): one table per collection with the record as `jsonb`, its position, and indexed `user_id`/`course_id`/`lesson_id`/`slug`/`email` columns where the record has them. The migrations are in `prisma/migrations`.

### Supabase (recommended)

**1. Create the project.** At [supabase.com](https://supabase.com) click **New project**, choose a name, a **database password** (save it in your password manager) and the region closest to your app server and students (for India **Mumbai / ap-south-1**).

**2. Copy the two connection strings.** Click **Connect** at the top of the project (or *Project Settings → Database → Connection string*) and copy:

- the **transaction pooler** URL (port **6543**) as `DATABASE_URL`, for the app, with `?pgbouncer=true&connection_limit=5` at the end (Prisma needs `pgbouncer=true` behind this pooler);
- the **session pooler** URL (port **5432**) or the direct connection as `DIRECT_URL`, for creating and updating the tables.

```sh
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
DIRECT_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Replace `<password>` with the database password; characters such as `@ # / ? %` must be written as URL codes (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

**3. Create the tables.** With Docker nothing is needed: the container runs `prisma migrate deploy` on every start. Without Docker, from the app folder (`npm ci` also runs `prisma generate`), with both URLs in `.env`:

```sh
npm run db:setup          # prisma migrate deploy: applies prisma/migrations
```

Run it again after every upgrade (section 12). Without the tables the app cannot open the database: pages fail and the log says which tables are missing and to run `npm run db:setup`.

**4. Start the app.** The first start fills an empty database: with your administrator (`ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) when `SEED_DEMO_DATA=false`, or with the demo courses and accounts when it is `true`. *Admin → Settings → Backup & restore* then shows *PostgreSQL*, the server version, the database (without user name and password) and its size; `/api/health` checks the connection on every probe.

**Supabase plans.** The Free plan has a 500 MB database, no automatic backups, and pauses a project after a week without activity; a live school should be on the Pro plan (daily backups kept 7 days, 8 GB database disk included). Check [supabase.com/pricing](https://supabase.com/pricing) for the current terms. Whatever the plan, keep the app's JSON backups and copy them off the server (section 6).

### A local PostgreSQL in Docker (without Supabase)

`docker-compose.yml` has an optional PostgreSQL 16 service for people who do not want a hosted database. It runs on the same server, listens on 127.0.0.1:5432 only, and keeps its data in the `postgres` volume.

1. Add to `.env` (choose a long password):

   ```sh
   POSTGRES_PASSWORD=<a long random password>
   DATABASE_URL=postgresql://learnloop:<the same password>@postgres:5432/learnloop
   DIRECT_URL=postgresql://learnloop:<the same password>@postgres:5432/learnloop
   ```

   Inside Compose the host name is `postgres`. For `npm run db:*` commands run on the server itself (outside the containers), use `localhost:5432` instead.
2. Start it together with the app: `docker compose --profile postgres up -d --build` (add `--profile cron` for the scheduler). The app creates the tables on start.
3. Back it up yourself: the app's daily JSON exports (section 6) plus, if you like, `docker compose exec postgres pg_dump -U learnloop learnloop > learnloop.sql`. Copy both off the server. Never run `docker compose down -v`: it deletes the `postgres` volume with the database.

Any other PostgreSQL 13 or newer works too: set `DATABASE_URL` and `DIRECT_URL` to the same `postgresql://user:password@host:5432/database` URL when there is no pooler.

### Moving an existing site from an older version

Older versions kept the records in a SQLite file (`storage/lms.sqlite`) or a JSON file (`storage/db.json`). They are no longer read by the app; copy them into PostgreSQL once, with the old app stopped:

```sh
npm run db:setup                               # create the tables first
npm run db:to-postgres -- --dry-run            # check the source and the target, write nothing
npm run db:to-postgres                         # storage/lms.sqlite, else storage/db.json, else the newest storage/db.json.migrated-*
npm run db:to-postgres -- path/to/old.sqlite   # or any other old .sqlite file, .sqlite backup or JSON export
```

The copy runs in one transaction, compares the number of records per collection before it commits, and refuses a database that already holds data unless you add `--force`. The old file is only read, never changed or deleted. Then remove `DB_DRIVER`, `SQLITE_PATH` and `DATA_FILE` from `.env` (the server warns that they are no longer used), set `STORAGE_DIR` if your files were in another folder, and start the new version.

**Notes.** The app logs a warning when `DATABASE_URL` uses port 6543 without `pgbouncer=true`, or when `DIRECT_URL` is missing. PostgreSQL cannot store the NUL character (`\u0000`) in text, so it is saved as `U+FFFD`, and `jsonb` does not keep the order of keys inside a record (the app never relies on it). `npm test` needs no database (it uses an in-memory test store); the PostgreSQL integration tests run against a throwaway server: `TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm run test:pg` (each run uses temporary `test_*` schemas and drops them; never point it at a real site's database).

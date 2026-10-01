# Deploying LearnLoop

LearnLoop is a single Next.js server with an embedded SQLite database. Everything it stores (database, uploads, video renditions, backups) lives in one folder, `storage/`. A small VPS (2 vCPU, 4 GB RAM, 40 GB disk) runs a school with thousands of learners; video conversion is the only CPU-heavy job.

Contents:

1. [Requirements](#1-requirements)
2. [VPS with Docker and Caddy (recommended)](#2-vps-with-docker-and-caddy-recommended)
3. [Without Docker: Linux with systemd or pm2, Windows](#3-without-docker)
4. [Environment variables](#4-environment-variables)
5. [Scheduled jobs (cron)](#5-scheduled-jobs-cron)
6. [Backups and restores (with an off-site copy)](#6-backups-and-restores)
7. [Payments: Stripe and Razorpay webhooks](#7-payments-stripe-and-razorpay-webhooks)
8. [Email (SMTP providers)](#8-email-smtp-providers)
9. [Object storage (S3 / Cloudflare R2) and a CDN](#9-object-storage-s3--r2-and-a-cdn)
10. [ffmpeg](#10-ffmpeg)
11. [Monitoring: health check and error log](#11-monitoring-health-check-and-error-log)
12. [Upgrading](#12-upgrading)
13. [Pre-launch checklist](#13-pre-launch-checklist)

---

## 1. Requirements

- A domain (or sub-domain such as `learn.example.com`) whose DNS `A`/`AAAA` record points at the server.
- Ports 80 and 443 open to the internet (Caddy needs both to obtain and renew certificates).
- **Docker route:** Docker Engine 24+ with the Compose plugin (v2.23+ for the optional cron service).
- **Without Docker:** Node.js 24 (the database uses the built-in `node:sqlite` module), ffmpeg, and a reverse proxy for HTTPS (Caddy or nginx).

## 2. VPS with Docker and Caddy (recommended)

The repository contains a multi-stage `Dockerfile` (Node 24 slim, ffmpeg, non-root user, health check), `docker-compose.yml` (the app plus Caddy with automatic HTTPS) and a `Caddyfile`.

1. **Install Docker** (Ubuntu/Debian):

   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"   # log out and back in
   ```

2. **Get the code** onto the server:

   ```sh
   git clone <your repository URL> learnloop && cd learnloop
   ```

3. **Create `.env`** from the example and fill in at least these values:

   ```sh
   cp .env.example .env
   openssl rand -hex 32        # paste the output as APP_SECRET
   ```

   ```ini
   APP_URL=https://learn.example.com
   APP_SECRET=<64 hex characters>
   DOMAIN=learn.example.com          # used by Caddy
   ACME_EMAIL=you@example.com        # certificate expiry notices
   SEED_DEMO_DATA=false
   ADMIN_NAME=Your Name
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<a long password, change it after the first sign-in>
   MAIL_TRANSPORT=smtp
   SMTP_HOST=...                     # see section 8
   ```

   `docker-compose.yml` sets `NODE_ENV=production`, `TRUST_PROXY_HOPS=1` and the storage paths for you.

4. **Start it:**

   ```sh
   docker compose up -d --build
   docker compose logs -f app       # wait for "Ready"
   ```

   Caddy requests a certificate the first time someone opens `https://learn.example.com` (usually within seconds). If the app refuses to start, the log lists the missing settings (see [section 4](#4-environment-variables)).

5. **Sign in** with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, change the password, turn on two-factor authentication, then work through the [pre-launch checklist](#13-pre-launch-checklist).

6. **Turn on the scheduler**: copy the cron key from *Admin → Settings → Email*, add `CRON_KEY=<key>` to `.env`, then:

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
| Manual backup | `docker compose exec app node scripts/db-backup.mjs` |

All data is in the `learnloop_storage` volume (`docker volume inspect learnloop_storage` shows where it is on disk). Never run `docker compose down -v`: `-v` deletes the volumes, including the database.

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
sudo -u learnloop git clone <your repository URL> /opt/learnloop/app
cd /opt/learnloop/app
sudo -u learnloop cp .env.example .env   # fill it in (section 4), with TRUST_PROXY_HOPS=1
sudo -u learnloop npm ci
sudo -u learnloop npm run build
# The standalone server needs the static files next to it:
sudo -u learnloop cp -r public .next/standalone/ && sudo -u learnloop cp -r .next/static .next/standalone/.next/
```

`/etc/systemd/system/learnloop.service`:

```ini
[Unit]
Description=LearnLoop
After=network-online.target
Wants=network-online.target

[Service]
User=learnloop
WorkingDirectory=/opt/learnloop/app
EnvironmentFile=/opt/learnloop/app/.env
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
# Data paths are relative to WorkingDirectory, so storage/ stays in the project folder.
ExecStart=/usr/bin/node .next/standalone/server.js
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
npm ci && npm run build
# copy public/ and .next/static/ next to the standalone server as shown above
pm2 start .next/standalone/server.js --name learnloop --cwd "$(pwd)" --time
pm2 save
pm2 startup        # Linux: prints the command that starts pm2 at boot
```

pm2 does not read `.env` by itself for the standalone server: export the variables in the shell first, or use an `ecosystem.config.cjs` with an `env` block (`NODE_ENV: "production"`, `APP_URL`, `APP_SECRET`, …). On Windows, start pm2 at boot with `pm2-installer` or the Task Scheduler (`pm2 resurrect` at log-on), install ffmpeg with `winget install Gyan.FFmpeg`, and put Caddy for Windows (`caddy run` as a service via `sc.exe` or NSSM) in front for HTTPS. Use Windows paths in `.env` only if the default `storage\` folder inside the project is not where you want the data.

## 4. Environment variables

The server checks its configuration at start-up (`src/lib/env-check.ts`). In production it **refuses to start** when `APP_SECRET` is missing or shorter than 32 characters, when `APP_URL` is not `https://` (except on localhost), or when a half-configured integration would fail (SMTP without a host, Razorpay without its secret, S3 without its keys). Warnings are printed to the log and shown at the top of *Admin → Error log*. The checks never run during `next build`, so build machines do not need secrets.

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
| `STORAGE_DRIVER`, `S3_*` | no | Object storage, see [section 9](#9-object-storage-s3--r2-and-a-cdn). |
| `DB_DRIVER` | no | `sqlite` (default). `json` is for development only. |
| `SQLITE_PATH`, `DATA_FILE`, `UPLOAD_DIR` | no | Defaults `storage/lms.sqlite`, `storage/db.json` (one-time import source), `storage/uploads`. |
| `MAX_VIDEO_UPLOAD_MB`, `MAX_FILE_UPLOAD_MB` | no | Upload limits in MB (defaults 10240, i.e. 10 GB, and 25). Video uploads are chunked and resumable, so files over 5 GB work; a reverse proxy only needs to accept one chunk per request. |
| `SESSION_DAYS`, `SESSION_COOKIE_NAME`, `COOKIE_SECURE` | no | Sign-in session length (30), cookie name, HTTPS-only cookie (on by default in production). |
| `FFMPEG_PATH`, `FFPROBE_PATH` | no | When ffmpeg is not on the `PATH`. |
| `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | no | Automatic captions through a Whisper-compatible API. |
| `ANTHROPIC_API_KEY` | no | AI tutor and AI features (can also be set in *Admin → Settings → AI tutor*). |
| `SEO_CANONICAL_HOST` | no | `www` (default: redirect the www twin of `APP_URL`), `all` (redirect every other host name; only when the proxy forwards the visitor's Host header), `off`. |
| `QUIZ_ATTEMPT_SECRET` | no | Separate signing key for quiz attempts (generated otherwise). |
| `TZ` | no | Server time zone, used for dates printed on certificates (e.g. `Asia/Kolkata`). |
| `APP_VERSION` | no | Shown by `/api/health` (the Docker build passes it through). |
| `DOMAIN`, `ACME_EMAIL`, `CRON_KEY` | Docker only | Read by `docker-compose.yml` for Caddy and the cron service, not by the app. |

`LL_DEV_LOGIN` is ignored in production; remove it.

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

On Windows use the Task Scheduler with `curl.exe` and the same URLs. Changing `APP_SECRET` changes the key.

## 6. Backups and restores

The app makes an automatic backup on the first request of each day and keeps the newest 14 (*Admin → Settings → Backup & restore* lists them, makes manual backups and downloads them). Backups are SQLite snapshots in `storage/backups/`, taken safely while the app runs.

The `storage/` folder must be writable by the app and persisted together with the database: besides the database and uploads it holds `storage/seo/` (the IndexNow key and generated SEO files) and `storage/backups/`.

**Uploads are not inside the database backup.** Back up the whole `storage/` folder (or the `learnloop_storage` volume), or use object storage (section 9) for uploads.

### Nightly backup with an off-site copy

A backup on the same disk does not survive a lost server. Copy it elsewhere every night, for example with [rclone](https://rclone.org) to S3, R2, Backblaze B2 or Google Drive:

```sh
# /etc/cron.d/learnloop-backup  (Docker)
30 2 * * * root cd /home/deploy/learnloop && docker compose exec -T app node scripts/db-backup.mjs --auto >/dev/null \
  && docker run --rm -v learnloop_storage:/data:ro -v /root/.config/rclone:/config/rclone rclone/rclone \
     sync /data remote:learnloop-backups/storage --exclude "hls/**"
```

Without Docker: `cd /opt/learnloop/app && node scripts/db-backup.mjs --auto && rclone sync storage remote:learnloop-backups/storage`. Keep at least 30 days of copies (enable bucket versioning or lifecycle rules) and encrypt them (`rclone crypt`): they contain personal data.

### Restoring

Test a restore before launch and then a few times a year:

```sh
docker compose exec app node scripts/db-backup.mjs --list          # what is there
docker compose stop app
docker compose run --rm --no-deps app node scripts/db-restore.mjs latest --dry-run
docker compose run --rm --no-deps app node scripts/db-restore.mjs <backup name or path> --yes
docker compose start app
```

A restore first saves the current data as a "safety" backup, so it can itself be undone. Without Docker the same commands are `npm run db:backup -- --list` and `npm run db:restore -- <backup>`. To move to a new server, copy the whole `storage/` folder (with the app stopped) and the same `.env` (the same `APP_SECRET`, or 2FA and signed links stop working).

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

## 9. Object storage (S3 / R2) and a CDN

By default uploads are stored on the server's disk. For large video libraries use S3-compatible storage; protected lesson videos keep working because the app signs every request.

```ini
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com   # empty for AWS S3
S3_REGION=auto                                               # e.g. eu-central-1 for AWS
S3_BUCKET=learnloop-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://media.example.com                 # optional CDN / public bucket domain
S3_FORCE_PATH_STYLE=false                                    # true for MinIO
```

- **Cloudflare R2**: create a bucket and an API token with *Object Read & Write*, then connect a custom domain to the bucket for `S3_PUBLIC_BASE_URL` (Cloudflare caches it). No egress fees, which matters for video.
- **AWS S3 + CloudFront**: keep the bucket private, give CloudFront access through Origin Access Control, and use the CloudFront domain as `S3_PUBLIC_BASE_URL`.
- Allow `GET` and `HEAD` from your `APP_URL` origin in the bucket's (and the CDN's) CORS rules, and expose the `Content-Range`, `Content-Length` and `Accept-Ranges` headers. Video players request byte ranges, and when `S3_PUBLIC_BASE_URL` is set, unprotected HLS playlists and segments are redirected there and fetched by the player's streaming engine with `fetch()`, so a missing CORS rule stops those videos from playing.
- Add a bucket lifecycle rule that **aborts incomplete multipart uploads after 1 day**. Large uploads are sent to the bucket in parts; a part upload interrupted by a crash or a cancelled upload otherwise keeps (billed) storage forever.
- `S3_PUBLIC_BASE_URL` must be `https://` or browsers block the media.
- Existing local files are moved to the bucket by `/api/cron/media` in the background.

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

- `GET /api/health` returns `200` with `{"status":"ok"}` (or `"degraded"` when only ffmpeg is missing) and `503` when the database or storage fails. It shows the version, uptime and per-check timings, never configuration values. Docker uses it as the container `HEALTHCHECK`; point an uptime monitor (UptimeRobot, Better Stack, …) at it too.
- *Admin → Error log* groups server errors (failed pages, API routes, server actions) and errors visitors saw in their browser by message and page, with the stack trace, count and last occurrence. Administrators get an in-app notification for each new error; a resolved error reopens if it happens again. Request bodies, query strings and cookies are never stored.
- *Admin → Audit log* records administrative actions, with CSV export. Both logs are purged after the retention period set in *Admin → Settings → Legal pages*.

## 12. Upgrading

1. Make a backup (*Admin → Settings → Backup & restore*, or `docker compose exec app node scripts/db-backup.mjs --note "before upgrade"`).
2. Get the new code: `git pull`.
3. Rebuild and restart:
   - Docker: `docker compose up -d --build` (set `APP_VERSION` in `.env` to tag the image; `docker image prune` afterwards frees space).
   - systemd/pm2: `npm ci && npm run build`, copy `public/` and `.next/static/` into `.next/standalone/` again, then `sudo systemctl restart learnloop` or `pm2 restart learnloop`.
4. Database changes are applied automatically when the server starts. Check `/api/health` and *Admin → Error log*.
5. After upgrading to a release that changes gamification, open *Admin → Settings → Points & leaderboard* and click **Recalculate points** once so existing activity is scored with the new rules.

For developers: whenever `public/sw.js` changes, bump its `VERSION` constant. Installed apps only pick up a new service worker (and drop old cached pages) when that value changes.

## 13. Pre-launch checklist

- [ ] Legal pages (privacy policy, terms, refund policy, cookie policy) reviewed with a lawyer, edited and published (*Admin → Settings → Legal pages*; the "Template" banner disappears once edited). Cookie banner enabled if you use analytics or marketing pixels.
- [ ] `APP_SECRET` set to a long random value and stored somewhere safe (a password manager), together with the rest of `.env`.
- [ ] `APP_URL` is the final `https://` address; `TRUST_PROXY_HOPS` matches the number of proxies.
- [ ] `SEED_DEMO_DATA=false`, and any demo accounts and demo courses removed (*Admin → Members*: search for `example.com` addresses).
- [ ] Administrator password changed and two-factor authentication turned on for every administrator.
- [ ] Test purchase made with live keys (and refunded); the order, receipt email and enrolment all appeared; Stripe/Razorpay webhooks show successful deliveries.
- [ ] Test email sent from *Admin → Settings → Email* and received (check the spam folder and SPF/DKIM results); password reset tried end to end.
- [ ] Backup restore tested on a copy (section 6), and the nightly off-site copy is running.
- [ ] HTTPS works on the domain (and `www` redirects); `http://` redirects to `https://`.
- [ ] Scheduled jobs running: queued messages in *Admin → Outbox* are delivered within a minute or two.
- [ ] `/api/health` returns `ok` and an uptime monitor watches it; *Admin → Error log* shows no open errors and no configuration warnings.
- [ ] Google Search Console property verified, `https://learn.example.com/sitemap.xml` submitted, and the site checked in the URL inspection tool.

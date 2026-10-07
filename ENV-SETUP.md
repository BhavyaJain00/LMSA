# Setting up the `.env` file

This guide explains every key in `.env`: what it does, whether you need it, where to get the value, and an example.

## Before you start

- `.env` lives in the project folder (`lms/.env`). It holds passwords and API keys, so never commit it, share it, or paste it into a chat. Git already ignores it.
- One setting per line, written as `KEY=value`, with no spaces around `=`. If a value contains spaces, put quotes around it: `MAIL_FROM="LearnLoop <no-reply@example.com>"`.
- An empty value (`KEY=`) means "not set". The app then uses its default or turns that feature off.
- **After changing `.env`, restart the app** (stop `npm run dev` with Ctrl+C and start it again). Settings are only read at start-up.
- `.env.example` is the template, with a short comment for every key.

## What you need, and when

| Goal | Keys to fill in |
|---|---|
| Try it on your own computer | Nothing. The defaults work. |
| Go live on a real server | `APP_URL`, `APP_SECRET`, `SEED_DEMO_DATA=false`, `ADMIN_*`, `COOKIE_SECURE` |
| Use Supabase / PostgreSQL | `DB_DRIVER`, `DATABASE_URL`, `DIRECT_URL` |
| Send real emails | `MAIL_TRANSPORT=smtp`, `SMTP_*`, `MAIL_FROM` |
| Take payments | `STRIPE_*` and/or `RAZORPAY_*` |
| Store videos in the cloud | `STORAGE_DRIVER=s3`, `S3_*` |
| Convert videos to 1080p/720p/480p | Install ffmpeg; `FFMPEG_PATH`/`FFPROBE_PATH` only if needed |
| Automatic captions | `TRANSCRIBE_*` |
| AI tutor | `ANTHROPIC_API_KEY` |

---

## 1. Site basics

### `APP_URL`
The public address of your site, **without** a slash at the end. It's used in email links, payment returns, calendar feeds, the sitemap and share links.
- On your computer: `APP_URL=http://localhost:3000`
- Live: `APP_URL=https://learn.yourdomain.com` (it must be `https` when live)

### `APP_SECRET`
A long random password the app uses to sign protected video links, unsubscribe and calendar links, and the cron key, and to encrypt two-factor secrets. It must be **at least 32 characters**.

How to make one:
- **Git Bash, Mac or Linux:** `openssl rand -hex 32`
- **Windows PowerShell:** `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`
- **Any computer with Node:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Copy the output into `APP_SECRET=`. **Set it once and never change it on a live site.** Changing it breaks video links, unsubscribe links and calendar feeds, and everyone has to set up two-factor sign-in again.

### `SEED_DEMO_DATA`
- `true` fills a **new, empty** database with demo courses and demo accounts (password `password123`).
- `false` starts empty, with only your admin account.

**Use `false` on a live site.** It only matters the first time a database is created.

### `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
The first administrator account, created only when the database is new and `SEED_DEMO_DATA=false`.
```
ADMIN_NAME=Your Name
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=a-strong-password
```
Sign in with these, then change the password under **Settings → Security**. After that you can delete `ADMIN_PASSWORD` from `.env`.

---

## 2. Sign-in sessions

| Key | What it does | Recommended |
|---|---|---|
| `SESSION_DAYS` | How many days someone stays signed in | `30` |
| `SESSION_COOKIE_NAME` | Name of the sign-in cookie | `ll_session` (leave it) |
| `COOKIE_SECURE` | Send the sign-in cookie over HTTPS only | empty (the app decides); `true` when live on https; `false` only for local testing over http |
| `LL_DEV_LOGIN` | Development-only shortcut login for automated tests | `0` or empty. Never turn it on live. |

---

## 3. Database

### Option A: SQLite (default, nothing to set up)
```
DB_DRIVER=sqlite
SQLITE_PATH=storage/lms.sqlite
```
The whole database is one file. Backups are made daily into `storage/backups/`.

`DATA_FILE=storage/db.json` is the old JSON data file. It's only used once, to import old data, so leave it as it is.

### Option B: Supabase (PostgreSQL)

**Step 1: create the project**
1. Go to **https://supabase.com** and sign up.
2. Click **New project**. Choose a name, a **database password** (save it somewhere safe) and the region closest to your students (for India, choose **Mumbai / ap-south-1**).
3. Wait about 2 minutes while the project starts.

**Step 2: copy the two connection strings**
1. In your project, click **Connect** at the top of the page.
2. Open the **ORMs** tab and choose **Prisma**. Supabase shows `DATABASE_URL` and `DIRECT_URL` ready to copy. (They are also under **Project Settings → Database → Connection string**.)
3. Paste both into `.env`. Replace `[YOUR-PASSWORD]` with the database password from step 1.

```
DATABASE_URL=postgresql://postgres.abcdefghijklmnop:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
DIRECT_URL=postgresql://postgres.abcdefghijklmnop:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```
- `DATABASE_URL` uses port **6543** and must end with `?pgbouncer=true&connection_limit=5`.
- `DIRECT_URL` uses port **5432**.
- If your password contains special characters (`@ # / ? %`), either replace them with their URL codes (`@` → `%40`, `#` → `%23`, `/` → `%2F`) or choose a password made of letters and numbers only.

**Step 3: create the tables and move your data** (in the `lms` folder)
```
npm run prisma:migrate     # creates the tables in Supabase
npm run db:to-postgres     # copies your current data from SQLite into Supabase
```
The copy refuses to run if Supabase already has data, and it never deletes the SQLite file.

**Step 4: switch**
```
DB_DRIVER=postgres
```
Restart the app. To go back, set `DB_DRIVER=sqlite` again.

---

## 4. Uploaded files and limits

| Key | What it does | Default |
|---|---|---|
| `UPLOAD_DIR` | Folder for uploads when stored locally | `storage/uploads` |
| `MAX_VIDEO_UPLOAD_MB` | Largest video upload, in MB | `10240` (10 GB) |
| `MAX_FILE_UPLOAD_MB` | Largest other file (PDF, image), in MB | `25` |

### Cloud storage for videos (optional)
Keep `STORAGE_DRIVER=local` to store files on the server. To use a bucket instead, set `STORAGE_DRIVER=s3` and fill these in:

| Key | Cloudflare R2 (recommended: no download fees) | AWS S3 |
|---|---|---|
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | leave empty |
| `S3_REGION` | `auto` | e.g. `ap-south-1` |
| `S3_BUCKET` | your bucket name | your bucket name |
| `S3_ACCESS_KEY_ID` | from the R2 API token | from the IAM user |
| `S3_SECRET_ACCESS_KEY` | from the R2 API token | from the IAM user |
| `S3_PUBLIC_BASE_URL` | optional public/CDN address for non-protected files | optional |
| `S3_FORCE_PATH_STYLE` | leave empty | leave empty (`true` for MinIO) |

**Cloudflare R2 steps**
1. Go to Cloudflare dashboard → **R2** → **Create bucket** (for example `learnloop-media`).
2. Go to **R2 → Manage R2 API Tokens → Create API token**, with permission **Object Read & Write** for that bucket.
3. Copy the **Access Key ID**, the **Secret Access Key** and the **endpoint** shown (`https://<account-id>.r2.cloudflarestorage.com`).

**AWS S3 steps**
1. In the S3 console, create a bucket (block public access: on).
2. In IAM, create a user with a policy allowing `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on that bucket.
3. Under that user's **Security credentials**, create an **access key**.

Check the result in **Admin → Settings → Storage & video**, using **Test connection**.

---

## 5. Video conversion (ffmpeg)

The app converts each uploaded video to 1080p, 720p and 480p with **ffmpeg**. Without it, videos still play as the original MP4.

- **Windows:** in PowerShell, run `winget install Gyan.FFmpeg`, then open a new terminal and check with `ffmpeg -version`.
- **Ubuntu/Debian server:** `sudo apt install ffmpeg`
- **Docker:** already included.

Set `FFMPEG_PATH` and `FFPROBE_PATH` only if ffmpeg isn't found automatically, for example:
```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```
**Admin → Settings → Storage & video** shows whether ffmpeg was found.

---

## 6. Automatic captions (optional)

Captions are made by a Whisper-compatible speech-to-text service, such as OpenAI.
1. Create an API key at **https://platform.openai.com/api-keys** (billing must be set up on that account).
2. Fill in:
```
TRANSCRIBE_API_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIBE_API_KEY=sk-...
TRANSCRIBE_MODEL=whisper-1
```
3. Turn on **Generate captions automatically** in **Admin → Settings → Storage & video**. This also needs ffmpeg.

---

## 7. AI tutor (optional)

1. Create a key at **https://console.anthropic.com** → **API Keys** (billing must be set up on that account).
2. Fill in `ANTHROPIC_API_KEY=sk-ant-...`
3. Turn the tutor on in **Admin → Settings → AI tutor**, then on each course in its **Settings** tab.

---

## 8. Email

While testing, keep `MAIL_TRANSPORT=log`: emails are saved in **Admin → Emails** but not sent. To really send them:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM="Your School <no-reply@yourdomain.com>"
```

| Provider | `SMTP_HOST` | `SMTP_USER` / `SMTP_PASS` |
|---|---|---|
| Brevo (free tier) | `smtp-relay.brevo.com` | your Brevo login / an SMTP key from **SMTP & API** |
| SendGrid | `smtp.sendgrid.net` | `apikey` / your API key |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | SES SMTP credentials (not your IAM keys) |
| Postmark | `smtp.postmarkapp.com` | your server API token as both |
| Gmail (small tests only) | `smtp.gmail.com` | your Gmail address / an **App password** (Google Account → Security → 2-Step Verification → App passwords) |

- Use port `587` with `SMTP_SECURE=false`. If your provider says port 465, use `465` with `SMTP_SECURE=true`.
- `MAIL_FROM` must use a domain you have verified with your provider (SPF and DKIM records), or emails land in spam.
- Test it in **Admin → Settings → Email** with **Send test**.

---

## 9. Payments

Pick the gateway and currency in **Admin → Settings → Payments**. **Start with test keys**, and switch to live keys only after a test purchase works.

### Stripe
1. Go to **https://dashboard.stripe.com** → **Developers → API keys**. Copy the **Secret key** (`sk_test_...` while testing).
2. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://learn.yourdomain.com/api/payments/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
3. Open the endpoint and copy its **Signing secret** (`whsec_...`).
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
Test card: `4242 4242 4242 4242`, any future date, any CVC.

### Razorpay (India)
1. Go to **https://dashboard.razorpay.com** → **Account & Settings → API Keys → Generate key**. Copy the **Key ID** and **Key Secret** (use Test mode first).
2. Go to **Account & Settings → Webhooks → Add new webhook**:
   - URL: `https://learn.yourdomain.com/api/payments/razorpay/webhook`
   - Secret: make up a long random string (you can generate it like `APP_SECRET`).
   - Events: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, and for memberships `subscription.activated`, `subscription.authenticated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`
```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=the-secret-you-chose
```

Webhooks need a public `https` address, so they don't reach `localhost`. Purchases on your computer are still confirmed when the buyer returns to the site.

---

## 10. Optional extras (not in your `.env` yet; add them if needed)

| Key | When you need it |
|---|---|
| `TRUST_PROXY_HOPS` | `1` when the app runs behind Caddy or nginx (as in the Docker setup); `0` otherwise |
| `TZ` | Time zone for dates on certificates, e.g. `Asia/Kolkata` |
| `SMTP_REQUIRE_TLS` | Leave unset (`true`). Set `false` only for a trusted internal mail relay without encryption |
| `DB_AUTO_BACKUP` / `DB_BACKUP_KEEP` | Daily SQLite backup on/off, and how many to keep (default `true` / `14`) |
| `UPLOAD_MIN_FREE_MB` / `UPLOAD_LEARNER_DAILY_MB` | Disk-space guard and daily upload limit per learner |
| `IMAGE_HOSTS` | Extra image domains allowed for course covers, e.g. `cdn.example.com` |
| `SEO_CANONICAL_HOST` | Host redirects: empty (default), `all` or `off` |
| `QUIZ_ATTEMPT_SECRET` | Separate key for quiz tokens (generated automatically if empty) |
| `DOMAIN`, `ACME_EMAIL`, `CRON_KEY`, `POSTGRES_PASSWORD` | Docker Compose only: your domain, an email for HTTPS certificates, the cron key (from **Admin → Settings → Email**), and the optional local PostgreSQL password |
| `TEST_DATABASE_URL` | Developers only: a throwaway PostgreSQL for `npm run test:pg` |

---

## 11. Checklist before going live

- [ ] `APP_URL` is your real `https://` address.
- [ ] `APP_SECRET` is 32+ random characters, and backed up somewhere safe.
- [ ] `SEED_DEMO_DATA=false`, and the demo accounts are deleted.
- [ ] `LL_DEV_LOGIN` is empty or `0`.
- [ ] `MAIL_TRANSPORT=smtp`, and a test email arrived.
- [ ] Payment keys are **live** keys, and one real purchase and refund worked.
- [ ] The database is backed up: SQLite backups are copied off the server, or Supabase backups are on.
- [ ] `.env` is not in git and not shared.

For the full server setup (Docker, HTTPS, scheduled jobs), see [DEPLOYMENT.md](DEPLOYMENT.md).

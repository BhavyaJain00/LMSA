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
| Try it on your own computer | `DATABASE_URL`, `DIRECT_URL` (a free Supabase project, section 3). Everything else has working defaults. |
| Go live on a real server | `APP_URL`, `APP_SECRET`, `SEED_DEMO_DATA=false`, `ADMIN_*`, `COOKIE_SECURE` |
| Connect the database (required) | `DATABASE_URL`, `DIRECT_URL` |
| Send real emails | `MAIL_TRANSPORT=smtp`, `SMTP_*`, `MAIL_FROM` |
| Take payments | `STRIPE_*` and/or `RAZORPAY_*` |
| Store uploads and videos in AWS S3 (recommended when live) | `STORAGE_DRIVER=s3`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
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

**This section is required.** The app keeps all its records (users, courses, progress, payments, settings) in **PostgreSQL**: a Supabase project, or any PostgreSQL 13 or newer. There is no other database. Without `DATABASE_URL` the app does not start, on your computer or on a server, and the error message points here.

### Supabase (PostgreSQL)

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

**Step 3: create the tables** (in the `lms` folder)
```
npm run db:setup           # creates or updates the tables (prisma migrate deploy)
```
Run it again after every upgrade. The Docker image does this by itself on every start. `DIRECT_URL` must be set for this step.

**Step 4: start the app** (`npm run dev` on your computer). The first start fills the empty database with the demo content (`SEED_DEMO_DATA=true`) or just your admin account (`SEED_DEMO_DATA=false`).

**Step 5 (only when moving an older site): copy your old data**
Older versions kept the data in `storage/lms.sqlite` (or `storage/db.json`). Copy it into the new, empty database once:
```
npm run db:setup                             # the tables must exist first
npm run db:to-postgres -- --dry-run          # check first, write nothing
npm run db:to-postgres                       # reads storage/lms.sqlite, else storage/db.json
npm run db:to-postgres -- path/to/file       # or any old .sqlite file or JSON export
```
The copy refuses to run if the database already has data (add `--force` to replace it), checks the record counts, and never changes or deletes the old file. Then start the app. Remove `DB_DRIVER`, `SQLITE_PATH` and `DATA_FILE` from `.env`: they are no longer used.

**Backups.** The app writes a daily JSON export of the whole database into `storage/backups/` (inside `STORAGE_DIR`), which you can download and restore under **Admin → Settings → Backup & restore** or with `npm run db:backup` / `npm run db:restore`. Supabase's own daily backups (**Database → Backups**, kept 7 days; point-in-time recovery is a paid add-on) come with the **Pro** plan; the Free plan has none and also pauses a project after a week without activity, so a live school should use Pro. Either way, copy the app's backups off the server (DEPLOYMENT.md, section 6).

### Without Supabase
Any PostgreSQL 13 or newer works: set `DATABASE_URL` and `DIRECT_URL` to the same `postgresql://user:password@host:5432/database` URL. With Docker, the optional local database starts on the same server:
```
POSTGRES_PASSWORD=a-long-random-password
DATABASE_URL=postgresql://learnloop:a-long-random-password@postgres:5432/learnloop
DIRECT_URL=postgresql://learnloop:a-long-random-password@postgres:5432/learnloop
```
then `docker compose --profile postgres up -d --build`. For `npm run db:*` commands typed on the server itself, use `localhost:5432` instead of `postgres:5432`. You then look after this database's backups yourself (DEPLOYMENT.md, section 15).

---

## 4. Uploaded files and limits

| Key | What it does | Default |
|---|---|---|
| `STORAGE_DRIVER` | Where uploads are kept: `local` (the server's disk) or `s3` (an AWS S3 bucket, below) | `local` |
| `UPLOAD_DIR` | Folder for uploads when stored locally (an absolute path on a server without Docker, see DEPLOYMENT.md section 3) | `storage/uploads` |
| `MAX_VIDEO_UPLOAD_MB` | Largest video upload, in MB | `10240` (10 GB) |
| `MAX_FILE_UPLOAD_MB` | Largest other file (PDF, image), in MB | `25` |

### Storing uploads in AWS S3 (recommended for a live site)
On your computer, keep `STORAGE_DRIVER=local`: files go into `UPLOAD_DIR`. For the live site, store them in an **AWS S3** bucket, so videos do not fill up the server's disk. The browser never talks to the bucket: the app uploads the files to S3 and streams them back to students itself.

**What AWS gives you for free (checked October 2026; AWS changes this from time to time, so check before you sign up)**
- **Accounts created on or after 15 July 2025:** USD 100 in credits at sign-up, plus up to USD 100 more for completing activities in the console. You choose a plan when you sign up:
  - **Free plan:** you are never charged, but the plan ends after **6 months or when the credits run out**, whichever comes first. The account is then closed and you lose access to your files. AWS keeps them for 90 days; upgrading to the Paid plan in that time reopens the account, otherwise everything is deleted. **For a live school, upgrade to the Paid plan before the 6 months end** (Billing and Cost Management → **Upgrade plan**); leftover credits carry over.
  - **Paid plan:** the credits pay your bills first; after that (or once the credits expire, 12 months after you opened the account) you pay normal prices.
- **Accounts created before 15 July 2025:** the older free tier gave 12 months from the day the account was opened, including **5 GB of S3 Standard storage** a month. That period has now ended for every such account, so they pay normal S3 prices.
- **Everyone:** the first **100 GB a month of data sent out of AWS to the internet** is free.

Sources: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html, https://aws.amazon.com/free/free-tier-faqs/, https://aws.amazon.com/free/legacy/free-tier-faqs, https://aws.amazon.com/s3/pricing/

**Step 1: create the AWS account**
1. Go to **https://aws.amazon.com/free** → **Create free account**, and choose the Free plan or the Paid plan (see above).
2. Turn on two-step sign-in: account menu (top right) → **Security credentials** → **Assign MFA device**.

**Step 2: set a budget alert before anything else**
1. In the search box at the top, open **Billing and Cost Management** → **Budgets** → **Create budget**.
2. Choose **Use a template (simplified)** → **Monthly cost budget**.
3. Name `learnloop-monthly`, budgeted amount `1` (USD), your email address → **Create budget**. AWS then emails you when the month's costs come close to $1, pass it, or are forecast to pass it.

**Step 3: create the bucket**
1. Open **S3**. In the region menu (top right) choose the region nearest your students, for India **Asia Pacific (Mumbai) ap-south-1**.
2. **Create bucket** → **General purpose**, a unique lowercase name without dots, for example `yourschool-learnloop-media`.
3. Keep **ACLs disabled**, keep **Block all public access** turned **on**, set **Bucket Versioning** to **Disable**, keep the default encryption → **Create bucket**.

**Step 4: clean up interrupted uploads automatically**
1. Open the bucket → **Management** → **Create lifecycle rule**, name `abort-incomplete-uploads`, **Apply to all objects in the bucket** (tick the confirmation).
2. Tick **Delete expired object delete markers or incomplete multipart uploads** → **Delete incomplete multipart uploads**, number of days `1` → **Create rule**.

Large videos are uploaded to S3 in parts; this rule removes parts left behind by a crash, which would otherwise be billed for ever.

**Step 5: create a user that can only use this bucket**
1. **IAM** → **Policies** → **Create policy** → **JSON**, paste this (your bucket name in both places), **Next**, name `learnloop-media-bucket`, **Create policy**:
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
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::yourschool-learnloop-media/*"
    }
  ]
}
```
   These are exactly the permissions the app uses: upload, read, delete and list files, and cancel a failed large upload.
2. **IAM** → **Users** → **Create user**, name `learnloop-app`, **no** console access → **Attach policies directly** → tick `learnloop-media-bucket` → **Create user**.
3. Open the user → **Security credentials** → **Create access key** → **Application running outside AWS**. Copy the **Access key** and the **Secret access key** right away (the secret is shown only once) into your password manager.

**Step 6: fill in `.env`, then restart the app**
```
STORAGE_DRIVER=s3
S3_REGION=ap-south-1
S3_BUCKET=yourschool-learnloop-media
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=
S3_PUBLIC_BASE_URL=
S3_FORCE_PATH_STYLE=
```
- `S3_ENDPOINT` stays **empty** for AWS.
- `S3_REGION` must be the bucket's region (empty means `us-east-1`, and the test below then tells you the right value).
- Leave `S3_PUBLIC_BASE_URL` empty: the bucket is private. It is only for a CDN such as CloudFront in front of the bucket (DEPLOYMENT.md, section 9).
- You do **not** need CORS rules on the bucket, because the browser never loads files from it directly.

**Step 7: test it**
Open **Admin → Settings → Storage & video**. The **File storage** card shows Provider *Amazon S3*, your bucket and region. Click **Test connection**: it writes a small file, reads it back, reads it through a signed link and deletes it; all four steps should be green. *AccessDenied* means the bucket name in the policy does not match `S3_BUCKET`; *InvalidAccessKeyId* or *SignatureDoesNotMatch* means a key was copied wrongly. Files uploaded before the switch are listed under **Files still on this server**; they move to the bucket over time, or at once with **Move to bucket**.

**What costs money**
- **Storage:** each video is kept as uploaded plus one converted copy per quality chosen under **Qualities to produce** on the same page, so a video library grows fast. Choose fewer qualities to save space.
- **Watching:** protected videos are streamed through your app server, so every view sends the video out of S3 to your server. That counts as data transfer out: free up to 100 GB a month, then charged per GB. An hour of HD (720p) video is at most about 1.3 GB.
- Keep the $1 budget alert, and check **Billing and Cost Management → Free Tier** (and **Credits**) once a month.

**Other S3-compatible services** (Cloudflare R2, Backblaze B2, MinIO) work too: set `S3_ENDPOINT` to the service's address (R2: `https://<account-id>.r2.cloudflarestorage.com` with `S3_REGION=auto`; MinIO: also `S3_FORCE_PATH_STYLE=true`) and use the keys the service gives you.

More detail (CDN, cost notes): [DEPLOYMENT.md, section 9](DEPLOYMENT.md#9-object-storage-aws-s3-and-a-cdn).

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
| `DB_AUTO_BACKUP` / `DB_BACKUP_KEEP` | Daily JSON backup of the database on/off, and how many to keep (default `true` / `14`) |
| `STORAGE_DIR` | Folder for backups and other app files (default `storage`) |
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
- [ ] `DATABASE_URL` and `DIRECT_URL` point at the live database, and `npm run db:setup` has run (Docker does it on start).
- [ ] The database is backed up: Supabase Pro backups are on, and the app's JSON backups (`storage/backups/`) are copied off the server.
- [ ] Uploads go to AWS S3 (`STORAGE_DRIVER=s3`), **Test connection** is green, the lifecycle rule and the $1 budget alert are set up.
- [ ] `.env` is not in git and not shared.

For the full server setup (Docker, HTTPS, scheduled jobs), see [DEPLOYMENT.md](DEPLOYMENT.md).

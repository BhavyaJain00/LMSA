# Getting started: install, sign in, roles and where everything is

This chapter is the front door of the manual. It explains what the platform can do, how to run it on your own computer, how signing in works, which roles exist and what each one may do, and where every page lives.

> **Status.** Rounds 1 and 2 were tested page by page in a browser. Round 3 features (marked "Round 3" in the overview below: the PostgreSQL (Supabase) database, membership plans, bundles, gifts, teams, affiliates, the instructor marketplace, direct messages, the AI tutor, rubrics and peer review, the blog, the interface languages, the developer API and more) are **built and covered by automated tests; not yet tried in a browser.**

Other chapters:

| Chapter | For |
|---|---|
| [02 Guide for learners](02-learners.md) | Students: finding courses, learning, quizzes, certificates, buying, your account |
| [03 Guide for instructors, course creators and evaluators](03-instructors.md) | Building courses, batches and programs, grading, certificates |
| [04 Admin part 1: people, payments and growth](04-admin-people-and-money.md) | Members, roles, teams, payments, plans, coupons, taxes, affiliates, marketplace |
| [05 Admin part 2: site settings, SEO, marketing and communication](05-admin-content-marketing-comms.md) | Branding, features, SEO, blog, leads, email, broadcasts, sequences, legal pages |
| [06 Admin part 3: data, logs, security, going live and the developer API](06-admin-system-and-developers.md) | Backups, audit and error logs, security, storage and video, AI, API, deployment |

Contents of this chapter:

1. [What the platform is and what it can do](#1-what-the-platform-is-and-what-it-can-do)
2. [Running it on your own computer](#2-running-it-on-your-own-computer)
3. [Signing in and out](#3-signing-in-and-out)
4. [Roles and permissions](#4-roles-and-permissions)
5. [Demo accounts and what to try with each](#5-demo-accounts-and-what-to-try-with-each)
6. [Finding your way around](#6-finding-your-way-around)
7. [Complete URL map](#7-complete-url-map)

---

## 1. What the platform is and what it can do

**What it is.** LearnLoop is a self-hosted learning platform (an LMS): one Next.js web application with its own database. You run it on your computer or on a server, and people use it in a web browser on a computer, tablet or phone. The brand name, logo and colors can be changed in **Admin → Settings → General** and **Branding**, so your learners may see your own name instead of "LearnLoop".

**Who uses it.** Visitors (guests), students, course creators (instructors), evaluators, moderators and administrators. Section 4 explains exactly what each role may do.

**Where.** Locally at `http://localhost:3000` after `npm run dev` (section 2). On a server, at the address you put in `APP_URL`.

### Feature overview

Everything below exists in the code. "Default" says whether it is on in a fresh installation.

#### Learning (see [02 Guide for learners](02-learners.md))

| Feature | What it does | Default |
|---|---|---|
| Course catalog | Browse, search and filter courses; category and topic (tag) landing pages; free preview lessons | On |
| Course pages and sales pages | Course description, outline, instructors, reviews, price; instructors can add a sales page (hero, testimonials, FAQ, countdown, guarantee) | On |
| Lesson player | Video with adaptive quality, chapters, captions and transcripts, notes, discussions, "Ask AI" tab, progress tracking, focus ("zen") mode | On |
| Quizzes | Timed or untimed quizzes with several question types, proctoring options and written answers graded by staff | On |
| Assignments | Text, URL, document, PDF or image submissions graded by staff, optionally with a rubric | On |
| Programming exercises | Coding challenges in the browser, checked against test cases | On |
| Peer review (Round 3) | Learners review each other's assignments with a rubric | On (when an assignment uses it) |
| Batches (cohorts) | Group courses with a start date, seats, timetable, live classes, announcements and feedback | On |
| Live classes | Scheduled sessions inside batches with join links and recordings; calendar feed for your calendar app | On |
| Programs | Learning paths that combine several courses, optionally in a fixed order | On |
| Certificates | Earned on completion or issued by evaluators; each has a public verification page | On |
| Badges, points and leaderboard | Achievements, points for activity, weekly/monthly/all-time leaderboard | On |
| Community | One place for the questions and discussions of your courses and batches | On |
| Notifications | In-app bell and notifications page, plus email copies | On |
| Direct messages (Round 3) | Private messages between learners and instructors, with reporting and moderation | On (learner-to-learner off) |
| AI tutor (Round 3) | Answers questions using only the course material, with an instructor review queue | **Off** (needs an Anthropic API key) |
| Jobs board | Members browse, post and apply to job openings | On |
| Statistics | Platform-wide sign-up, enrollment and completion figures | On |
| Your account | Profile, account settings, security (two-step verification), email preferences, calendar feed, download your data or delete your account | On |
| Install as an app | Add the site to your home screen or desktop, with an offline page | On (production builds only) |
| Interface languages (Round 3) | English, Hindi, Spanish, French and Arabic (right-to-left) | On |

#### Buying and selling (see [02](02-learners.md) for buyers, [04](04-admin-people-and-money.md) for admins)

| Feature | What it does | Default |
|---|---|---|
| Paid courses, batches and certificates | Checkout with Stripe, Razorpay or manual payment, invoices and order history | Manual payment (no gateway keys) |
| Coupons | Percentage or fixed discounts, limits and expiry dates | On |
| Membership plans (Round 3) | Monthly, yearly or lifetime plans unlocking all or selected courses, with free trials | On |
| Course bundles (Round 3) | Several courses for one price | On |
| Installments (Round 3) | Pay for an item in several parts | On |
| Gifts (Round 3) | Buy a course, bundle or plan for someone else; they redeem a code | On |
| Teams (Round 3) | Companies buy seats and assign them to their people | On |
| Upsells (Round 3) | Order bump at checkout and a one-click offer after purchase | On (when you create one) |
| Abandoned checkout recovery (Round 3) | Reminder emails, optionally with a single-use coupon | On |
| Taxes and currencies (Round 3) | Tax by buyer country, several currencies | Off (tax mode "none", one currency) |
| Affiliates (Round 3) | Members share referral links and earn commission | On |
| Instructor marketplace (Round 3) | Outside instructors apply to teach and earn a revenue share, with payout reports | **Off** |

#### Teaching (see [03 Guide for instructors](03-instructors.md))

Course editor (chapters, lessons, content blocks, video upload with conversion to adaptive streaming, transcripts, drip and scheduled publishing, version history, duplicate, import and export), quiz builder and shared question bank, assignments and rubrics, programming exercises, grading queues, batch management (students, live classes, timetable, emails, certificates), programs, certificates and evaluations (evaluators' slots and schedule), job openings, blog articles, the AI tutor review queue, video analytics and the course dashboard.

#### Running the platform (see [04](04-admin-people-and-money.md), [05](05-admin-content-marketing-comms.md) and [06](06-admin-system-and-developers.md))

- **People and money ([04](04-admin-people-and-money.md)):** members (add, import from CSV, roles, enable or disable), teams, instructor marketplace and payouts, affiliates, payment gateways, transactions, coupons, plans, bundles, installments, gifts, taxes and currencies, upsells, revenue analytics.
- **Content, marketing and communication ([05](05-admin-content-marketing-comms.md)):** general and brand settings, feature switches, learning rules, categories, badges, points, the sidebar, legal pages and the cookie banner, SEO (sitemaps, redirects, indexing, tracking pixels), the blog, lead capture (`/free`), email settings, the email outbox, broadcasts and automated email sequences.
- **System and developers ([06](06-admin-system-and-developers.md)):** backups and restore, reload demo data, audit log, error log, login activity, security rules, storage (local disk or AWS S3), video processing (ffmpeg), automatic captions, AI tutor settings, the installable app, the REST API and webhooks (`/developers`), and going live ([DEPLOYMENT.md](../../DEPLOYMENT.md)).

### Switching features on and off

Most features can be turned off without losing data. Where the switches are:

| Switch | Where |
|---|---|
| Courses, Batches, Programs, Live classes, Programming exercises, Discussions, Reviews, Notes, Badges, Notifications, Certifications, Certified members, Jobs, Statistics | **Admin → Settings → Features** (`/admin/settings/features`) |
| Allow guest access, Disable sign-up, Default home page | **Admin → Settings → Learning** (`/admin/settings/learning`) |
| Blog | **Admin → Settings → SEO** (`/admin/settings/seo`) |
| Points and leaderboard | **Admin → Settings → Points & leaderboard** (`/admin/settings/gamification`) |
| AI tutor | **Admin → Settings → AI tutor** (`/admin/settings/ai`) |
| Membership plans, bundles, installments, gifts | **Admin → Settings → Plans, bundles & installments** (`/admin/settings/plans`) |
| Affiliates | **Admin → Affiliates** (`/admin/affiliates`) |
| Teams | **Admin → Teams** (`/admin/teams`) |
| Instructor marketplace | **Admin → Instructors & payouts** (`/admin/marketplace`) |
| Direct messages | **Message reports** page (`/messages/moderation`) |
| Installable app and offline page | **Admin → Settings → Installable app** (`/admin/settings/pwa`) |
| Developer API | **Admin → Settings → API & webhooks** (`/admin/settings/api`) |

When a feature is off, its menu links disappear and its pages answer "not found". The details of each switch are in the admin chapters.

---

## 2. Running it on your own computer

**What it is.** Running the platform locally gives you a private copy for trying things out, preparing content or developing. Nothing is sent to the internet unless you configure email, payments or other services.

**Who can do it.** Anyone with access to the project folder (`C:/Users/pc/Desktop/ll/lms` on the owner's machine). You need to be comfortable typing a few commands in a terminal.

**Where.** A terminal (Command Prompt, PowerShell, Git Bash or the terminal of your code editor) opened in the project folder, and a web browser at `http://localhost:3000`.

### 2.1 Requirements

| You need | Why | Notes |
|---|---|---|
| **Node.js 24** | The app and its tests run on Node.js | `package.json` has no `engines` field, so npm will not warn you about an older version; check with `node --version`. The Docker image and `DEPLOYMENT.md` use Node.js 24. |
| **A PostgreSQL database** | Every record (members, courses, progress, orders, settings) is stored there | A free [Supabase](https://supabase.com) project is enough. The app does not start without it. [ENV-SETUP.md](../../ENV-SETUP.md), section 3, shows each click. |
| npm | Installs the packages | Comes with Node.js |
| A modern browser | To use the site | Chrome, Edge, Firefox or Safari |
| ffmpeg and ffprobe (optional) | Converts uploaded videos to adaptive streaming (1080p/720p/480p) and makes thumbnails | Without them, videos play as the uploaded file. Set `FFMPEG_PATH` / `FFPROBE_PATH` if they are not on your PATH. |

You do not install a database server yourself: Supabase runs it for you. (Without Supabase, any PostgreSQL 13 or newer works, see [DEPLOYMENT.md](../../DEPLOYMENT.md), section 15.)

### 2.2 First start, step by step

1. **Open a terminal in the project folder.** For example `cd C:/Users/pc/Desktop/ll/lms`.
2. **Install the packages:**
   ```sh
   npm install
   ```
   This downloads Next.js, React and the other dependencies into `node_modules/`. You only need to do it once (and again after updating the code).
3. **Create your settings file** by copying the example:
   ```sh
   cp .env.example .env        # Git Bash, macOS, Linux
   copy .env.example .env      # Windows Command Prompt or PowerShell
   ```
   `.env` holds secrets and server options. It is never committed to Git (`.gitignore` excludes it).
4. **Connect the database.** Create a Supabase project, click **Connect**, and paste the two connection strings into `.env` as `DATABASE_URL` (port 6543, ending in `?pgbouncer=true&connection_limit=5`) and `DIRECT_URL` (port 5432). The other values (section 2.3) can stay as they are for a first local try.
5. **Create the tables:**
   ```sh
   npm run db:setup
   ```
   This runs `prisma migrate deploy`. Run it again after every code update.
6. **Start the development server:**
   ```sh
   npm run dev
   ```
   Wait until the terminal says the server is ready. On the very first start you also see `[store] filled the new database at …`. If `DATABASE_URL` is missing, the server stops with a message that points to ENV-SETUP.md.
7. **Open the site** at `http://localhost:3000`. As a guest you see the landing page. Click **Log in** (top right) and use a demo account from section 5, for example `admin@learnloop.test` with password `password123`.
8. **Stop the server** with `Ctrl + C` in the terminal. Your records stay in the database; uploaded files and backups stay in the `storage/` folder.

### 2.3 The settings that matter locally

In development only `DATABASE_URL` and `DIRECT_URL` are required. These are the values worth knowing:

| Variable | Default | What it does |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | The public address of the site, without a trailing slash. Used for links in emails, calendar feeds and payment callbacks. Change it if you use another port or address. |
| `APP_SECRET` | empty | A long random value (at least 32 characters, e.g. `openssl rand -hex 32`). Signs protected video links, unsubscribe and calendar links, and encrypts two-step verification secrets. **In development** an empty value is fine: a secret is generated and saved in `storage/.app-secret`. **In production it is required**, and changing it breaks existing signed links and two-step verification secrets. |
| `SEED_DEMO_DATA` | `true` | On the first start of a brand-new database: `true` loads the demo site (courses, members, orders); `false` starts empty with one admin account taken from the three variables below. |
| `ADMIN_NAME` | `Administrator` | Name of that first admin (only used when `SEED_DEMO_DATA=false`). |
| `ADMIN_EMAIL` | empty | Email of the first admin. **Required** when `SEED_DEMO_DATA=false`. |
| `ADMIN_PASSWORD` | empty | Password of the first admin, at least 8 characters. **Required** when `SEED_DEMO_DATA=false`. Change it after the first sign-in. |
| `MAIL_TRANSPORT` | `log` | `log` keeps emails in the outbox without sending them (ideal locally). `smtp` sends real email (needs `SMTP_HOST` etc.). |
| `LL_DEV_LOGIN` | empty | Set to `1` to enable the development sign-in shortcut for automated tests (section 3.9). Ignored in production. |
| `SESSION_DAYS` | `30` | How long you stay signed in. |
| `DATABASE_URL` | empty | **Required.** The PostgreSQL connection the app uses (Supabase: the transaction pooler, port 6543, with `?pgbouncer=true&connection_limit=5`). |
| `DIRECT_URL` | empty | The connection `npm run db:setup` uses to create the tables (Supabase: port 5432). |
| `STORAGE_DIR` | `storage` | Folder for backups, the SEO files and the generated development secret. |
| `UPLOAD_DIR` | `storage/uploads` | Where uploaded files go. |

The full list (storage, S3, video, captions, AI, email, payments, proxies) is in `.env.example` and explained in [06 Admin part 3](06-admin-system-and-developers.md) and [DEPLOYMENT.md](../../DEPLOYMENT.md).

> **Good to know.** The database is filled only once. `SEED_DEMO_DATA` and the `ADMIN_…` values are read when the database is still empty; changing them later has no effect on a database that already holds data. To start over, see section 2.6.

### 2.4 Starting with an empty site and your own admin

1. Stop the server.
2. In `.env` set:
   ```ini
   SEED_DEMO_DATA=false
   ADMIN_NAME=Your Name
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=a-long-password-1
   ```
3. Make sure `DATABASE_URL` points at an **empty** database: for example create a new Supabase project for it, put its two connection strings in `.env` and run `npm run db:setup`.
4. Run `npm run dev` and sign in with that email and password.

The first admin receives every staff role (Admin, Moderator, Course creator and Evaluator). Their username is the part of the email before the `@`. If `ADMIN_EMAIL` or `ADMIN_PASSWORD` is missing, the app stops with: "SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD in your .env file to create the first admin account."

### 2.5 Where your data is stored

The records (members, courses, progress, orders, settings, everything) live in the PostgreSQL database named by `DATABASE_URL`. Files live in the `storage/` folder of the project (`STORAGE_DIR`). The folder is excluded from Git, so it is never pushed to GitHub. Back it up if it matters to you.

| Path | Contents |
|---|---|
| `storage/uploads/` | Uploaded files: images, documents, videos and their converted versions. Change with `UPLOAD_DIR`, or store them in an AWS S3 bucket (`STORAGE_DRIVER=s3`, the usual choice for a live site). |
| `storage/backups/` | Database backups as JSON exports: the automatic daily ones (the newest 14 are kept; `DB_AUTO_BACKUP`, `DB_BACKUP_KEEP`) and the ones you make in **Admin → Settings → Backup & restore**. |
| `storage/.app-secret` | The generated development secret (only when `APP_SECRET` is empty). |
| `storage/seo/` | Files used by the SEO features (for example IndexNow). |

Older versions kept the records in `storage/lms.sqlite` or `storage/db.json`. The app no longer reads them; copy them into PostgreSQL once with `npm run db:to-postgres` (see [ENV-SETUP.md](../../ENV-SETUP.md), section 3).

Run only one app server per database at a time: the app keeps the records in memory, so two servers on the same database would overwrite each other's changes.

### 2.6 Resetting to the demo data

There are three ways.

**A. From the admin area (recommended).**

1. Sign in as an admin and open **Admin → Settings → Backup & restore** (`/admin/settings/data`).
2. In the red **Reload demo data** card, click **Reload demo data**.
3. In the dialog, type `RESET` (capitals) and click **Reload demo data** again.

What happens: your current data is first saved as a safety backup (you can restore it from the backup list on the same page), then every record (members, courses, progress, payments and settings) is replaced with the original demo content, and everyone is signed out. If your admin account also exists in the demo data, you stay signed in and see "Demo data reloaded. Your previous data is kept as …". Otherwise you are sent to the log-in page with "Demo data reloaded. Sign in with a demo account (password: password123)." If the site was started with `SEED_DEMO_DATA=false`, the card warns you that the admin account from your `.env` file will be gone.

**B. Start from a fresh, empty database.**

1. Stop the server.
2. Point `DATABASE_URL` and `DIRECT_URL` at an empty database (for example a new Supabase project) and run `npm run db:setup`.
3. Start the server again. The empty database is filled from `SEED_DEMO_DATA` (demo site or empty site with your admin).

**C. Restore a backup** (to go back to an earlier state rather than the demo):

```sh
npm run db:restore -- latest --dry-run                      # shows what would change
npm run db:restore -- "storage/backups/<backup file>" --force
```

A database that already holds data is only replaced with `--force`; its current data is first saved as a "safety" backup, so the restore can be undone. Related commands: `npm run db:backup` (make a backup now) and `npm run db:export` (export the database as JSON). Restoring from the admin page is described in [06 Admin part 3](06-admin-system-and-developers.md).

### 2.7 Other useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with automatic reload when code changes |
| `npm run build` then `npm run start` | Production build and server. Needed to try the installable app and offline page. Production requires `APP_SECRET` (and an `https://` `APP_URL` unless it is a local address). |
| `npm test` | Runs the automated tests (they use an in-memory test database, never yours) |
| `npm run lint` | Checks the code style |
| `npm run db:setup` | Creates or updates the database tables (after every code update) |
| `npm run db:backup` / `db:restore` / `db:export` | Database backup, restore and JSON export |
| `npm run db:to-postgres` | Copies an older version's `storage/lms.sqlite` or `storage/db.json` into an empty PostgreSQL database |

### 2.8 Emails while developing

With `MAIL_TRANSPORT=log` (the default) nothing is delivered:

- Every email is stored in the **Email outbox** (`/admin/emails`, menu **Manage → Email outbox**, for moderators and admins) with its status.
- One-time links (password reset and email confirmation) are hidden in the outbox, but **printed in the terminal** that runs `npm run dev`, on a line that starts with `[email:log] DEV ONLY — not delivered, not printed in production. One-time link for …`. Copy that link into your browser to finish a password reset or confirm an email locally.

To send real email, set `MAIL_TRANSPORT=smtp` and the `SMTP_…` values (see [05](05-admin-content-marketing-comms.md) and [DEPLOYMENT.md](../../DEPLOYMENT.md)).

### 2.9 Optional services

| Service | Needed for | Configure |
|---|---|---|
| ffmpeg | Adaptive video streaming and thumbnails | Install ffmpeg; `FFMPEG_PATH`, `FFPROBE_PATH` if not on PATH; **Admin → Settings → Storage & video** |
| Speech-to-text API | Automatic captions | `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` |
| Anthropic API key | AI tutor | `ANTHROPIC_API_KEY` or **Admin → Settings → AI tutor** |
| SMTP server | Real email | `MAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` |
| Stripe / Razorpay | Online card payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; **Admin → Settings → Payments** |
| AWS S3 (or another S3-compatible service) | Uploads in the cloud, recommended for a live site | `STORAGE_DRIVER=s3`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (step by step in [ENV-SETUP.md](../../ENV-SETUP.md), section 4); check with **Test connection** in **Admin → Settings → Storage & video** |

---

## 3. Signing in and out

### 3.1 Log in

**What it is.** The sign-in page for existing accounts.

**Who can use it.** Anyone with an account that is not disabled. If you are already signed in, the page sends you to your dashboard.

**Where.** `/login`. Click **Log in** in the top-right corner of any page, or **Log in** on the phone tab bar. Pages that need an account send you here automatically and bring you back afterwards (the address then ends in `?next=…`).

**How to use it.**

1. Enter your **Email** and **Password**.
2. Click **Log in**.
3. If your account uses two-step verification, you are asked for a code next (section 3.5).
4. You land on the page you wanted, or on your **Dashboard** (`/dashboard`).

The page also shows a box **Demo accounts (password: password123)** listing the admin, instructor, evaluator and student demo accounts.

**Settings that affect it.**

- **Admin → Settings → Security** (`/admin/settings/security`): **Failed attempts before lockout** (default 8, between 3 and 20), **Lockout duration (minutes)** (default 15, between 1 and 1440), **Require two-step verification for staff**.
- **Admin → Settings → Learning**: **Disable sign-up** hides the "New here? Create an account" link.
- `.env`: `SESSION_DAYS` (default 30) sets how long you stay signed in; `SESSION_COOKIE_NAME`, `COOKIE_SECURE`.

**Good to know.**

- A wrong email and a wrong password give the same message: "Incorrect email or password." This is deliberate, so nobody can find out which emails have accounts.
- A disabled account sees "This account has been disabled. Contact support." An admin can enable it again in **Admin → Members**.
- If the site requires two-step verification for staff and you are staff without it, you are sent to **Settings → Security** to set it up first (`/settings/security?required=2fa`).
- The language picker and the dark-mode button are in the top-right corner of all sign-in screens.

### 3.2 Create an account

**What it is.** Self-service sign-up for new learners.

**Who can use it.** Guests, while sign-up is enabled (it is by default). Signed-in members are sent to their dashboard.

**Where.** `/register`. Click **Sign up** in the top-right corner, or **Create an account** on the log-in page.

**How to use it.**

1. Enter your **Full name**, **Email** and **Password**. The password must be at least the minimum length (8 by default) and contain letters and numbers.
2. If the site has published legal pages, the form tells you that by creating an account you agree to them (with links).
3. Click **Create account**.
4. You are signed in immediately and see "Welcome to …! We sent a confirmation link to …".
5. You land on the **Learning goals** questionnaire (`/persona`): four quick questions (how you heard about the site, what describes you, your industry, your goals). Answer them to get tailored course suggestions, or click **Skip for now**. You can change the answers later from **Settings → Learning goals** or the **You** page.

**Settings that affect it.**

- **Admin → Settings → Learning**: **Disable sign-up** (then the page says "Sign up is currently disabled. Please contact an administrator for an account." and only admins and moderators can add members), **Sign-up page content** (Markdown shown above the form, for example a consent notice).
- **Admin → Settings → Security**: **Minimum password length** (8 to 64), **Require a confirmed email to enroll and purchase**.
- **Admin → Settings → Legal pages**: published policies are linked from the form.

**Good to know.**

- New accounts always get the **Student** role. Only a moderator or admin can give more roles (section 4.4).
- Your username is made from the part of your email before the `@` (with `-2`, `-3`… added when it is taken). It appears in your profile address, for example `/user/alex`.
- An email can only be registered once ("An account with this email already exists.").
- At most 10 sign-ups per hour come from one network address.

### 3.3 Confirm your email

**What it is.** A link emailed after sign-up that proves the address belongs to you.

**Who can use it.** Members who created their own account. Accounts created by an admin or moderator, and the demo accounts, count as confirmed already.

**Where.** The link in the email opens `/verify-email?token=…`. To get a new link: **Settings → Security** (`/settings/security`) → **Resend confirmation email**.

**How to use it.**

1. Open the email "confirm your address" and click the link.
2. The page shows **Email confirmed** and offers **Continue to your dashboard**.
3. If it says **This link has expired** or **This link isn't valid**, click **Send a new link** (when signed in) or log in first and use **Settings → Security → Resend confirmation email**.

**Settings that affect it.**

- **Admin → Settings → Security → Require a confirmed email to enroll and purchase** (off by default). When on, unconfirmed members can still sign in, browse and use free previews, but they cannot enroll or pay, and a banner **Confirm your email address** appears at the top of every page.

**Good to know.**

- Links work for 24 hours. Only the newest link works.
- You can resend at most 3 confirmation emails per hour.
- Resetting your password by email also confirms the address.
- An admin can confirm an address by hand: **Admin → Settings → Login activity** (`/admin/security`), pick the member, **Mark email confirmed**.
- Locally the link is printed in the terminal (section 2.8).

### 3.4 Forgot your password, reset it

**What it is.** Choose a new password using a link sent by email.

**Who can use it.** Anyone whose account is enabled. Also works while an account is locked after failed sign-ins.

**Where.** `/forgot-password` (link **Forgot password?** on the log-in page). The emailed link opens `/reset-password?token=…`. Signed-in members also find **Reset it by email** under **Settings → Security → Password**.

**How to use it.**

1. On the log-in page click **Forgot password?**.
2. Enter your email and click **Send reset link**.
3. The page says **Check your email**. (It says this whether or not an account exists, to protect privacy.)
4. Open the email and click the link.
5. Enter a **New password** and **Confirm new password**, then click **Reset password and sign in**.
6. You are signed in and see "Your password was reset and you're signed in." If you use two-step verification, you are asked for a code first.

**Settings that affect it.** **Admin → Settings → Security → Minimum password length**. Real delivery needs SMTP (section 2.8).

**Good to know.**

- The link expires after 1 hour and works once. Requesting a new link cancels earlier links.
- At most 3 reset emails per email address per hour.
- A reset signs you out on all other devices, clears any lockout, and sends you a security notice email.
- An admin can send a reset link for someone: **Admin → Settings → Login activity** (`/admin/security`) → member → **Send reset link**. Admins can also set a new password directly from the member's page in **Admin → Members** (see [04](04-admin-people-and-money.md)).

### 3.5 Two-step verification

**What it is.** After your password, sign-in also asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar). Ten one-time recovery codes let you in if you lose your phone.

**Who can use it.** Every signed-in member, while **Allow two-step verification** is on (it is by default). Staff must use it when the admin turns on **Require two-step verification for staff**.

**Where.** Set it up in **Settings → Security** (`/settings/security`, also in the account menu under **Security**). At sign-in the code is asked on `/two-factor`.

**How to turn it on.**

1. Open **Settings → Security** and click **Set up two-step verification**.
2. Scan the QR code with your authenticator app (or click **Can't scan it? Enter the key instead** and type the **Setup key**).
3. Enter the 6-digit code from the app and click **Turn on two-step verification**.
4. Save the 10 recovery codes shown (**Download .txt** or **Copy all**), tick **I've saved these codes somewhere safe**, then **Done**. They are shown only once.

**How to sign in with it.**

1. Log in with email and password as usual.
2. On **Two-step verification**, enter the **Authentication code** from your app and click **Verify and sign in**.
3. No phone? Click **Use a recovery code** and enter one of your saved codes. Each works once; you are told how many are left.
4. **Cancel** takes you back to the log-in page.

**Settings that affect it.** **Admin → Settings → Security**: **Allow two-step verification**, **Require two-step verification for staff** (admins, moderators, course creators and evaluators are then sent to set it up before they can open admin and teaching pages; turn it on for your own account first). `APP_SECRET` encrypts the stored secrets, so changing it breaks existing setups.

**Good to know.**

- The code step expires after 10 minutes. After 5 wrong codes in one attempt you must log in again.
- Wrong codes count towards the account lockout (section 3.6).
- Lost your phone and your codes? An admin can use **Reset two-step verification** in **Admin → Settings → Login activity**. You are then signed out everywhere and can set it up again.
- Manage it later from the same page: **New recovery codes**, **Turn off** (needs your password and a code; not possible when your role requires it).

### 3.6 Locked accounts and "too many attempts"

**What it is.** Protection against password guessing.

**Who it affects.** Every account, and every email address typed into the log-in form (unknown addresses are treated the same way).

**How it works.**

- After **8** wrong passwords or codes in a row (the **Failed attempts before lockout** setting), sign-in for that account is paused for **15 minutes** (the **Lockout duration (minutes)** setting).
- The member sees: "Too many failed sign-in attempts. For your security, sign-in is paused for … You can reset your password to get back in sooner."
- Separately, the server limits how fast anyone can try: 10 attempts for one email from one network address, 30 for one email from anywhere, and 40 from one network address in 15 minutes. Then the message is "Too many sign-in attempts. Please wait … and try again."

**How to get back in.**

1. Wait until the pause ends, or
2. Reset the password by email (section 3.4), which clears the lock immediately, or
3. Ask an admin: **Admin → Settings → Login activity** (`/admin/security`) lists **Locked right now** accounts with an **Unlock** button.

**Good to know.** A successful sign-in resets the counter. Every attempt (successful or not) is listed on the member's **Settings → Security → Recent sign-in activity** and, for admins, in **Login activity**. Behind a reverse proxy, set `TRUST_PROXY_HOPS=1` so the per-address limits see real visitor addresses.

### 3.7 Sign out

**What it is.** Ends your session on this device.

**Who can use it.** Every signed-in member.

**Where and how.**

1. Click your avatar in the top-right corner and choose **Log out** (the last item), or
2. On a phone, tap your avatar on the bottom tab bar to open **You** (`/you`) and tap **Log out**.

You land on the log-in page.

**Sign out other devices.** **Settings → Security → Signed-in devices** lists every browser where you are signed in, with **Sign out** per device and **Sign out other devices**. The same list appears on **Account settings** (`/settings`).

**Good to know.** Sessions end by themselves after `SESSION_DAYS` (30 days by default). Changing your password signs you out everywhere else. Resetting it by email signs out every device. Disabling an account (admin) signs that member out everywhere.

### 3.8 When a page says "No permission" or asks you to log in

- Pages that need an account send guests to `/login?next=…` and return there after sign-in.
- Pages that need a role you don't have show **No permission** (`/forbidden`): "Ask an administrator to grant you the required role, or go back to your dashboard."
- Some staff pages send people without the role elsewhere instead (for example non-staff opening `/admin/assignments` land on `/courses`).
- Pages of switched-off features, unpublished content you may not see, or wrong addresses show the "not found" page.

### 3.9 Development sign-in shortcut (for automated tests)

**What it is.** A shortcut that signs a browser in as any account without a password, used by automated smoke tests.

**Who can use it.** Only on a development server with `LL_DEV_LOGIN=1` in `.env`. It never works in production (it answers "Not found").

**How to use it.**

1. Add `LL_DEV_LOGIN=1` to `.env` (the value must be exactly `1`) and restart `npm run dev`.
2. Open `http://localhost:3000/api/dev/login?as=<user id>`, for example `?as=usr_alex`.
3. The page shows a small JSON answer (`"ok": true` with the name and roles). You are now signed in; open any page.

Demo user ids: `usr_admin`, `usr_maya`, `usr_daniel`, `usr_priya`, `usr_alex`, `usr_sofia`, `usr_liam`, `usr_emma`.

---

## 4. Roles and permissions

**What it is.** Roles decide what a member may do. A member can have several roles at once.

**Who manages them.** Moderators and admins (section 4.4).

### 4.1 The five roles

| Role (as shown) | Code name | What it is for |
|---|---|---|
| **Student** | `student` | Learn: enroll, take lessons, quizzes and assignments, earn certificates. Every new sign-up gets this role. |
| **Course creator** (the login page calls the demo one "Instructor") | `course_creator` | Build and manage **their own** courses, chapters and lessons, programs and batches they teach, quizzes, the question bank, assignments, exercises, rubrics, job openings and blog articles; grade submissions. |
| **Evaluator** | `batch_evaluator` | Manage batches they teach or created, review and grade submissions, issue certificates, run certification evaluations (slots and schedule). |
| **Moderator** | `moderator` | Oversee all content and members: manage **every** course, batch, program, quiz and job; add members and change roles (except the Admin role); see the email outbox, send batch emails, broadcasts and sequences; moderate reported messages. |
| **Admin** | `admin` | Full access, including **Admin → Settings**, payments, analytics, logs, backups and data. |

Rules the code applies everywhere:

- **Admins pass every role check.** An admin can do anything any other role can.
- **Moderators count as course creators and evaluators** for every check, and may manage everything those roles manage, for every owner.
- **Staff** means anyone with a role other than Student: course creator, evaluator, moderator or admin. Staff see the **Manage** section of the sidebar and an **Admin** link in the account menu.
- **Ownership:** a course creator manages a course only if listed as its instructor or if they created it; a program only if they created it; a quiz if they wrote it or it belongs to a course they manage. Course creators and evaluators manage a batch only if they teach it or created it. Any member may edit the job openings they posted. Moderators and admins manage all of these.
- Learning does not need the Student role. Any signed-in member can enroll; the Student role is simply the default.

### 4.2 Full permissions table

Legend: **Yes** = allowed. **Own** = only items they own (see the ownership rule above). **No** = not allowed. **Guest\*** = allowed for visitors who are not signed in while **Allow guest access** is on (the default); otherwise they are asked to log in. Features that are switched off are hidden for everyone.

| Area (main page) | Guest | Student | Course creator | Evaluator | Moderator | Admin |
|---|---|---|---|---|---|---|
| Landing page `/` | Yes | Sent to default home | Sent to default home | Sent to default home | Sent to default home | Sent to default home |
| Course, batch and program catalogs, course pages, category and topic pages (`/courses`, `/batches`, `/programs`) | Guest\* | Yes | Yes | Yes | Yes | Yes |
| Free preview lessons | Guest\* | Yes | Yes | Yes | Yes | Yes |
| Full lessons, quizzes, assignments, exercises of a course | No | Enrolled | Enrolled, or own course | Enrolled | Yes (all courses) | Yes (all courses) |
| Jobs board (`/jobs`), instructors (`/instructors`), statistics (`/statistics`), leaderboard (`/leaderboard`) | Guest\* | Yes | Yes | Yes | Yes | Yes |
| Blog, bundles, membership plans, legal pages, certificate verification, HTML sitemap, developer docs | Yes | Yes | Yes | Yes | Yes | Yes |
| Buy or enroll (checkout `/billing/…`) | No (log in first) | Yes | Yes | Yes | Yes | Yes |
| Dashboard, notifications, messages, profile, account settings, orders | No | Yes | Yes | Yes | Yes | Yes |
| Community, certified members, points history | No | Yes | Yes | Yes | Yes | Yes |
| Post a job (`/jobs/new`) and manage your postings | No | Yes (own) | Yes (own) | Yes (own) | Yes (all) | Yes (all) |
| Affiliate programme (`/affiliate`), gifts (`/gift`) | No | Yes | Yes | Yes | Yes | Yes |
| Teach / earnings (`/teach`) when the marketplace is on | No | Apply | Yes | Yes | Yes | Yes |
| My team (`/team`) | No | Team owners and managers | Team owners and managers | Team owners and managers | Team owners and managers | Yes (all teams) |
| Admin overview (`/admin`) | No | No | Yes | Yes | Yes | Yes |
| Manage courses, create or import a course (`/admin/courses`) | No | No | Own | No | Yes | Yes |
| Manage programs (`/admin/programs`) | No | No | Own | No | Yes | Yes |
| Quizzes, question bank, quiz submissions (`/admin/quizzes`, `/admin/questions`) | No | No | Yes (edit own) | No | Yes | Yes |
| Assignments and grading, exercises, rubrics, peer review management | No | No | Yes | Yes | Yes | Yes |
| Manage batches (`/admin/batches`) | No | No | Own (can create) | Own (can create) | Yes | Yes |
| Certificates: issue, bulk issue, revoke (`/admin/certificates`) | No | No | No | Yes | Yes | Yes |
| Evaluator slots and schedule (profile tabs) | No | No | No | Own | View | View |
| Job openings admin (`/admin/jobs`) | No | No | Own | Own | Yes | Yes |
| Blog articles (`/admin/blog`) | No | No | Yes | No | Yes | Yes |
| AI tutor review (`/admin/ai`) when the tutor is on | No | No | Yes | No | Yes | Yes |
| Members: list, add, import, edit profiles, change roles | No | No | No | No | Yes (not the Admin role) | Yes |
| Members: enable or disable, delete, set a password, change email, grant Admin | No | No | No | No | No | Yes |
| Email outbox, email a batch (`/admin/emails`) | No | No | No | No | Yes | Yes |
| Broadcasts and email sequences (`/admin/broadcasts`, `/admin/sequences`) | No | No | No | No | Yes | Yes |
| Message reports (`/messages/moderation`) | No | No | No | No | Yes | Yes |
| Site settings (`/admin/settings/…`) | No | No | No | No | No | Yes |
| Leads, analytics, affiliates admin, teams admin, instructors and payouts, upsells | No | No | No | No | No | Yes |
| Audit log, error log, login activity, backups, reload demo data | No | No | No | No | No | Yes |

The page-by-page version of this table is the URL map in section 7.

### 4.3 Staff two-step verification

When **Admin → Settings → Security → Require two-step verification for staff** is on, every member with a staff role (admin, moderator, course creator or evaluator) who has not turned on two-step verification is sent to **Settings → Security** before any `/admin` page or staff-only page, and sees a banner **Two-step verification is required for your role** with **Set it up now**. Students are not affected.

### 4.4 How to change someone's role

**Who can do it.** Moderators and admins. Only admins can give or remove the **Admin** role or change an admin's roles.

**Where.** Two places:

- On the member's profile: open `/user/<username>`, then the **Roles** tab (`/user/<username>/roles`). You reach a profile from **Manage → Members** (`/admin/members`), from the command palette (search "People"), or by clicking the member's name anywhere.
- When adding a member: **Manage → Members → Add** (`/admin/members/new`) has role switches, and **Import members** (`/admin/members/import`) reads a `roles` column (`student`, `course_creator`, `batch_evaluator`, `moderator`, `admin`).

**How to use it.**

1. Open **Manage → Members** and find the person (search by name or email).
2. Open their profile and click the **Roles** tab (**Roles and permissions**).
3. Flip the switch next to **Student**, **Course creator**, **Evaluator**, **Moderator** or **Admin**. Each change is saved immediately ("Role updated successfully").

**Rules and good to know.**

- You cannot remove your own Admin role, and a moderator cannot remove their own Moderator role ("You can't remove this role from yourself.").
- There must always be at least one enabled admin.
- A member with no roles left becomes a Student.
- Every change is written to the **Audit log** (`/admin/audit`, admins).
- The member sees the new menus on their next page load; they do not need to sign in again.
- Disabling an account (admin only, in **Admin → Members**) is different from removing roles: a disabled member cannot sign in at all.

---

## 5. Demo accounts and what to try with each

**What it is.** A ready-made school with courses, members, orders and activity, loaded when `SEED_DEMO_DATA=true` (the default) creates a new database.

**Who can use it.** Anyone running a demo or local copy. **Never keep demo accounts on a live site:** their password is public. Use `SEED_DEMO_DATA=false` for production.

**Where.** Sign in at `/login`. All demo accounts use the password **`password123`**.

### 5.1 The accounts

| Name | Email | Roles | Shown on the log-in page as |
|---|---|---|---|
| Admin User | `admin@learnloop.test` | Admin, Moderator, Course creator, Evaluator | Admin |
| Maya Chen | `maya@learnloop.test` | Course creator, Moderator | Instructor |
| Priya Raman | `priya@learnloop.test` | Evaluator, Moderator | Evaluator |
| Alex Johnson | `alex@learnloop.test` | Student | Student |
| Daniel Okafor | `daniel@learnloop.test` | Course creator only | (not listed) |
| Sofia Martinez | `sofia@learnloop.test` | Student | (not listed) |
| Liam Walker | `liam@learnloop.test` | Student | (not listed) |
| Emma Brown | `emma@learnloop.test` | Student | (not listed) |

> **Important.** Maya and Priya also have the **Moderator** role, so both see every course and the moderator tools, not just their own. To see what a **pure course creator** sees, sign in as **Daniel**. To see a **pure evaluator**, sign in as admin and remove Priya's Moderator role on `/user/priya/roles` (or create a new member with only the Evaluator role).

### 5.2 Demo content

- **Courses:** Modern JavaScript Fundamentals (`/courses/modern-javascript-fundamentals`, free, by Maya), React & Next.js: Build Production Apps (paid, Maya and Admin), UI Design Principles for Developers (paid, paid certificate, Priya), Python for Data Analysis (lessons unlock in order, Daniel), Advanced TypeScript Patterns (upcoming), Startup Fundamentals (draft under review, Daniel).
- **Batches:** JavaScript Bootcamp — Cohort 4 (paid, with certification), React Weekend Cohort (live now), Design Critique Circle (invite only, unpublished).
- **Program:** Full-Stack Developer Path.
- **Also:** coupons `LAUNCH20`, `REACT10` and the expired `SUMMER`; three job openings; two blog articles; membership plans (All-Access Monthly and yearly), a bundle, a rubric, an upsell offer, example tax rules, a video transcript; legal page templates (Privacy, Terms, Refunds, Cookies) that are **unpublished** until an admin publishes them.

### 5.3 What to try

**Admin (`admin@learnloop.test`)**

1. Open **Manage → Settings** (`/admin/settings`) and walk through the settings groups.
2. Open **Manage → Members** and change a member's roles; open **Login activity** (`/admin/security`).
3. Look at **Admin → Settings → Transactions** for the demo orders, and **Analytics** (`/admin/analytics`).
4. Try **Admin → Settings → Backup & restore**: make a backup, then **Reload demo data**.
5. Press `Ctrl K` and search for "react" to see the command palette.

**Maya — instructor and moderator (`maya@learnloop.test`)**

1. **Manage → Manage courses** → Modern JavaScript Fundamentals: edit lessons, look at the course dashboard.
2. **Manage → Assignments**: Alex's "Build a To-Do App" submission is waiting to be graded (Maya also has a notification about it).
3. **Manage → Manage batches** → JavaScript Bootcamp — Cohort 4: students, live classes, timetable, emails.
4. **Messages**: a conversation with Alex.
5. **Manage → Members** and **Email outbox** (moderator tools).

**Priya — evaluator and moderator (`priya@learnloop.test`)**

1. **Manage → Certificates**: issue or bulk-issue certificates.
2. Her profile tabs **Slots** and **Schedule** (`/user/priya/slots`, `/user/priya/schedule`): weekly evaluation slots and an upcoming evaluation with Sofia.
3. Her course UI Design Principles for Developers.

**Alex — student (`alex@learnloop.test`)**

1. **Dashboard**: continue Modern JavaScript Fundamentals (40% done), React (14%) and Python (not started).
2. Open the lesson player, take the basics quiz, write a note, ask a question in the discussion.
3. **Batches**: Alex is in Cohort 4 and the React Weekend Cohort (live class today).
4. **Programs**: Full-Stack Developer Path (18%).
5. The bell: three unread notifications. **Messages**: conversation with Maya.
6. Account menu → **Orders & invoices**: two paid orders (one used coupon `LAUNCH20`).
7. **Jobs**: Alex applied to Junior Frontend Developer.

**Other students**

- **Sofia** finished Modern JavaScript Fundamentals and holds certificate `LL-7K2M-Q9ZX`; open `/certificates/LL-7K2M-Q9ZX` (works signed out too).
- **Liam** has not answered the learning-goals questions, so his dashboard shows **Tailor your recommendations**.
- **Emma** joined recently and has not started her courses.
- **Daniel** shows the plain course-creator view: only his own courses, no Members, Certificates or Email outbox.

As a **guest**, open `http://localhost:3000` in a private window to see the landing page, the catalog and a free preview lesson.

---

## 6. Finding your way around

### 6.1 The screen layout

Every page except the sign-in screens, the lesson player and printable certificates uses the same frame:

| Part | Where | What is in it |
|---|---|---|
| **Sidebar** | Left side on computers; on phones and tablets open it with the menu button (three lines, "Open menu") in the top-left corner | Brand name and logo, then the sections **Main**, **You**, **Manage** and **Links**. A **Collapse** button shrinks it to icons; your choice is remembered in this browser. |
| **Header** | Top of the page | **Search or jump to…** box (opens the command palette), dark-mode button (moon or sun), notification bell, your avatar (account menu). Guests see **Log in** and **Sign up** instead. |
| **Phone tab bar** | Bottom of the screen on phones and tablets (hidden on large screens) | Up to four shortcuts and then your avatar (**You**) or **Log in** |
| **Banner** | Top of the content | Only when something needs doing: **Confirm your email address**, or **Two-step verification is required for your role** |
| **Footer** | Bottom of the page | Links (courses, categories, legal pages, cookie settings, **Sitemap**), contact details, social links and a language picker |

### 6.2 Sidebar sections and links per role

The sidebar is built from `src/lib/nav.ts`. It only shows what you may open and what is switched on.

**Main** (everyone)

| Link | Address | Shown when |
|---|---|---|
| Dashboard | `/dashboard` | Signed in |
| Courses | `/courses` | Courses feature on |
| Batches | `/batches` | Batches feature on |
| Programs | `/programs` | Programs feature on |
| Bundles | `/bundles` | Bundles on and courses on |
| Membership | `/pricing` | Membership plans on |
| Certified members | `/certified-members` | Signed in, Certifications and Certified members on |
| Jobs | `/jobs` | Jobs feature on |
| Instructors | `/instructors` | Courses on, and signed in or guest access on |
| Blog | `/blog` | Blog on (SEO settings) |
| Statistics | `/statistics` | Statistics on, and signed in or guest access on |
| Community | `/community` | Signed in, Discussions on and courses or batches on |
| Leaderboard | `/leaderboard` | Points and leaderboard on, and signed in or guest access on |

**You** (signed-in members)

| Link | Address | Shown when |
|---|---|---|
| Notifications | `/notifications` | Notifications feature on (with unread count) |
| Messages | `/messages` | Direct messages on (with unread count) |
| My team | `/team` | You own or manage a team |
| Affiliate | `/affiliate` | Affiliates on |
| Peer reviews | `/peer-reviews` | You have peer reviews assigned |
| Gifts | `/gift` | Gifts on |
| Teach | `/teach` | Marketplace on and accepting applications, or you are an approved instructor |
| My profile | `/user/<username>` | Always |

**Manage** (staff: course creators, evaluators, moderators, admins)

| Link | Address | Course creator | Evaluator | Moderator | Admin |
|---|---|---|---|---|---|
| Overview | `/admin` | Yes | Yes | Yes | Yes |
| Manage courses | `/admin/courses` | Yes | No | Yes | Yes |
| Manage batches | `/admin/batches` | Yes | Yes | Yes | Yes |
| Manage programs | `/admin/programs` | Yes | No | Yes | Yes |
| Quizzes | `/admin/quizzes` | Yes | No | Yes | Yes |
| Question bank | `/admin/questions` | Yes | No | Yes | Yes |
| Assignments (with count of submissions waiting) | `/admin/assignments` | Yes | Yes | Yes | Yes |
| Rubrics | `/admin/rubrics` | Yes | Yes | Yes | Yes |
| Exercises | `/admin/exercises` | Yes | Yes | Yes | Yes |
| Certificates | `/admin/certificates` | No | Yes | Yes | Yes |
| Job openings | `/admin/jobs` | Yes | Yes | Yes | Yes |
| Blog | `/admin/blog` | Yes | No | Yes | Yes |
| AI review (only when the AI tutor is on) | `/admin/ai` | Yes | No | Yes | Yes |
| Members | `/admin/members` | No | No | Yes | Yes |
| Email outbox | `/admin/emails` | No | No | Yes | Yes |
| Settings | `/admin/settings` | No | No | No | Yes |

Links whose feature is off (batches, programs, exercises, certifications, jobs) are hidden too.

**Links** (everyone): extra links an admin adds in **Admin → Settings → Sidebar**, then **Contact us** (the contact URL, or an email link to the contact email from **Admin → Settings → General**; the demo uses `support@example.com`).

**Where are the other admin pages?** Admin-only pages such as Leads, Analytics, Affiliates, Teams, Instructors & payouts, Upsells, Broadcasts, Email sequences, Login activity, Audit log and Error log have no sidebar link. Admins reach them through the grouped menu on the left of **Manage → Settings** (on phones, a scrollable row of buttons). Moderators may open **Broadcasts** (`/admin/broadcasts`) and **Email sequences** (`/admin/sequences`), but because the Settings menu is admin-only, they have to type those addresses. **Message reports** (`/messages/moderation`) is linked from the top of the Messages page for moderators.

**What the demo accounts see in the sidebar** (default settings):

- **Guest:** Courses, Batches, Programs, Bundles, Membership, Jobs, Instructors, Blog, Statistics, Leaderboard; Contact us.
- **Alex (student):** Dashboard, Courses, Batches, Programs, Bundles, Membership, Certified members, Jobs, Instructors, Blog, Statistics, Community, Leaderboard; You: Notifications, Messages, Affiliate, Gifts, My profile; Contact us.
- **Daniel (course creator):** as Alex, plus Manage: Overview, Manage courses, Manage batches, Manage programs, Quizzes, Question bank, Assignments, Rubrics, Exercises, Job openings, Blog.
- **Maya and Priya (with Moderator):** as Daniel, plus Certificates, Members and Email outbox.
- **Admin:** everything, plus Settings.

### 6.3 The account menu

Click your avatar in the top-right corner. The top shows your name, email and roles. Items:

| Item | Goes to | Shown |
|---|---|---|
| Dashboard | `/dashboard` | Always |
| My profile | `/user/<username>` | Always |
| Edit profile | `/user/<username>/edit` | Always |
| Admin | `/admin` | Staff only |
| Account settings | `/settings` | Always |
| Security | `/settings/security` | Always |
| Email notifications | `/settings/notifications` | Always |
| Privacy & data | `/settings/privacy` | Always |
| Orders & invoices | `/billing/history` | Always |
| Membership | `/settings/subscription` | When plans are on, or you have a membership |
| Gifts | `/gift` | When gifts are on |
| You | `/you` | Always ("Your account hub and shortcuts") |
| Language | Opens the language picker | Always |
| Log out | Signs you out | Always |

### 6.4 The "You" page

**What it is.** A phone-friendly account hub with every destination in one list.

**Who can use it.** Signed-in members. Guests see "Log in to see your account." with a **Log in** link.

**Where.** `/you`. On phones, tap your avatar at the right end of the bottom tab bar. On computers, account menu → **You**.

**What is on it.**

1. Your avatar, name and headline, **View profile**, and buttons **Dashboard** and **Edit profile**.
2. **Pages**: every sidebar link not already on the tab bar. Staff also get **Manage**, and the sidebar's Links appear under **More**.
3. **Account**: Notifications (with unread count), Search (opens the command palette), Account settings, Security, Email notifications, Calendar feed, Orders & invoices, Learning goals, the **Colour mode** choice and **Log out**.
4. At the bottom: "Signed in as <email> · <brand>".

### 6.5 The phone tab bar

On phones and tablets a bar at the bottom shows up to four shortcuts:

- **Signed in:** Home (`/dashboard`), Courses, Batches, Notifications (falls back to Programs and Jobs when a feature is off), then your avatar for **You**.
- **Guests:** Courses, Batches, Jobs, Statistics (or Programs), then **Log in**.

### 6.6 Search and the command palette

**What it is.** One search box for pages, courses, people and more, also usable with the keyboard.

**Who can use it.** Everyone. What it finds depends on your role.

**Where.** Click **Search or jump to…** in the header (on phones, the magnifier icon), or press **`Ctrl K`** (Windows, Linux) or **`⌘K`** (Mac) on any page with the sidebar. Press the same keys again to close it. On the **You** page, tap **Search**.

**How to use it.**

1. Open the palette. Before you type, it lists search **categories** (Courses, Video transcripts, Batches, Programs, Jobs; Quizzes and Assignments for course creators and moderators; People for signed-in members) and quick links grouped as **Jump to**, **Manage** and **Account** (Account settings, Edit profile, Learning goals, Site settings for admins, **Toggle dark mode**; guests get **Log in** and **Create an account**). Staff also get **Create a course**, **Submissions to grade** and **Quiz submissions**.
2. Type at least 2 characters. Matching pages appear under **Jump to**, and live results from the site appear by category.
3. To search only one category, pick it first (for example **Courses**); the box then says "Search courses". **Backspace** in an empty box or **Esc** leaves the category. Each category also has **View all …**.
4. Move with **↑** and **↓** (**Ctrl Home** / **Ctrl End** jump to the first or last), open with **Enter**, close with **Esc**.

**Good to know.** "Video transcripts" searches the spoken words of lesson videos that have transcripts. "People" opens the member list for moderators and the certified-members directory for others. The palette never offers a page the sidebar would hide.

### 6.7 Notifications bell

**What it is.** In-app notifications: enrollments, new courses and batches, live classes, graded assignments and quizzes, certificates, badges, replies, mentions, announcements and system notices.

**Who can use it.** Signed-in members, while **Admin → Settings → Features → Notifications** is on.

**Where.** The bell in the header. The full list is `/notifications` (**You → Notifications** in the sidebar).

**How to use it.**

1. A number on the bell shows unread notifications ("9+" above nine).
2. Click the bell to see the latest 10. Unread ones are bold with a dot.
3. Click a notification to open it (it is marked read), or click **Mark all read**.
4. **View all** opens the notifications page with older items.

**Settings that affect it.** Which notifications are also emailed: each member chooses in **Settings → Email notifications** (`/settings/notifications`); the admin sets the defaults in **Admin → Settings → Email** (see [05](05-admin-content-marketing-comms.md)).

### 6.8 Dark mode

**What it is.** A light or dark color scheme.

**Who can use it.** Everyone, including guests.

**Where and how.**

- Click the moon or sun button in the header (also on the sign-in screens) to switch.
- Or choose **System**, **Light** or **Dark** under **Settings → Appearance** (`/settings`) or **Colour mode** on the **You** page.
- Or open the command palette and choose **Toggle dark mode**.

**Good to know.** The choice is saved in this browser only ("Applies to this device only."). Until you choose, the site follows your device's setting.

### 6.9 Changing the language

**What it is.** The interface can be shown in **English**, **हिन्दी (Hindi)**, **Español (Spanish)**, **Français (French)** and **العربية (Arabic)**. Arabic is displayed right to left.

**Who can use it.** Everyone, including guests.

**Where.**

- Account menu (avatar) → **Language** → pick a language → **Change**.
- **Settings → Language** (`/settings`).
- The small language picker at the top of the sign-in screens and in the page footer.

**How it decides.** Your saved account preference first, then the choice stored in this browser (the `ll_locale` cookie, kept for a year), then your browser's language, then English. Signed-in members' choices are saved to their account and follow them to every device. Addresses (URLs) stay the same in every language.

**What is translated, honestly.**

| Part | Translated? |
|---|---|
| Sidebar, header, account menu, notification bell, phone tab bar, common buttons | Yes, fully |
| Log in, sign up, password reset, two-step verification, email confirmation | Yes, fully |
| Account pages (dashboard, settings, notifications, messages and similar) and admin tools | Partly: many labels are translated, but several pages still have English titles and texts |
| Lesson player, quizzes, assignments, exercises | Partly (about 60% of the texts) |
| Public pages: catalog, course pages, batches, programs, blog, jobs, instructors, pricing, legal pages | No, English only (the translation files for these pages are empty) |
| Content: course, lesson, quiz, blog and job texts, names, anything typed by admins | Never; it stays in the language it was written in |
| Emails, exports, logs, API answers | English |

**Settings that affect it.** **Admin → Settings → General → Text direction**: **Automatic** (follows the language), **Left to right** or **Right to left**.

### 6.10 Installing the site as an app

**What it is.** Members can add the site to a phone's home screen or a computer's app list. It then opens in its own window, loads faster and shows an offline page when the connection drops (a "progressive web app").

**Who can use it.** Everyone, on a site that is served over HTTPS (or from `localhost`) and runs as a **production build** (`npm run build` then `npm run start`, or Docker). In `npm run dev` the service worker is deliberately not registered, so you will not see the install card or offline page there.

**Where and how.**

- **Chrome, Edge and other Chromium browsers:** a small card **Install <brand>** appears when the browser allows installation. Click **Install** and confirm. **Not now** hides the card for 14 days. You can also install from the browser's own menu at any time.
- **iPhone and iPad (Safari):** a card **Add <brand> to your iPhone/iPad** explains the steps: tap **Share** in the toolbar, choose **Add to Home Screen**, tap **Add**. **Got it** hides it.
- The card is never shown inside the lesson player, quizzes, checkout pages or exercises, nor when the app is already installed.

**Settings that affect it.** **Admin → Settings → Installable app** (`/admin/settings/pwa`): **Installable app** (turns the service worker and install support on or off), **Suggest installing the app** (the install card), **Offline page**. The page also shows a **Readiness** check (HTTPS, production build, web app manifest, app icons) and a **Preview offline page** link. The app name, colors and icon come from **General** and **Branding**.

### 6.11 The offline page

**What it is.** A branded screen shown by the installed app or service worker when a page cannot load: "You're offline. Check your Wi-Fi or mobile data. This page reloads by itself as soon as you're connected again." It has a **Try again** button, and switches to "You're back online" with **Continue** when the connection returns.

**Who sees it.** Anyone using a production build with **Installable app** and **Offline page** on, when the connection drops.

**Where.** It is served in place of the page that failed. You can open it directly at `/offline` (or with **Preview offline page** in the admin settings). It never contains personal data.

### 6.12 Other helpful pages

- `/sitemap`: a readable list of all public pages (linked from the footer).
- `/forbidden`: the "No permission" page.
- `/developers`: the public documentation of the REST API and webhooks.
- Machine-readable addresses: `/sitemap.xml`, `/robots.txt`, `/rss.xml` and `/blog/rss.xml` (feeds), `/manifest.webmanifest` (app manifest), `/api/health` (health check for monitoring), `/api/v1/…` (the developer API, with an API key).

---

## 7. Complete URL map

Every page of the application (205 pages, taken from `src/app/**/page.tsx` with the route groups removed). `[slug]`, `[id]` and similar parts are placeholders, for example `/courses/[slug]` means `/courses/modern-javascript-fundamentals`.

How to read the "Who can open it" column:

- **Everyone** includes guests. **Everyone\*** means guests only while **Allow guest access** is on (default on); otherwise guests are asked to log in.
- **Signed in** means any member with an account. Guests are sent to `/login` and brought back afterwards.
- **Staff** means course creators, evaluators, moderators and admins.
- **Moderators** always includes admins. **Admins only** means the Admin role.
- Pages of a feature that is switched off answer "not found" for everyone.

### 7.1 Public pages

| Address | Purpose | Who can open it |
|---|---|---|
| `/` | Landing page for guests (hero, featured courses, reviews). Signed-in members are sent to their default home (Courses or Dashboard, set in **Admin → Settings → Learning**). | Everyone |
| `/login` | Log in | Everyone (signed-in members are sent on) |
| `/register` | Create an account | Everyone, unless sign-up is disabled |
| `/forgot-password` | Request a password reset link | Everyone |
| `/reset-password` | Choose a new password (from the emailed link) | Anyone with a valid link |
| `/two-factor` | Second sign-in step: authenticator or recovery code | During a sign-in attempt |
| `/verify-email` | Confirm an email address (from the emailed link) | Anyone with the link |
| `/courses` | Course catalog with search, filters and tabs | Everyone\* |
| `/courses/[slug]` | Course page: description, outline, instructors, reviews, price, enroll or buy | Everyone\* (unpublished courses: their managers and enrolled learners) |
| `/courses/category` | List of course categories | Everyone\* |
| `/courses/category/[slug]` | Courses in one category | Everyone\* |
| `/courses/tag` | A to Z list of course topics | Everyone\* |
| `/courses/tag/[tag]` | Courses about one topic | Everyone\* |
| `/courses/[slug]/learn` | Opens the course where you left off (or the course page) | Everyone\* (see the lesson player below) |
| `/courses/[slug]/learn/[ref]` | Lesson player; `[ref]` is chapter-lesson, e.g. `1-3`. Guests and non-enrolled members see only free preview lessons. | Preview lessons: Everyone\*; all lessons: enrolled learners and course managers |
| `/batches` | Batch (cohort) catalog with tabs | Everyone\* |
| `/batches/[slug]` | Batch page: courses, timetable, live classes, seats, enroll or buy | Everyone\* (unpublished batches: enrolled learners and managers) |
| `/programs` | Program (learning path) catalog | Everyone\* |
| `/programs/[slug]` | Program page with its courses and progress | Everyone\* (unpublished: members and managers) |
| `/bundles` | Course bundles for sale | Everyone (when bundles are on) |
| `/bundles/[slug]` | One bundle: included courses, price, buy | Everyone (when bundles are on) |
| `/pricing` | Membership plans | Everyone |
| `/instructors` | Directory of instructors | Everyone\* |
| `/instructors/[username]` | An instructor's landing page with their courses | Everyone\* |
| `/jobs` | Job board | Everyone\* |
| `/jobs/[slug]` | One job opening with **Apply** | Everyone\* (closed jobs: poster, moderators and applicants) |
| `/blog` | Blog articles | Everyone (when the blog is on) |
| `/blog/[slug]` | One article | Everyone (when the blog is on) |
| `/blog/category/[slug]` | Articles in one category | Everyone (when the blog is on) |
| `/blog/tag/[tag]` | Articles with one tag | Everyone (when the blog is on) |
| `/statistics` | Platform statistics (sign-ups, enrollments, completions, top courses) | Everyone\* (detail views are for staff) |
| `/leaderboard` | Points leaderboard: this week, this month, all time | Everyone\* (when points and leaderboard are on) |
| `/certificates` | **Verify a certificate**: enter a certificate code | Everyone |
| `/certificates/[code]` | Public verification page of a certificate, e.g. `/certificates/LL-7K2M-Q9ZX` | Everyone (published, unexpired certificates) |
| `/legal/[slug]` | Published legal pages: `privacy`, `terms`, `refunds`, `cookies` | Everyone (once published) |
| `/free` | Free lessons sign-up (lead capture, double opt-in) | Everyone |
| `/free/confirm` | Confirms a lead's email from the emailed link | Anyone with the link |
| `/free/unsubscribe` | Unsubscribe a lead from marketing emails | Anyone with the link |
| `/redeem` | Redeem a gift code for a course, bundle or membership | Everyone (signing in is needed to redeem) |
| `/team/buy` | **For teams**: buy seats for a company or team | Everyone (when teams are on) |
| `/join/[token]` | Accept a team invitation | Anyone with the invitation link |
| `/user/[username]` | A member's profile (**About** tab). Profiles of instructors of published courses are public pages. | Everyone (disabled members: moderators only) |
| `/you` | Account hub (guests see a log-in prompt) | Everyone |
| `/developers` | REST API and webhook documentation | Everyone |
| `/sitemap` | HTML sitemap of public pages | Everyone |
| `/forbidden` | "No permission" page | Everyone |
| `/offline` | Offline page used by the installed app | Everyone |

### 7.2 Learner pages (signed in)

| Address | Purpose | Who can open it |
|---|---|---|
| `/dashboard` | Your home: continue learning, live classes, evaluations, batches, programs, recommendations, activity, orders; a teaching summary for staff | Signed in |
| `/persona` | **Learning goals** questionnaire (shown after sign-up) | Signed in |
| `/notifications` | All your notifications | Signed in (when notifications are on) |
| `/messages` | Direct messages inbox | Signed in (when messages are on) |
| `/messages/new` | Start a conversation (e.g. **Message instructor**) | Signed in |
| `/messages/[conversationId]` | One conversation | Its participants (moderators for reported conversations) |
| `/community` | Questions and discussions from your courses and batches | Signed in (when discussions are on) |
| `/certified-members` | Directory of members who earned certificates | Signed in (guests are sent to `/courses`) |
| `/leaderboard/points` | Your points history | Signed in |
| `/courses/[slug]/ask` | **Ask the AI tutor** about a course | Enrolled learners and course managers, when the AI tutor is set up and on for the course |
| `/courses/[slug]/certification` | Certification for a course: book an evaluation, see its status | Signed in (course must be visible to you) |
| `/quiz/[id]` | Take a quiz | Signed in, with access to the quiz |
| `/quiz/submissions/[id]` | Result of a quiz attempt | The learner who took it, and staff who manage the quiz |
| `/assignments/[id]` | Read and submit an assignment | Signed in, with access to the assignment |
| `/exercises/[id]` | Solve a programming exercise | Signed in, with access to the exercise |
| `/exercises/submissions` | Your exercise submissions | Signed in |
| `/exercises/submissions/[id]` | One exercise submission and its test results | Its author, and staff |
| `/peer-reviews` | Peer reviews assigned to you | Signed in |
| `/peer-reviews/[id]` | Write one peer review | The assigned reviewer |
| `/jobs/new` | Post a job opening | Signed in (when jobs are on) |
| `/jobs/mine` | Jobs you posted, with applicants | Signed in |
| `/jobs/applications` | Jobs you applied to | Signed in |
| `/jobs/[slug]/edit` | Edit a job opening | Its poster and moderators |
| `/jobs/[slug]/applications` | Applicants for a job | Its poster and moderators |
| `/billing/[type]/[id]` | Checkout (**Billing Details**) for a `course`, `batch`, `certificate`, `plan`, `bundle`, `gift` or `seats` | Signed in |
| `/billing/success/[orderId]` | Order status after paying | The buyer and admins |
| `/billing/cancelled` | Shown when a payment was cancelled | Signed in |
| `/billing/history` | **Orders & invoices** | Signed in |
| `/billing/invoice/[orderId]` | Printable invoice | The buyer and admins |
| `/gift` | Gifts you gave and received | Signed in |
| `/affiliate` | Affiliate programme: apply, referral links, earnings, payouts | Signed in (when affiliates are on) |
| `/team` | **My team**: seats, members, progress | Team owners and managers, admins |
| `/teach` | **Teach**: apply to teach, your courses as an instructor | Signed in (useful when the marketplace is on) |
| `/teach/earnings` | **Earnings** per course and per month | Approved marketplace instructors |
| `/user/[username]/certificates` | Certificates tab of a profile | Signed in |
| `/user/[username]/badges` | Badges tab of a profile | Signed in (when badges are on) |

### 7.3 Account settings

| Address | Purpose | Who can open it |
|---|---|---|
| `/settings` | **Account settings**: account details, security summary, links, password, appearance, language, learning goals, signed-in devices | Signed in |
| `/settings/security` | **Security**: email confirmation, two-step verification, password, recent sign-in activity, signed-in devices | Signed in |
| `/settings/notifications` | **Email notifications** preferences (also the target of unsubscribe links, which work signed out) | Signed in, or with a signed unsubscribe link |
| `/settings/calendar` | **Calendar feed**: your personal calendar link for live classes and deadlines | Signed in |
| `/settings/privacy` | **Privacy & data**: download your data, delete your account | Signed in |
| `/settings/subscription` | **Membership**: your plan, billing dates, invoices | Signed in |
| `/user/[username]/edit` | **Edit profile** | The member themselves; moderators (admins' profiles: admins only) |
| `/user/[username]/roles` | **Roles** tab: change roles | Moderators (Admin role: admins only) |

### 7.4 Instructor tools

| Address | Purpose | Who can open it |
|---|---|---|
| `/admin` | **Overview**: teaching and platform figures, shortcuts | Staff |
| `/admin/courses` | **Manage courses** list | Course creators and moderators |
| `/admin/courses/new` | Create a course | Course creators and moderators |
| `/admin/courses/import` | Import a course from a JSON export | Course creators and moderators |
| `/admin/courses/[id]` | Course editor (details, outline, settings, dashboard and other tabs) | Managers of that course |
| `/admin/courses/[id]/dashboard` | Shortcut to the course editor's Dashboard tab | Managers of that course |
| `/admin/courses/[id]/lessons/[lessonId]` | Lesson editor | Managers of that course |
| `/admin/courses/[id]/lessons/[lessonId]/transcript` | Transcript and captions editor for the lesson video | Managers of that course |
| `/admin/courses/[id]/sales-page` | Sales page builder | Managers of that course |
| `/admin/courses/[id]/video-analytics` | Video analytics: viewers, drop-off, replays | Managers of that course |
| `/admin/programs` | **Manage programs** | Course creators and moderators |
| `/admin/programs/new` | Create a program | Course creators and moderators |
| `/admin/programs/[id]` | Edit a program and follow member progress | Its creator and moderators |
| `/admin/batches` | **Manage batches** | Staff |
| `/admin/batches/new` | Create a batch | Staff |
| `/admin/batches/[id]` | Batch editor: students, courses, live classes, timetable, emails, certificates | The batch's instructors and creator, moderators |
| `/admin/quizzes` | **Quizzes** list | Course creators and moderators |
| `/admin/quizzes/new` | Create a quiz | Course creators and moderators |
| `/admin/quizzes/[id]` | Quiz builder | The quiz's author, managers of its course, moderators |
| `/admin/quizzes/submissions` | **Quiz submissions** | Course creators and moderators |
| `/admin/quizzes/submissions/[id]` | Review and grade one quiz submission | Course creators and moderators with access |
| `/admin/questions` | **Question bank** | Course creators and moderators |
| `/admin/questions/new` | Write a question | Course creators and moderators |
| `/admin/questions/[id]` | Edit a question | Course creators and moderators with access |
| `/admin/assignments` | **Assignments** list | Staff |
| `/admin/assignments/new` | Create an assignment | Staff |
| `/admin/assignments/[id]` | Edit an assignment | Staff |
| `/admin/assignments/submissions` | **Assignment Submissions** (grading queue) | Staff |
| `/admin/assignments/submissions/[id]` | **Grade submission** | Staff |
| `/admin/rubrics` | **Rubrics** (scoring guides) | Staff |
| `/admin/rubrics/new` | Create a rubric | Staff |
| `/admin/rubrics/[id]` | Edit a rubric | Staff (editing: its author and moderators) |
| `/admin/exercises` | **Programming Exercises** | Staff |
| `/admin/exercises/new` | Create an exercise | Staff |
| `/admin/exercises/[id]` | Edit an exercise | Staff |
| `/admin/exercises/submissions` | **Exercise Submissions** | Staff |
| `/admin/exercises/submissions/[id]` | One exercise submission | Staff |
| `/peer-reviews/manage` | Peer review overview per assignment | Staff |
| `/peer-reviews/manage/[assignmentId]` | Peer reviews of one assignment | Staff |
| `/admin/certificates` | **Certificates**: issue, publish, revoke | Evaluators and moderators |
| `/admin/certificates/new` | **Issue certificate** by hand | Evaluators and moderators |
| `/admin/certificates/bulk` | **Generate Certificates** for a whole batch | Evaluators and moderators |
| `/user/[username]/slots` | **Slots**: an evaluator's weekly availability | That evaluator; moderators |
| `/user/[username]/schedule` | **Schedule**: an evaluator's upcoming evaluations | That evaluator; moderators |
| `/admin/jobs` | **Job Openings** | Staff |
| `/admin/jobs/new` | Post a job | Staff |
| `/admin/jobs/[id]` | Edit a job | Its poster and moderators |
| `/admin/jobs/[id]/applications` | Applications for a job | Its poster and moderators |
| `/admin/blog` | **Blog** articles | Course creators and moderators |
| `/admin/blog/new` | Write an article | Course creators and moderators |
| `/admin/blog/[id]` | Edit an article | Course creators and moderators with access |
| `/admin/ai` | **AI tutor review** queue | Course creators and moderators |
| `/admin/ai/usage` | **AI tutor usage** | Course creators and moderators |
| `/admin/ai/conversations/[id]` | One AI tutor conversation | Course creators and moderators |

### 7.5 Admin pages

| Address | Purpose | Who can open it |
|---|---|---|
| `/admin/members` | **Members**: everyone with an account | Moderators |
| `/admin/members/new` | **Add New Member** | Moderators |
| `/admin/members/import` | **Import members** from CSV | Moderators |
| `/admin/members/[id]` | One member: details, enrollments, account actions | Moderators (some actions: admins only) |
| `/admin/emails` | Email **Outbox** | Moderators |
| `/admin/emails/[id]` | One email and its delivery status | Moderators |
| `/admin/emails/compose` | **Send a batch email** to a batch's students | Moderators |
| `/admin/broadcasts` | **Broadcasts** (newsletters to segments) | Moderators |
| `/admin/broadcasts/new` | New broadcast | Moderators |
| `/admin/broadcasts/[id]` | Review, test, schedule or send a broadcast; its results | Moderators |
| `/admin/broadcasts/[id]/edit` | Edit a broadcast | Moderators |
| `/admin/broadcasts/audience` | **Broadcast audience** (segment builder) | Moderators |
| `/admin/broadcasts/tracking` | **Email tracking**: opens and clicks | Moderators |
| `/admin/sequences` | **Email sequences** (automated series) | Moderators |
| `/admin/sequences/new` | New sequence | Moderators |
| `/admin/sequences/[id]` | One sequence and its results | Moderators |
| `/admin/sequences/[id]/edit` | Edit a sequence | Moderators |
| `/messages/moderation` | **Message reports** and the direct-message switches | Moderators |
| `/admin/leads` | **Leads** from the lead forms | Admins only |
| `/admin/analytics` | **Analytics**: traffic, sales, funnel, retention | Admins only |
| `/admin/affiliates` | **Affiliates**: clicks, sales, commissions, payouts | Admins only |
| `/admin/affiliates/[id]` | One affiliate | Admins only |
| `/admin/teams` | **Teams** that bought seats | Admins only |
| `/admin/teams/[id]` | One team: seats, members, history | Admins only |
| `/admin/marketplace` | **Instructor marketplace**: applications, revenue shares, payouts | Admins only |
| `/admin/marketplace/[id]` | One instructor | Admins only |
| `/admin/upsells` | **Upsells**: order bumps and post-purchase offers | Admins only |
| `/admin/security` | **Login activity**: every sign-in attempt, locked accounts, account tools (Unlock, Send reset link, Mark email confirmed, Reset two-step verification, Sign out everywhere) | Admins only |
| `/admin/audit` | **Audit log** of admin actions | Admins only |
| `/admin/errors` | **Error log** and startup configuration checks | Admins only |
| `/admin/errors/[id]` | **Error details** | Admins only |

### 7.6 Admin settings

All pages below are for **admins only**. Open them with **Manage → Settings**; the left-hand menu groups them as shown (`/admin/settings` itself opens **General**).

| Address | Menu group → item | Purpose |
|---|---|---|
| `/admin/settings` | — | Opens **General** |
| `/admin/settings/general` | System configuration → General | Brand name, tagline, footer text, contact email and URL, text direction |
| `/admin/settings/branding` | System configuration → Branding | **Brand settings**: logo, favicon, accent color, share image |
| `/admin/settings/seo` | System configuration → SEO | Titles, descriptions, verification codes, blog switch, noindex |
| `/admin/settings/seo/indexing` | (SEO tab) | Sitemap and indexing status, IndexNow |
| `/admin/settings/seo/redirects` | (SEO tab) | URL redirects |
| `/admin/settings/seo/tracking` | (SEO tab) | Google Analytics 4 and Meta Pixel, loaded only after consent |
| `/admin/settings/features` | System configuration → Features | Feature switches |
| `/admin/settings/learning` | System configuration → Learning | Guest access, sign-up, completion rules, default home, publish notifications |
| `/admin/settings/video` | System configuration → Video | Protected video links, watermark, seek thumbnails, autoplay |
| `/admin/settings/storage` | System configuration → Storage & video | Storage driver status, video conversion (HLS), automatic captions |
| `/admin/settings/ai` | System configuration → AI tutor | Turn on the tutor, API key, model, daily limit, review queue |
| `/admin/settings/api` | System configuration → API & webhooks | API keys, webhook endpoints |
| `/admin/settings/api/webhooks/[id]` | (API & webhooks) | One webhook endpoint and its deliveries |
| `/admin/settings/pwa` | System configuration → Installable app | Installable app, install card, offline page |
| `/admin/blog` | Content & marketing → Blog | (see 7.4) |
| `/admin/leads` | Content & marketing → Leads | (see 7.5) |
| `/admin/analytics` | Content & marketing → Analytics | (see 7.5) |
| `/admin/affiliates` | Content & marketing → Affiliates | (see 7.5) |
| `/admin/settings/categories` | Course configuration → Categories | Course categories |
| `/admin/settings/badges` | Course configuration → Badges | Badges and when they are awarded |
| `/admin/settings/gamification` | Course configuration → Points & leaderboard | Points per activity, leaderboard |
| `/admin/rubrics` | Course configuration → Rubrics | (see 7.4) |
| `/admin/members` | User management → Members | (see 7.5) |
| `/admin/teams` | User management → Teams | (see 7.5) |
| `/admin/marketplace` | User management → Instructors & payouts | (see 7.5) |
| `/admin/settings/security` | User management → Security | Email confirmation, two-step verification, lockout, password rules |
| `/admin/security` | User management → Login activity | (see 7.5) |
| `/admin/settings/email` | Communication → Email | Sender, footer, which notifications are emailed, tracking, cron key |
| `/admin/broadcasts` | Communication → Broadcasts | (see 7.5) |
| `/admin/sequences` | Communication → Email sequences | (see 7.5) |
| `/admin/emails` | Communication → Outbox | (see 7.5) |
| `/admin/settings/payments` | Payment → Payments | Gateway (manual, Stripe, Razorpay), currency, reminders |
| `/admin/settings/transactions` | Payment → Transactions | All orders and payments, refunds |
| `/admin/settings/coupons` | Payment → Coupons | Discount codes |
| `/admin/settings/plans` | Payment → Plans, bundles & installments | Membership plans, bundles, installments, gifts and checkout reminders |
| `/admin/settings/taxes` | Payment → Taxes & currencies | Tax rules by country, currencies |
| `/admin/upsells` | Payment → Upsells | (see 7.5) |
| `/admin/settings/sidebar` | Customization → Sidebar | Extra links in the sidebar's Links section |
| `/admin/settings/legal` | Legal & compliance → Legal pages | Legal pages list, cookie banner, company details, data retention |
| `/admin/settings/legal/[slug]` | (Legal pages) | Edit and publish one legal page |
| `/admin/audit` | Legal & compliance → Audit log | (see 7.5) |
| `/admin/errors` | Legal & compliance → Error log | (see 7.5) |
| `/admin/settings/data` | Data → Backup & restore | Backups, restore, integrity check, **Reload demo data** |

Details of every settings page are in [05 Admin part 2](05-admin-content-marketing-comms.md) and [06 Admin part 3](06-admin-system-and-developers.md); members, teams and money pages in [04 Admin part 1](04-admin-people-and-money.md).

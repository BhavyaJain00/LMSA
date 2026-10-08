# Admin guide, part 3: data, logs, security, going live and the developer API

This chapter is for the platform owner, administrators and the developer who runs the server. It covers where the data lives and how to back it up, the audit and error logs, security settings that live in `.env`, putting the site on a real server, scheduled jobs, every environment variable, the public REST API, webhooks, automated tests and troubleshooting.

> **Status.** Most of this chapter describes round 3 work: the PostgreSQL (Supabase) database, backups and restore, the audit log and data requests, the error log, the health check, the Docker files, the commerce/comms/media/webhook scheduled jobs, the REST API and webhooks. These features are **built and covered by automated tests; not yet tried in a browser.** The email scheduled job, sessions and security headers are from rounds 1 and 2.

**Who can use this chapter's pages.** Every admin page in this chapter needs the **Admin** role. Instructors, moderators, evaluators and students cannot open them (they are sent away or see "not allowed"). Two things are public: the health check (`/api/health`) and the developer documentation (`/developers`), which anyone, including signed-out visitors, can read.

**How to get to the admin pages.** Sign in as an admin (demo: `admin@learnloop.test`, password `password123`). In the left sidebar choose **Settings** (`/admin/settings`). The settings menu on the left (a row of pills on phones) is grouped; this chapter uses these entries:

| Settings group | Menu entry | URL |
|---|---|---|
| System configuration | API & webhooks | `/admin/settings/api` |
| Legal & compliance | Legal pages (retention period) | `/admin/settings/legal` |
| Legal & compliance | Audit log | `/admin/audit` |
| Legal & compliance | Error log | `/admin/errors` |
| Data | Backup & restore | `/admin/settings/data` |
| Communication | Email (cron URL and key) | `/admin/settings/email` |
| System configuration | Storage & video (ffmpeg status) | `/admin/settings/storage` |
| System configuration | AI tutor | `/admin/settings/ai` |

The local address used in the examples is `http://localhost:3000` (the default `APP_URL`). On a live site, replace it with your own `https://` address.

---

## 1. The database

### What it is

All of the platform's records (members, courses, lessons, progress, payments, settings, logs) are stored in a **PostgreSQL** database, normally a [Supabase](https://supabase.com) project. Supabase runs the database server for you; the app connects to it over the internet with the address in `DATABASE_URL`. PostgreSQL is the only database: without `DATABASE_URL` the app does not start, on your computer or on a server.

Uploaded files (videos, images, documents) are **not** in the database. They are in the uploads folder (`UPLOAD_DIR`, default `storage/uploads`) or, on a live site, in an AWS S3 bucket (see [Uploads in AWS S3](#uploads-in-aws-s3) and [ENV-SETUP.md](../../ENV-SETUP.md), section 4).

### Who can use it

Nobody uses the database directly. Admins look at it, back it up and restore it on **Admin → Settings → Backup & restore**. The server owner sets it up in Supabase and can use the command-line tools described below.

### Where

| What | Default location | Changed with |
|---|---|---|
| Database (all records) | The Supabase project (or other PostgreSQL server) named by `DATABASE_URL` | `DATABASE_URL`, `DIRECT_URL` |
| Backups (JSON exports) | `storage/backups/` | `STORAGE_DIR` (backups go into its `backups` folder) |
| Uploaded files | `storage/uploads/`, or the S3 bucket | `UPLOAD_DIR`, `STORAGE_DRIVER=s3` and `S3_*` |
| Generated development secrets | `storage/.app-secret`, `storage/.quiz-attempt-key` | `APP_SECRET`, `QUIZ_ATTEMPT_SECRET` |
| SEO files (IndexNow key and others) | `storage/seo/` | `STORAGE_DIR` |

Relative paths start at the project folder (the folder that contains `package.json`). You can also use absolute paths (required on a server without Docker, see [DEPLOYMENT.md](../../DEPLOYMENT.md), section 3). The `storage/` folder is never committed to GitHub.

### Setting it up

The full click-by-click guide is in [ENV-SETUP.md](../../ENV-SETUP.md), section 3. In short:

1. Create a Supabase project (choose the region nearest your students, for India **Mumbai / ap-south-1**) and save the database password.
2. Click **Connect** and copy the two connection strings into `.env`: `DATABASE_URL` (port 6543, ending in `?pgbouncer=true&connection_limit=5`) and `DIRECT_URL` (port 5432).
3. Run `npm run db:setup` once (and after every upgrade). It creates or updates the tables (`prisma migrate deploy`). The Docker image does this by itself on every start.
4. Start the app.

Without Supabase, any PostgreSQL 13 or newer works, including the optional local PostgreSQL container in `docker-compose.yml` ([DEPLOYMENT.md](../../DEPLOYMENT.md), section 15).

### Settings that affect it

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | empty (required) | The connection the app uses. With Supabase: the transaction pooler, port 6543, with `?pgbouncer=true&connection_limit=5`. |
| `DIRECT_URL` | empty | The connection `npm run db:setup` uses to create and update the tables. With Supabase: the session pooler or direct connection, port 5432. Without a pooler, the same as `DATABASE_URL`. |
| `STORAGE_DIR` | `storage` | Folder for backups, SEO files and generated secrets. |
| `SEED_DEMO_DATA` | `true` | What an empty database starts with: the demo courses and members (`true`) or an empty site with one admin (`false`). Only used while the database is still empty. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `Administrator`, empty, empty | The first admin account when `SEED_DEMO_DATA=false`. |

You can see the values the server is using at the bottom of **Backup & restore**, in the **Environment** section. Each row shows **Set in .env** or **Default**. The database address is shown without the user name and password.

### How a new database is filled

`npm run db:setup` creates empty tables. The first time the app opens an empty database, it fills it:

1. **`SEED_DEMO_DATA=true`** (the default): the demo site is loaded (8 demo members on `@learnloop.test`, demo courses such as "Modern JavaScript Fundamentals", batches, payments and more).
2. **`SEED_DEMO_DATA=false`**: an empty site with one admin. The admin is built from `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` and gets the Admin, Moderator, Course Creator and Evaluator roles. If `ADMIN_EMAIL` or `ADMIN_PASSWORD` is missing, the server stops with "SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD in your .env file". The password must be at least 8 characters.

The server log then prints `[store] filled the new database at …`.

### Moving data from an older version

Older versions of the app kept the records in a file: `storage/lms.sqlite`, or before that `storage/db.json`. The app no longer reads these files. Copy them into the new, empty PostgreSQL database once:

1. Stop the old app.
2. `npm run db:setup` (creates the tables).
3. `npm run db:to-postgres -- --dry-run` to check, then `npm run db:to-postgres`. It reads `storage/lms.sqlite`, else `storage/db.json`, else the newest `storage/db.json.migrated-*` file; give another file as `npm run db:to-postgres -- path/to/file`.
4. Start the new version.

The copy refuses a database that already holds data (add `--force` to replace it), checks the record counts before it saves, and never changes or deletes the old file. Settings from the old version (`DB_DRIVER`, `SQLITE_PATH`, `DATA_FILE`) are no longer used: remove them from `.env` (the server warns while they are there).

### Good to know

- **One server process per database.** The app keeps the whole database in memory and writes only the changed records, one transaction per save. Run a single server process: one `npm start`, no cluster mode, no second copy of the app and no serverless instance on the same database. A second process would only notice the other's changes by reloading everything, and edits made at the same moment can overwrite each other.
- **Choose a database region close to the app server.** Every save is a round trip to the database.
- **Database changes on upgrade** (new tables or columns) are applied by `npm run db:setup`, or automatically by the Docker image when it starts.
- **Supabase plans.** The Free plan has a 500 MB database, no automatic backups, and pauses a project after a week without activity. A live school should use the Pro plan (daily backups kept 7 days). See [supabase.com/pricing](https://supabase.com/pricing).

---

## 2. Backups and restore

### What it is

The **Backup & restore** page makes complete copies of the database as JSON files (exports of every record and the settings), lets you download them, restore one, upload a backup file from your computer, check the database and, if you want to start over, reload the demo content. A copy is also made automatically once a day. These backups are written to the app server's disk (`storage/backups/`).

Supabase keeps backups of its own as well, on its paid plans (**Database → Backups** in the Supabase dashboard: daily, kept 7 days on Pro; point-in-time recovery is a paid add-on). The two complement each other: the app's backups can be downloaded and restored from this page, Supabase's are restored in the Supabase dashboard.

### Who can use it

Admins only. Every backup action is rate limited per admin (for example 12 new backups and 6 restores per 10 minutes) and recorded in the audit log. Backups contain password hashes, sessions and payment records, so treat downloaded files as confidential.

### Where

**Admin → Settings → Backup & restore** (`/admin/settings/data`), in the **Data** group of the settings menu.

### What the page shows

- **Notices at the top**, when they apply: "Recent changes could not be saved to the database", "The last automatic backup failed", "No backup in the last two days" / "There is no backup yet", "Automatic backups are turned off", and always "Two kinds of backups protect your data" (the app's JSON backups and Supabase's own).
- **Four cards:** **Records** (how many records in how many collections), **Database size**, **Latest backup**, **Uploads** (size of the uploads folder, with the note "not in backups").
- **Backups:** the list of stored backups, with buttons to create, download, upload and restore, and the folder they are stored in.
- **Database:** *PostgreSQL* with the server version and the number of migrations, the database address (without user name and password) and its size, what happened since the server started (records written, saves, last save), and the **Integrity check**.
- **Records per collection:** how many members, courses, lessons, payments and so on the database holds.
- **Running in production:** short reminders about single-process use, how large a school one server handles, keeping the storage folder on a persistent disk, off-site copies and the command-line tools.
- **Environment:** the values of `DATABASE_URL` (shown without user name and password), `STORAGE_DIR`, `DB_AUTO_BACKUP`, `DB_BACKUP_KEEP`, `UPLOAD_DIR`, `MAX_VIDEO_UPLOAD_MB`, `MAX_FILE_UPLOAD_MB` and `SEED_DEMO_DATA`.
- **Reload demo data** (a red card at the bottom).

### Kinds of backup

| Kind (badge) | Made by | Name example | How many are kept |
|---|---|---|---|
| **Automatic** | The server, once a day | `lms-20261002-auto.json` | The newest 14 (`DB_BACKUP_KEEP`) |
| **Manual** | An admin ("Create backup now") or `npm run db:backup` | `lms-20261002-141530-manual.json` | All, until you delete them |
| **Safety** | The app, just before a restore or a demo reload | `lms-20261002-141812-safety.json` | The newest 10 |
| **Uploaded** | An admin ("Restore from a file") | `lms-20261002-142003-upload.json` | The newest 5 |

Each backup has a small `.manifest.json` file next to it with the record counts, the note and who made it.

### How to create a backup

1. Open **Backup & restore**.
2. Click **Create backup now**.
3. In **Create a backup**, type an optional **Note** (for example "Before importing members"). It is shown in the list.
4. Click **Create backup**. The site keeps working while the copy is made.

### How to download a copy

- **A stored backup:** click the download icon on its row. The file comes from `/api/admin/backup/<backup name>`.
- **The live data right now (without storing a copy on the server):** click **Download current data**. You get a JSON export named like `learnloop-backup-20261002-141530.json`, from `/api/admin/backup`.

### How to restore a backup

1. On the backup's row click **Restore** (or open **⋯ → What is in it** and click **Restore…**).
2. The dialog **Restore this backup?** reads the backup and shows **What changes**: for each collection the number of records **Now** and **After**. Read any **Before you continue** warnings.
3. Type `RESTORE` (in capitals) in the confirmation box.
4. Click **Restore backup**.

What happens: the current data is first saved as a **Safety** backup, then everything in the database is replaced in one transaction. Everyone is signed out. If your own account exists in the restored data you stay signed in and return to the page with a message such as "Restored N records … The previous data is kept as …". Otherwise you are sent to the sign-in page. Other admins get a notification. To undo a restore, restore the safety backup.

### How to restore from a file on your computer

1. In **Restore from a file**, click **Choose file**.
2. Pick a `.json` backup or export made by this app, up to 2 GB. (A `.sqlite` file from an older version is not accepted here: copy it with `npm run db:to-postgres`, section 1.)
3. The file is uploaded and checked. It appears in the list as **Uploaded**, and the restore dialog opens.
4. Review what it contains and confirm with `RESTORE` as above. Nothing is replaced until you confirm.

### Other actions in the list

- **Filter chips:** All, Automatic, Manual, Safety, Uploaded (with counts). **Search by name or note.**
- **⋯ → What is in it:** kind, note, who made it, schema version and the record count per collection.
- **⋯ → Delete**, or tick several rows and click **Delete selected**. Deleted backups are gone for good; download them first if you may need them.

### The automatic daily backup

- It starts about 20 seconds after the **first request of each day** (server's local time). If nobody visits the site on a given day, no automatic backup is made that day.
- The day's file is always called `lms-YYYYMMDD-auto.json`, so restarts never make a second one.
- If it fails, it is tried again within the hour, and the page shows "The last automatic backup failed".
- For a site that may go a day without visitors, schedule the command `npm run db:backup -- --auto` (see [Scheduled jobs](#7-scheduled-jobs)).

Settings:

| Variable | Default | Meaning |
|---|---|---|
| `DB_AUTO_BACKUP` | `true` | `false` (or `0`, `no`, `off`) turns the daily backup off. |
| `DB_BACKUP_KEEP` | `14` | How many automatic backups are kept (1 to 3650). Manual backups are never deleted automatically. |

### Integrity check

In the **Database** section, **Integrity check** checks that the PostgreSQL server answers and that every table exists (**Quick check**). **Full check** also confirms that each record's id and indexed columns match the record. The result reads "No problems found (quick check, N ms)" or "The check found problems" with recovery advice.

### Reload demo data

The red **Reload demo data** card replaces everything (members, courses, progress, payments and settings) with the original demo content.

1. Click **Reload demo data**.
2. Type `RESET` (in capitals).
3. Click **Reload demo data** in the dialog.

The current data is saved as a **Safety** backup first, so you can restore it. Everyone is signed out; demo accounts use the password `password123`. If the site was started with `SEED_DEMO_DATA=false`, the card warns you that your admin account from `.env` will be gone after the reload.

### Command-line tools

Run these in the project folder on the server. They use the database in `DATABASE_URL` and work while the app is running. The `--` after the script name passes the options to the script.

| Command | What it does |
|---|---|
| `npm run db:setup` | Creates or updates the database tables (`prisma migrate deploy`; needs `DIRECT_URL`). Run it after every upgrade. |
| `npm run db:backup` | Makes a manual backup (a JSON export) in `storage/backups/` and prints its name. |
| `npm run db:backup -- --auto` | Makes today's automatic backup if it does not exist yet and deletes automatic backups beyond `DB_BACKUP_KEEP`. Use this from a scheduler. |
| `npm run db:backup -- --note "before upgrade"` | Manual backup with a note. |
| `npm run db:backup -- --out copy.json` | Writes the export to a file of your choice instead of the backups folder. |
| `npm run db:backup -- --list` | Lists the existing backups. |
| `npm run db:backup -- --json` | Prints the result as JSON (for scripts). |
| `npm run db:restore -- latest --dry-run` | Checks the newest backup and shows what would change, without writing anything. |
| `npm run db:restore -- latest --force` | Restores the newest backup. A database that already holds data (every live site) is only replaced with `--force`. Asks for confirmation. |
| `npm run db:restore -- lms-20261001-auto.json --force` | Restores a named backup from `storage/backups/`. |
| `npm run db:restore -- ../downloads/export.json --force` | Restores any JSON export by path. |
| `npm run db:restore -- latest --force --yes` | Restores without asking (for scripts). |
| `npm run db:restore -- latest --force --no-safety-backup` | Skips the safety copy of the current data (not recommended). |
| `npm run db:restore -- <backup> --force --allow-no-admin` | Restores even when the backup has no enabled administrator. |
| `npm run db:export` | Writes every record and the settings as one JSON file into `storage/backups/` (listed on the admin page). |
| `npm run db:export -- --out export.json` | Exports to a file of your choice (it must not exist yet). |
| `npm run db:export -- --stdout` | Prints the JSON to the screen (for piping, e.g. `| gzip > export.json.gz`). |
| `npm run db:export -- --compact --counts` | No indentation; also prints the record count per collection. |
| `npm run db:to-postgres` | Copies an older version's SQLite or JSON database into an empty PostgreSQL database (section 1). |

Add `-h` to any of them for its help text, and `--url <connection string>` to use another database than `DATABASE_URL`. Set `DEBUG=1` to print a full error trace when a script fails. The scripts read `.env` themselves, so they use the same `DATABASE_URL` and `STORAGE_DIR` as the app. With Docker, run them inside the container: `docker compose exec app node scripts/db-backup.mjs --list`.

A restore from the command line also saves a safety backup first. A running app reloads the restored data by itself within a few seconds; stopping the app first is still the safest choice.

### The backup API routes (for reference)

These are used by the page; they need an admin session in the browser (not an API key) and refuse requests from other sites.

| Route | Purpose |
|---|---|
| `GET /api/admin/backup` | Download the live data as a JSON export. |
| `GET /api/admin/backup/<name>` | Download a stored backup. |
| `POST /api/admin/backup/upload` | Upload a backup file (body = the file, header `X-File-Name`). |

### If the database cannot be reached or its data is wrong

Signs: pages fail to load, `/api/health` answers `503`, the server log shows database errors, or the page warns "Recent changes could not be saved to the database".

1. Check that the Supabase project is running (a Free-plan project pauses after a week without activity; restore it from the Supabase dashboard) and that `DATABASE_URL` in `.env` is still correct (for example after a database password change).
2. If the tables are missing (the log says so and names `npm run db:setup`), run `npm run db:setup`.
3. If the data itself is wrong or lost: see what you have with `npm run db:backup -- --list`, check the newest with `npm run db:restore -- latest --dry-run`, then restore it with `npm run db:restore -- latest --force` (or name an older backup). With Docker: `docker compose stop app`, then `docker compose run --rm --no-deps app node scripts/db-restore.mjs latest --force --yes`, then `docker compose start app`. On a paid Supabase plan you can instead restore one of Supabase's own backups in its dashboard and restart the app.

### Off-site copies

The app's backups sit on the app server's disk, so a lost server loses them. Copy `storage/` (or at least `storage/backups/`, and `storage/uploads/` unless uploads are in S3) to another place every night. [DEPLOYMENT.md, section 6](../../DEPLOYMENT.md#6-backups-and-restores) has a ready-made `rclone` example. Keep at least 30 days of copies and encrypt them: they contain personal data. Test a restore before launch and a few times a year.

---

## 3. Audit log and personal-data requests

### What it is

The **Audit log** records who changed what, and when: settings changes, role changes, account changes, refunds, certificates, backups and restores, data downloads, API keys, changes made through the API and many more sensitive actions. Its second tab, **Data requests**, lists members' "Download my data" and account-deletion requests and lets you carry out such a request on a member's behalf (GDPR requests that arrive by email or letter).

### Who can use it

Admins only. The members themselves make their own requests from **Settings → Privacy & data** (`/settings/privacy`): **Download my data** and **Delete my account** (see the learner guide).

### Where

**Admin → Settings → Audit log** (`/admin/audit`), in the **Legal & compliance** group. The **Data requests** tab is `/admin/audit?tab=requests`. The page header has a **Legal settings** button that opens `/admin/settings/legal`.

### The Activity tab

At the top are four cards: **Events (24 hours)**, **Events (7 days)**, **People who acted** and **Kept for** (the retention period).

Filters (they apply as you change them and are kept in the address, so you can bookmark or share a filtered view):

| Filter | What it does |
|---|---|
| Search box ("Search action, member, id or IP") | Free text over the action, the member's name or email, record ids and IP addresses. |
| **Anyone** | Only events done by one member, or **System** for automatic events (for example "Old records purged"). |
| **Any action** | One action, or "All … actions" for a whole group (for example all API actions). |
| **Any target** | Only events about one kind of record (course, member, payment, settings …). |
| **From** / **To** | A date range. |
| **Clear filters** | Back to everything. |

The table shows **When**, **Action** (a plain-language label with the technical code underneath, such as `user.roles`), **Done by**, **Target** and **IP address**. 50 events per page; use **Newer** and **Older** to move between pages.

**Details.** Click an event to open the **Audit event** panel: **When**, **Done by** (links to the member), **Target** (links to the record when possible, with a copy button), **IP address** (or "Not recorded"), **Event id**, the extra **Details** recorded with it (for example the backup name or the API key used) and **Related** links: "Everything done by …", "Every event for this …", "Every '…' event" and "Everything from <IP>".

Example: to see every change made through the REST API, open `/admin/audit?action=api.*` (the **API & webhooks** page links to it with **View all**).

**Export.** Click **Export CSV** to download the events that match the current filters (`audit-log-YYYY-MM-DD.csv`, from `/admin/audit/export`). The file opens correctly in Excel and Google Sheets. Every export is itself recorded as "Audit log exported".

### The Data requests tab

**Requests received by email or letter** has two tools:

**Download a member's data**

1. Under **Member**, pick the member.
2. Click **Download data**. You get the same JSON file the member would get from **Download my data**.
3. Send it to the member over a secure channel.

You can make up to 30 such downloads per hour. The member is told that their data was downloaded.

**Erase a member's account**

1. Click **Erase an account…**.
2. Pick the **Member**, enter **Your password**, and type `DELETE`.
3. Click **Erase account**.

This removes their personal data exactly like "Delete my account": orders keep their amounts and invoice numbers, and their posts show "Deleted user". It cannot be undone; the member is signed out everywhere and gets a confirmation email, and other admins are notified. It is refused when the member is the only administrator, or when they still have a membership that is billed automatically (cancel it first). You cannot erase your own account here; use **Settings → Privacy & data** for that.

Below the tools is the list of requests: filter chips **All**, **Data downloads**, **Account deletions**, a search box ("Search member or request id"), **Export CSV** (`data-requests-YYYY-MM-DD.csv`), and a table with **Requested**, **Member**, **Type**, **Status**, **Completed** and **View event** (opens the matching audit event). Requests are carried out immediately, so they show as **Completed**.

### Settings that affect it

**Retention.** **Admin → Settings → Legal pages** (`/admin/settings/legal`), section **Cookies and data retention**, field **Keep logs for** (default 365 days, allowed 30 to 3650). Audit events, error reports and cookie-consent records older than this are deleted automatically. Consent records are always kept at least a year. The clean-up runs by itself at most every few hours (when an event is recorded or the audit or error page is opened) and is recorded as "Old records purged".

Separate fixed retention periods: the webhook delivery log keeps 30 days, sent emails in the outbox are deleted after 90 days.

### Good to know

- Events never store passwords, secrets or request bodies; they keep ids and small details.
- IP addresses are only known when `TRUST_PROXY_HOPS` is set correctly (see [Security](#5-security-sessions-cookies-and-secrets)). When members delete their own account, no IP is stored with the event.
- A restore replaces the audit log with the one in the backup, then records the restore itself.

---

## 4. Error log and health check

### Error log

#### What it is

A list of errors the site ran into, grouped by message and page: failed page loads, API routes and server actions on the server, and errors visitors saw in their browser. Each group shows how often it happened. Admins get an in-app notification for each new error. A resolved error opens again if it happens again. The top of the page also shows the **start-up configuration checks**.

#### Who can use it

Admins only.

#### Where

**Admin → Settings → Error log** (`/admin/errors`), in the **Legal & compliance** group. One error: `/admin/errors/<id>`.

#### How to use it

1. Read the box at the top. Either "All startup configuration checks passed", or a list of warnings and errors about environment variables (for example `TRUST_PROXY_HOPS` or `MAIL_TRANSPORT`). Fix them in `.env` and restart the server; the box is updated at start-up.
2. Look at the cards: **Open errors** (and how many came from browsers), **Occurrences (open)**, **New in 24 hours**, **Last error**.
3. Pick a status tab: **Open**, **Resolved** or **All**. Search ("Search message, page or reference") or choose **Source**: **Server only** or **Browser only**.
4. Click an error to see its details page: the **Stack trace**, **Details** (**Page or route**, **Source**, **First seen**, **Last seen**, **Occurrences**, **Reference (digest)**, **Last affected member**) and **History** (who resolved or reopened it).
5. When you have fixed the cause, click **Mark resolved** (or **Reopen**). **Delete** removes the group.
6. To work on several at once, tick them in the list and use **Resolve**, **Reopen** or **Delete**. **Delete resolved** in the header removes all resolved groups.
7. **Health check** in the header opens `/api/health` in a new tab.

When a visitor sees an error page, it shows a reference code (the "digest"). Search for that code in the error log to find the exact error.

#### Good to know

- Request bodies, query strings and cookies are never stored; only the path, method and (if signed in) which member was affected.
- Errors not seen for the retention period (**Keep logs for**, default 365 days) are deleted automatically.
- Browser error reports are limited per visitor so the log cannot be flooded.

### Health check: `/api/health`

#### What it is

A public address that reports whether the server is healthy, for Docker, load balancers and uptime monitors (UptimeRobot, Better Stack and similar).

#### Who can use it

Anyone; it shows no configuration values or personal data.

#### How to use it

Open `http://localhost:3000/api/health`, or run:

```sh
curl -s http://localhost:3000/api/health
```

Example answer:

```json
{
  "status": "degraded",
  "version": "0.1.0",
  "uptimeSeconds": 5321,
  "checkedAt": "2026-10-02T09:15:00.000Z",
  "checks": {
    "database": { "ok": true, "ms": 18 },
    "storage": { "ok": true, "ms": 4 },
    "ffmpeg": { "ok": false, "ms": 12, "detail": "not found — videos are served as MP4 without adaptive streaming" }
  }
}
```

| `status` | HTTP code | Meaning |
|---|---|---|
| `ok` | 200 | Database answers, storage folders are writable, ffmpeg is installed. |
| `degraded` | 200 | Everything works, but ffmpeg is missing, so videos are not converted to adaptive streaming. |
| `error` | 503 | The database or the storage folders are failing. |

`version` is `APP_VERSION` when set (the Docker build sets it), otherwise the version in `package.json`. Results are cached for 5 seconds (the ffmpeg check for 5 minutes). `HEAD /api/health` works too. The Docker image uses it as its `HEALTHCHECK`.

---

## 5. Security: sessions, cookies and secrets

This section explains the security settings that live in `.env` and in code. The settings you change in the browser (email confirmation, two-step verification, sign-in lockout, password length) are on **Admin → Settings → Security** (`/admin/settings/security`) and are described in [part 1](04-admin-people-and-money.md).

### Security headers

Every page and API response is sent with these headers (set in `next.config.ts`; you do not need to add them in Caddy or nginx):

| Header | Value / purpose |
|---|---|
| `Content-Security-Policy` | Only this site's own scripts plus Razorpay checkout, Google Tag Manager and the Meta Pixel (the last two load only after cookie consent). Forms may post only to this site and Stripe Checkout. Frames: this site and `https:` pages (PDF previews). `object-src 'none'`, `frame-ancestors 'self'`. `'unsafe-eval'` is allowed because the programming-exercise runner needs it. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` (other sites cannot embed your pages) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation and topics off; fullscreen and picture-in-picture for this site only |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |
| `X-DNS-Prefetch-Control` | `on` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` — **production only** (browsers then use HTTPS only for a year) |

The `X-Powered-By` header is switched off. The Caddyfile also removes Caddy's `Server` header.

### Cookies

| Cookie | Purpose | Lifetime |
|---|---|---|
| `ll_session` (name set by `SESSION_COOKIE_NAME`) | Keeps you signed in. httpOnly, SameSite=Lax, Secure when `COOKIE_SECURE` is on. | `SESSION_DAYS` (30 days) |
| `ll_session_2fa` (session cookie name + `_2fa`) | Carries you from the password step to the two-step code step. | 10 minutes |
| `ll_flash` | One-time messages after a redirect ("Backup restored"). | 60 seconds |
| `ll_consent` | Your cookie-banner choices (analytics, marketing). | 1 year |
| `ll_anon` | Random visitor id with no personal data. It backs up cookie-consent choices and links referral clicks to later sign-ups and purchases. | 1 year |
| `ll_ref` | Affiliate referral code from a `?ref=CODE` link. | Up to 1 year (per affiliate settings) |
| `ll_locale` | Chosen interface language. | 1 year |
| `ll_currency` | Chosen display currency. | 1 year |
| `ll_unsub` | Short receipt after a one-click unsubscribe, so the result page can show without signing in. | Short |

The light/dark theme choice is stored in the browser's local storage, not in a cookie.

### Sessions and session length

- Signing in creates a session that lasts **`SESSION_DAYS`** days (default 30). The database stores only a SHA-256 hash of the session token, so a copy of the database cannot be used to sign in.
- Changing `SESSION_DAYS` affects sessions created after the restart; existing sessions keep the end date they got at sign-in.
- Changing `SESSION_COOKIE_NAME` signs everybody out (their browsers still hold the old cookie name).
- Members can sign out their other devices from their own security settings; admins can use **Sign out everywhere** for a member on **Login activity** (`/admin/security`).
- Restoring a backup or reloading demo data signs everyone out.

### `COOKIE_SECURE`

When on, the sign-in cookie is sent only over HTTPS. It is **on by default in production** (`NODE_ENV=production`) and off in development. Leave it unset on a real site. Set `COOKIE_SECURE=false` only to test a production build over plain `http://` on a local network; otherwise you cannot stay signed in there. The start-up check warns if a production site with an `https://` address has `COOKIE_SECURE=false`.

### `APP_SECRET`: why it matters

`APP_SECRET` is a long random value (at least 32 characters) that the server uses to sign and encrypt things. Create one with:

```sh
openssl rand -hex 32
```

(On Windows without OpenSSL, in PowerShell: `-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})`, or any password manager's generator with 64 characters.)

It is used for:

- signing protected video URLs;
- encrypting each member's two-step verification secret;
- encrypting webhook signing secrets;
- signing unsubscribe links, email open/click tracking links, lead confirmation and unsubscribe links, and personal calendar feed URLs;
- deriving the **cron key** used by the scheduled jobs.

**In production it is required.** If it is missing or shorter than 32 characters, the server refuses to start. **In development**, if you leave it empty, one is generated and saved in `storage/.app-secret`, so it survives restarts.

**What breaks if it changes:**

| What | Effect | Fix |
|---|---|---|
| Two-step verification | Members' authenticator codes **and** their recovery codes stop working (both are keyed from the secret). | An admin opens **Admin → Settings → Login activity** (`/admin/security`), searches for the member and clicks **Reset two-step verification**; the member then sets it up again. Your own admin account is affected too, so keep a second admin who can reset you, or turn your own two-step verification off before you change the secret. |
| Webhook endpoints | Deliveries fail with "The signing secret could not be read (APP_SECRET changed …)". | Open each endpoint and click **Roll secret**, then update the receiver. |
| Cron key | Your scheduler gets `401 Unauthorized`. | Copy the new key from **Admin → Settings → Email** into the scheduler (and `CRON_KEY` with Docker). |
| Unsubscribe and tracking links in emails already sent, lead confirmation links, calendar feed URLs | They stop working. | Members re-subscribe to calendar feeds from their settings. |
| Protected video links already open | Expire; the player fetches new ones. | Nothing to do. |

Passwords and sign-in sessions are **not** affected. Set `APP_SECRET` once, store it in a password manager together with the rest of `.env`, and copy the same value when you move to a new server.

`QUIZ_ATTEMPT_SECRET` is a separate signing key for quiz attempts in progress. If unset, one is generated and stored in `storage/.quiz-attempt-key`. Changing it only affects quizzes that are being taken at that moment.

### `TRUST_PROXY_HOPS`: real visitor IP addresses

Sign-in, password reset, sign-up, contact forms, error reports and API key guessing are rate limited **per visitor IP**, and the IP is shown in the login history, security emails and audit log. Behind a reverse proxy (Caddy, nginx, a load balancer, Cloudflare) every request seems to come from the proxy, so the app reads the visitor's IP from the `X-Forwarded-For` header, counting `TRUST_PROXY_HOPS` entries from the right.

| Value | When to use it |
|---|---|
| `0` (default) | The app is reached directly (local development). No proxy header is trusted: IPs show as unknown and all visitors share one rate-limit bucket (the per-email limits still apply). |
| `1` | One reverse proxy (Caddy, nginx, one load balancer). `docker-compose.yml` sets this for you. |
| `2` | A CDN or load balancer in front of your proxy (for example Cloudflare in front of Caddy). |

Never set it higher than the real number of proxies: visitors could then fake their IP and get around rate limits. In production the start-up check warns when it is `0`.

---

## 6. Going live

### What it is

The steps to move from `http://localhost:3000` on your own computer to a real address such as `https://learn.example.com` that anyone can reach. The full technical walkthrough, with every command, is in [DEPLOYMENT.md](../../DEPLOYMENT.md). This section summarises it so you know what is involved.

### Who does it

The server owner or a developer with access to the server. Admins then finish the checklist inside the site.

### What you need

- **A server.** A small VPS (2 vCPU, 4 GB RAM, 40 GB disk) runs a school with thousands of learners. Video conversion is the only heavy job.
- **A PostgreSQL database:** a Supabase project in the region nearest your students (section 1), or the optional local PostgreSQL container from `docker-compose.yml`.
- **For uploads (recommended):** an AWS account with an S3 bucket (see [Uploads in AWS S3](#uploads-in-aws-s3) below).
- **A domain** (or sub-domain, such as `learn.example.com`) whose DNS `A`/`AAAA` record points at the server.
- **Ports 80 and 443 open** to the internet (needed for the free HTTPS certificate).
- **Either** Docker Engine 24+ with the Compose plugin (v2.23+ for the optional cron service), **or** Node.js 24, ffmpeg and a reverse proxy for HTTPS (Caddy or nginx).

### What is in the repository

| File | What it does |
|---|---|
| `Dockerfile` | Builds the production image on Node 24 (slim), with ffmpeg, ffprobe, CA certificates and `tini`. Runs as the non-root `node` user, listens on port 3000, keeps its files (backups, SEO files, local uploads) in the `/app/storage` volume and checks `/api/health` every 30 seconds. On every start it first runs `prisma migrate deploy` (the same as `npm run db:setup`) and stops with a clear message when `DATABASE_URL` is missing; `MIGRATE_ON_START=false` skips the migrations. Includes the backup scripts. |
| `docker-compose.yml` | Starts the **app** and **Caddy** (automatic HTTPS). Passes `DATABASE_URL` and `DIRECT_URL` from `.env` (and refuses to start without `DATABASE_URL`), sets `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, `STORAGE_DIR` and `UPLOAD_DIR` for you. The app is not exposed directly; only Caddy talks to it. Optional **cron** service (`--profile cron`) that calls the scheduled jobs, and optional local **postgres** service (`--profile postgres`) for people without Supabase. Keeps files in the `learnloop_storage` volume. |
| `Caddyfile` | Gets and renews the certificate for `DOMAIN` (Let's Encrypt / ZeroSSL), redirects `http://` to `https://` and `www.` to the main domain, compresses responses, and proxies to the app with 30-minute timeouts so long video uploads are not cut off. |
| `.env.example` | Template for `.env` with every setting and a comment for each. |

### Steps with Docker (recommended)

1. **Create the database:** a Supabase project and its two connection strings (section 1).
2. **Install Docker** on the server (Ubuntu/Debian): `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker "$USER"` and log in again.
3. **Get the code:** `git clone <your repository URL> learnloop && cd learnloop`.
4. **Create `.env`:** `cp .env.example .env`, then run `openssl rand -hex 32` and paste the result as `APP_SECRET`. Fill in at least:

   ```ini
   APP_URL=https://learn.example.com
   APP_SECRET=<64 hex characters>
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
   DIRECT_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DOMAIN=learn.example.com
   ACME_EMAIL=you@example.com
   SEED_DEMO_DATA=false
   ADMIN_NAME=Your Name
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<a long password>
   MAIL_TRANSPORT=smtp
   SMTP_HOST=...
   ```

   Add SMTP, Stripe/Razorpay, S3 and other keys as needed (see the [environment variable table](#8-every-environment-variable)).
5. **Start it:** `docker compose up -d --build`, then `docker compose logs -f app`: you see "applying database migrations", then "Ready". If the app refuses to start, the log lists the missing settings.
6. **Open `https://learn.example.com`.** Caddy gets the certificate on the first visit (usually within seconds).
7. **Sign in** with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, change the password and turn on two-step verification.
8. **Turn on the scheduler:** copy the cron key from **Admin → Settings → Email** (the part after `key=` in the **Cron URL**), add `CRON_KEY=<key>` to `.env`, then run `docker compose --profile cron up -d`.
9. Work through the [pre-launch checklist](#pre-launch-checklist).

Useful commands: `docker compose ps` (the app shows `healthy`), `docker compose logs -f app`, `docker compose restart app`, `docker compose exec app sh`, and a manual backup with `docker compose exec app node scripts/db-backup.mjs`. **Never run `docker compose down -v`**: `-v` deletes the volumes, including the backups and local uploads (and, with the local `postgres` profile, the database itself).

### Steps without Docker

- **Linux with systemd:** install Node.js 24 and ffmpeg, create a `learnloop` user, clone the code, fill in `.env` (with `DATABASE_URL`, `DIRECT_URL`, `TRUST_PROXY_HOPS=1` and absolute `STORAGE_DIR` and `UPLOAD_DIR` paths outside the project), run `npm ci`, `npm run db:setup` and `npm run build`, copy `public/` and `.next/static/` next to the standalone server (into `.next/standalone/`), create the `learnloop.service` unit shown in DEPLOYMENT.md (it runs `node .next/standalone/server.js` with `NODE_ENV=production`), then put Caddy or nginx in front for HTTPS.
- **Windows or Linux with pm2:** `npm ci && npm run db:setup && npm run build`, copy the static files as above, `pm2 start .next/standalone/server.js --name learnloop`, `pm2 save`. pm2 does not read `.env` by itself: export the variables first or use an `ecosystem.config.cjs`. On Windows install ffmpeg with `winget install Gyan.FFmpeg` and run Caddy for Windows in front.
- With nginx, allow large uploads (`client_max_body_size 0;`) and long requests (`proxy_read_timeout 1800s;`), and forward `X-Forwarded-For`, `Host` and `X-Forwarded-Proto`.

### HTTPS and the address

- `APP_URL` must be the final `https://` address without a trailing slash. In production the server **refuses to start** if `APP_URL` uses `http://` (except for `localhost`). It is used in emails, payment return and webhook URLs, calendar feeds, canonical links and the sitemap.
- `SEO_CANONICAL_HOST` controls host redirects: unset = only the `www` twin of your address is redirected; `all` = every other host name is redirected (only when your proxy forwards the visitor's `Host` header); `off` = no host redirects.
- Remove the `www.{$DOMAIN}` block from the `Caddyfile` if you do not point `www` at the server; otherwise Caddy cannot get a certificate for it.

### Volumes and files to keep

The records are in the PostgreSQL database (Supabase). Everything else the app stores is in **one folder**, `storage/` (`STORAGE_DIR`; inside Docker, the `learnloop_storage` volume mounted at `/app/storage`): backups, `storage/seo/` and, unless they are in S3, the uploads and generated video renditions. It must be writable by the app and must survive restarts and upgrades. To move to a new server, point it at the same database (same `DATABASE_URL` and `DIRECT_URL`), copy the `storage/` folder and use the same `.env` (with the **same `APP_SECRET`**).

### Uploads in AWS S3

On a live site, store uploads in an AWS S3 bucket rather than on the server's disk: set `STORAGE_DRIVER=s3`, `S3_REGION` (for example `ap-south-1`), `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, leave `S3_ENDPOINT` empty, restart, and click **Test connection** in **Admin → Settings → Storage & video**. The step-by-step guide (AWS account and free-tier rules, a $1 budget alert, a private bucket, a lifecycle rule for interrupted uploads, a user that can only use that bucket, and cost notes) is in [ENV-SETUP.md](../../ENV-SETUP.md), section 4, and [DEPLOYMENT.md](../../DEPLOYMENT.md), section 9. The browser never talks to the bucket, so it needs no CORS rules.

### ffmpeg

ffmpeg turns uploaded lesson videos into adaptive HLS streams, reads their length and makes thumbnails. It is already in the Docker image. Without Docker: `sudo apt-get install -y ffmpeg` (Debian/Ubuntu), `brew install ffmpeg` (macOS) or `winget install Gyan.FFmpeg` (Windows), or set `FFMPEG_PATH` and `FFPROBE_PATH` to the program files. Check with `ffmpeg -version` and on **Admin → Settings → Storage & video** (section **Video converter**, button **Check again**). Without ffmpeg videos still play as uploaded, and `/api/health` reports `degraded`.

### Backups on a live server

The daily automatic backup (a JSON export) runs inside the app. Use a Supabase plan with backups (Pro), add a nightly **off-site copy** of `storage/backups/` (see [Off-site copies](#off-site-copies)) and test one restore before launch.

### Demo data and demo accounts

- Set **`SEED_DEMO_DATA=false`** before the **first** start on the server. A new database is then empty apart from your admin account.
- `SEED_DEMO_DATA` only matters while the database is empty. If your live database already contains demo content, either:
  - **Start fresh (simplest):** stop the app, point `DATABASE_URL` and `DIRECT_URL` at a new, empty database (for example a new Supabase project), run `npm run db:setup` (Docker does it on start), set `SEED_DEMO_DATA=false` plus `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and start again; or
  - **Clean up by hand:** create your own admin account first, sign in with it, then in **Admin → Members** (`/admin/members`) delete the demo accounts (all addresses ending in `@learnloop.test`: admin, maya, daniel, priya, alex, sofia, liam, emma) and delete the demo courses, batches and other sample content.
- Demo accounts use the public password `password123`, so none may remain on a live site. In production the start-up check warns while `SEED_DEMO_DATA` is not `false`.
- Remove `LL_DEV_LOGIN` and `WEBHOOKS_ALLOW_PRIVATE_NETWORK` from a live `.env` (both are ignored in production anyway).

### Upgrading later

1. Make a backup (**Create backup now**, or `docker compose exec app node scripts/db-backup.mjs --note "before upgrade"`).
2. `git pull`.
3. Rebuild and restart: `docker compose up -d --build` (or `npm ci && npm run db:setup && npm run build`, copy the static files again, then restart the service).
4. Database changes are applied by `npm run db:setup`; the Docker image applies them by itself at start. Check `/api/health` and **Error log**.
5. After a release that changes gamification, open **Admin → Settings → Points & leaderboard** and click **Recalculate points** once.

### Pre-launch checklist

From [DEPLOYMENT.md, section 14](../../DEPLOYMENT.md#14-pre-launch-checklist), with where to do each item:

- [ ] Legal pages (privacy, terms, refunds, cookies) reviewed with a lawyer, edited and published in **Admin → Settings → Legal pages**. Cookie banner on if you use analytics or marketing pixels.
- [ ] `APP_SECRET` set to a long random value and stored safely with the rest of `.env`.
- [ ] `APP_URL` is the final `https://` address; `TRUST_PROXY_HOPS` matches the number of proxies.
- [ ] `DATABASE_URL` and `DIRECT_URL` point at the live database (Supabase, on a plan with backups), and **Backup & restore** shows *PostgreSQL*.
- [ ] Uploads go to AWS S3 (`STORAGE_DRIVER=s3`), **Test connection** in **Admin → Settings → Storage & video** is green, and the $1 AWS budget alert is set up.
- [ ] `SEED_DEMO_DATA=false`, and every demo account (`@learnloop.test`) and demo course removed.
- [ ] Admin password changed and two-step verification on for every administrator (**Admin → Settings → Security** can require it for staff).
- [ ] A test purchase with live keys made and refunded; the order, receipt email and enrollment appeared; the Stripe/Razorpay webhook shows successful deliveries.
- [ ] Test email sent from **Admin → Settings → Email** (**Send a test email**) and received (check spam and SPF/DKIM); a password reset tried end to end.
- [ ] A backup restore tested on a copy, and the nightly off-site copy running.
- [ ] HTTPS works on the domain, `www` redirects, and `http://` redirects to `https://`.
- [ ] Scheduled jobs running: queued messages in **Admin → Settings → Outbox** (`/admin/emails`) go out within a minute or two.
- [ ] `/api/health` returns `ok` and an uptime monitor watches it; **Error log** shows no open errors and "All startup configuration checks passed".
- [ ] Google Search Console set up and `https://<your domain>/sitemap.xml` submitted.

---

## 7. Scheduled jobs

### What it is

Some work should happen on a timetable even when nobody is using the site: sending queued emails and retries, webhook retries, scheduled broadcasts, video conversions, membership renewals and so on. Each job **also runs by itself while people use the site** (an in-process timer, or when the relevant admin page is opened), but after quiet periods or a restart a scheduler keeps them on time. The scheduler simply calls a URL.

### Who can use it

Anyone who has the **cron key**. Treat it like a password.

### The cron key

- There is **one key for all jobs**. It is derived from `APP_SECRET`, so it changes if `APP_SECRET` changes. The app has no separate environment variable for it.
- Find it on **Admin → Settings → Email** (`/admin/settings/email`), section **Scheduled delivery**, field **Cron URL**. The URL looks like `https://learn.example.com/api/cron/emails?key=AbC…xyz`; the key is the part after `key=` (43 letters, digits, `-` and `_`). Use the copy button next to it. **API & webhooks** also shows the webhook job URL with the key (under **Keep retries on time with a scheduler**).
- Send it either as a header, `Authorization: Bearer <key>` (preferred: it stays out of access logs), or in the address, `?key=<key>`.
- A wrong or missing key gets `401` with `{"ok":false,"error":"Unauthorized"}`.
- With Docker, put it in `.env` as `CRON_KEY=<key>`. Only `docker-compose.yml` reads `CRON_KEY` (for its cron service); the app itself does not.

### The jobs

All accept `GET` or `POST` and answer with a small JSON report.

| URL | Suggested schedule | What it does |
|---|---|---|
| `/api/cron/emails` | every minute | Sends queued emails and retries whose wait is over (retries after 1 min, 5 min, 30 min, 2 h, 12 h; marked failed after 6 attempts). Deletes sent emails older than 90 days. Optional `&limit=` (default 50, max 500 per run). |
| `/api/cron/webhooks` | every minute | Sends webhook deliveries that are due (new events and retries), cancels deliveries for endpoints that were switched off, deletes delivery-log entries older than 30 days. Optional `&limit=` (default 200, max 1000). |
| `/api/cron/comms` | every 1 to 5 minutes | Starts scheduled broadcasts, sends the next batches of broadcasts that are sending (within their per-minute limit), enrolls newly confirmed leads and inactive members in email sequences, sends the sequence emails that are due, refreshes campaign statistics and removes tracking events nothing refers to. |
| `/api/cron/media` | every 10 minutes (5 to 15 is fine) | Expires resumable uploads that have been idle for a day, queues uploaded lesson videos that still need HLS conversion and starts the converter, deletes old conversion jobs and HLS files no lesson uses, and with S3 storage moves files still on local disk to the bucket. |
| `/api/cron/commerce` | hourly | Keeps memberships current (manual memberships become "payment due" or end, renewal orders, trial-ending reminders, reads back Stripe/Razorpay renewals whose webhook seems missing), keeps installment plans current (reminders, pausing access, reading back missed charges), emails gifts scheduled for now, sends abandoned-checkout reminders (the last one with a single-use coupon) and closes finished checkouts, and folds old analytics events into daily totals. |

Two other things run on their own and need no URL: the **daily database backup** (first request of each day) and the **log retention clean-up** (every few hours).

### How to call a job by hand

```sh
curl -fsS -H "Authorization: Bearer YOUR_CRON_KEY" http://localhost:3000/api/cron/emails
```

Example answer:

```json
{"ok":true,"ran":true,"reason":null,"transport":"log","claimed":2,"sent":2,"retried":0,"failed":0,"durationMs":41,"error":null,"pruned":0,"outbox":{"queued":0,"sending":0,"sent":37,"failed":0}}
```

In Windows PowerShell type `curl.exe` (plain `curl` there is a different command):

```powershell
curl.exe -fsS -H "Authorization: Bearer YOUR_CRON_KEY" http://localhost:3000/api/cron/emails
```

### Linux: crontab

Run `crontab -e` and add (replace the key, the address and the project path):

```cron
KEY=YOUR_CRON_KEY
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/emails
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/webhooks
* * * * *    curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/comms
*/10 * * * * curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/media
17 * * * *   curl -fsS -o /dev/null -H "Authorization: Bearer $KEY" https://learn.example.com/api/cron/commerce
30 2 * * *   cd /opt/learnloop/app && npm run db:backup -- --auto > /dev/null
```

The last line makes the daily backup at 02:30 even if nobody visits the site.

### Docker: the built-in cron service

`docker compose --profile cron up -d` starts a small Alpine container that calls exactly the first five lines of that schedule over the internal network (`http://app:3000/...`), using `CRON_KEY` from `.env`. It does not run the backup command; for a nightly backup plus off-site copy see section 6 of DEPLOYMENT.md.

### Windows: Task Scheduler

1. Create a folder such as `C:\learnloop-cron` with three small files.

   `every-minute.cmd`:

   ```bat
   @echo off
   set KEY=YOUR_CRON_KEY
   set SITE=http://localhost:3000
   curl.exe -fsS -o NUL -H "Authorization: Bearer %KEY%" %SITE%/api/cron/emails
   curl.exe -fsS -o NUL -H "Authorization: Bearer %KEY%" %SITE%/api/cron/webhooks
   curl.exe -fsS -o NUL -H "Authorization: Bearer %KEY%" %SITE%/api/cron/comms
   ```

   `every-10-minutes.cmd`: the same first three lines, then `curl.exe -fsS -o NUL -H "Authorization: Bearer %KEY%" %SITE%/api/cron/media`.

   `hourly.cmd`: the same first three lines, then `curl.exe -fsS -o NUL -H "Authorization: Bearer %KEY%" %SITE%/api/cron/commerce`.

2. Open a Command Prompt and register them:

   ```bat
   schtasks /Create /TN "LearnLoop every minute" /SC MINUTE /MO 1 /TR "C:\learnloop-cron\every-minute.cmd"
   schtasks /Create /TN "LearnLoop every 10 minutes" /SC MINUTE /MO 10 /TR "C:\learnloop-cron\every-10-minutes.cmd"
   schtasks /Create /TN "LearnLoop hourly" /SC HOURLY /MO 1 /TR "C:\learnloop-cron\hourly.cmd"
   schtasks /Create /TN "LearnLoop daily backup" /SC DAILY /ST 02:30 /TR "cmd /c cd /d C:\path\to\lms && npm run db:backup -- --auto"
   ```

3. Check them in **Task Scheduler** (Start menu → Task Scheduler → Task Scheduler Library). To remove one: `schtasks /Delete /TN "LearnLoop hourly" /F`.

You can also use the Task Scheduler window: **Create Basic Task**, trigger **Daily**, action **Start a program** pointing at the `.cmd` file; then open the task's **Triggers** tab and set **Repeat task every** 1 minute (or 10 minutes, 1 hour) **for a duration of Indefinitely**.

### Good to know

- Without any scheduler the site still works: emails go out right after they are queued, and the jobs run while people use the site. The scheduler only makes retries and timed work punctual after quiet periods and restarts.
- **Admin → Settings → Email** shows **Last delivery run** and the **Outbox** counts, so you can see that the email job is running.

---

## 8. Every environment variable

### What it is

Server settings that are not edited in the browser live in a file called **`.env`** in the project folder (template: `.env.example`). The server reads them when it starts, so **restart the server after changing `.env`**. Everything else (branding, features, prices, legal pages) is under **Admin → Settings**.

### Start-up checks

When the server starts it checks the configuration (`src/lib/env-check.ts`):

- **Always** (also in development) it **refuses to start** without `DATABASE_URL`, with a message that points to ENV-SETUP.md, section 3 "Database".
- **In production** (`NODE_ENV=production`) it also **refuses to start** when: `APP_SECRET` is missing or shorter than 32 characters; `APP_URL` is missing, not a valid URL, or uses `http://` on a non-local address; `MAIL_TRANSPORT=smtp` without `SMTP_HOST`; `RAZORPAY_KEY_ID` without `RAZORPAY_KEY_SECRET`; `STORAGE_DRIVER=s3` without `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY`. The log says "Refusing to start: fix these settings in the environment (see ENV-SETUP.md and DEPLOYMENT.md)." followed by the list.
- Everything else is a **warning**, printed in the log as `[config] NAME: message` and shown at the top of **Admin → Settings → Error log**. Examples: `TRUST_PROXY_HOPS` is 0 in production, `SEED_DEMO_DATA` is not false, `MAIL_TRANSPORT` is not smtp, Stripe in test mode, a payment key without its webhook secret, `DIRECT_URL` missing, `DATABASE_URL` on port 6543 without `pgbouncer=true`, and old settings that are no longer used (`DB_DRIVER`, `SQLITE_PATH`, `DATA_FILE`).
- The checks never run during `npm run build`, so a build machine needs no secrets.

### The full table

"Required" means the site cannot work properly (or will not start in production) without it.

**Address, secrets and sessions**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `APP_URL` | Public address without a trailing slash. Used in emails, payment return/webhook URLs, calendar feeds, canonical links, the sitemap and API pagination links. | `http://localhost:3000` | Yes in production (`https://`). |
| `APP_SECRET` | Signs and encrypts (see [APP_SECRET](#app_secret-why-it-matters)). At least 32 characters. | Generated in development and stored in `storage/.app-secret` | Yes in production. |
| `QUIZ_ATTEMPT_SECRET` | Signs quiz attempts in progress. | Generated and stored in `storage/.quiz-attempt-key` | No |
| `SESSION_DAYS` | How long a sign-in lasts, in days. | `30` | No |
| `SESSION_COOKIE_NAME` | Name of the sign-in cookie. | `ll_session` | No |
| `COOKIE_SECURE` | `true`/`false`: send the sign-in cookie only over HTTPS. | `true` in production, `false` otherwise | No |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the app (for visitor IPs). | `0` | Yes behind a proxy (`1` with Caddy/nginx). |

**Database, files and first start**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `DATABASE_URL` | The PostgreSQL database (Supabase: the transaction pooler, port 6543, with `?pgbouncer=true&connection_limit=5`). See section 1. | empty | **Yes, always** (the app does not start without it). |
| `DIRECT_URL` | The connection `npm run db:setup` (and the Docker image) uses to create and update the tables (Supabase: port 5432). | empty | Yes for `npm run db:setup` |
| `STORAGE_DIR` | Folder for backups (`backups/`), SEO files (`seo/`) and generated secrets. An absolute path outside the project on a server without Docker. | `storage` | No |
| `DB_AUTO_BACKUP` | Daily automatic backup (a JSON export) on/off. | `true` | No |
| `DB_BACKUP_KEEP` | Automatic backups kept (1–3650). | `14` | No |
| `UPLOAD_DIR` | Folder for uploaded files when `STORAGE_DRIVER=local`. An absolute path outside the project on a server without Docker. | `storage/uploads` | No |
| `MAX_VIDEO_UPLOAD_MB` | Largest video upload in MB (uploads are chunked and resumable). | `10240` (10 GB) | No |
| `MAX_FILE_UPLOAD_MB` | Largest image, document or audio upload in MB. | `25` | No |
| `SEED_DEMO_DATA` | A new database starts with demo content (`true`) or empty with one admin (`false`). | `true` | Set `false` in production. |
| `ADMIN_NAME` | Name of the first admin when `SEED_DEMO_DATA=false`. | `Administrator` | No |
| `ADMIN_EMAIL` | Email of the first admin. | empty | Yes when `SEED_DEMO_DATA=false` and the database is empty. |
| `ADMIN_PASSWORD` | Password of the first admin (8+ characters). Change it after the first sign-in. | empty | Yes when `SEED_DEMO_DATA=false` and the database is empty. |
| `TEST_DATABASE_URL` | A throwaway PostgreSQL for `npm run test:pg` only; never a real site's database. | empty | No |

**Object storage (recommended on a live site: AWS S3)**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `STORAGE_DRIVER` | `local` (upload folder) or `s3` (an AWS S3 bucket, or another S3-compatible service: Cloudflare R2, Backblaze B2, MinIO). Step by step: [ENV-SETUP.md](../../ENV-SETUP.md), section 4. | `local` | No (`s3` recommended on a live site) |
| `S3_ENDPOINT` | Bucket endpoint; **empty for AWS S3**. | empty | For R2/B2/MinIO |
| `S3_REGION` | The bucket's region, e.g. `ap-south-1`. When empty or `auto` it is worked out from the endpoint, and falls back to `us-east-1`, so always set it for AWS. | `auto` | Yes for AWS |
| `S3_BUCKET` | Bucket name. | empty | Yes with `s3` |
| `S3_ACCESS_KEY_ID` | Access key. | empty | Yes with `s3` |
| `S3_SECRET_ACCESS_KEY` | Secret key. | empty | Yes with `s3` |
| `S3_PUBLIC_BASE_URL` | Optional `https://` CDN address (e.g. CloudFront) for unprotected files. Leave empty with a private bucket. | empty (every file goes through the app) | No |
| `S3_FORCE_PATH_STYLE` | `true` for path-style URLs (MinIO usually needs it). | `false` | No |

**Video, captions and AI (optional)**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `FFMPEG_PATH` | Path to the `ffmpeg` program. | `ffmpeg` (found on the PATH) | No |
| `FFPROBE_PATH` | Path to the `ffprobe` program. | `ffprobe` | No |
| `TRANSCRIBE_API_URL` | Whisper-compatible speech-to-text endpoint for automatic captions, e.g. `https://api.openai.com/v1/audio/transcriptions`. | empty (feature off) | No |
| `TRANSCRIBE_API_KEY` | Key for that endpoint. | empty | With `TRANSCRIBE_API_URL` |
| `TRANSCRIBE_MODEL` | Model name. | `whisper-1` | No |
| `ANTHROPIC_API_KEY` | Key for the AI tutor. It can only be set here; the **AI tutor** settings page only shows whether it is configured (masked). | empty (tutor hidden) | For the AI tutor |

**Email**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `MAIL_TRANSPORT` | `log` keeps emails in the outbox without sending them; `smtp` delivers them. | `log` | `smtp` in production |
| `SMTP_HOST` | SMTP server. | empty | Yes with `smtp` |
| `SMTP_PORT` | SMTP port. | `587` | No |
| `SMTP_SECURE` | `true` = TLS from the start (usually port 465); `false` = STARTTLS. | `false` | No |
| `SMTP_REQUIRE_TLS` | Refuse to send over an unencrypted connection to a remote server. Set `false` only for a trusted relay without TLS. | `true` | No |
| `SMTP_USER` | SMTP user name. | empty | Usually |
| `SMTP_PASS` | SMTP password. | empty | Usually |
| `MAIL_FROM` | Sender, e.g. `"Acme Academy <no-reply@acme.example>"`. | empty (falls back to `SMTP_USER` or a placeholder) | Recommended |

**Payments**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_…` / `sk_test_…`). | empty | For Stripe |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe webhook endpoint (`whsec_…`). | empty | Strongly recommended with Stripe |
| `RAZORPAY_KEY_ID` | Razorpay key id. | empty | For Razorpay |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret. | empty | Yes with `RAZORPAY_KEY_ID` |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you typed when creating the Razorpay webhook. | empty | Strongly recommended with Razorpay |

**Server, SEO and development**

| Variable | Purpose | Default | Required? |
|---|---|---|---|
| `NODE_ENV` | `production` turns on production behaviour (secure cookies, HSTS, strict start-up checks). Set by `npm start`/`npm run build`, the Dockerfile and the systemd example. | `development` with `npm run dev` | Set by the tools |
| `PORT` | Port the server listens on. | `3000` | No |
| `HOSTNAME` | Address the standalone server listens on (`0.0.0.0` in Docker, `127.0.0.1` in the systemd example). | set by Next.js | No |
| `SEO_CANONICAL_HOST` | Host redirects: unset, `all` or `off` (see [HTTPS and the address](#https-and-the-address)). | unset | No |
| `TZ` | Server time zone, used for dates printed on certificates (e.g. `Asia/Kolkata`). | the system's time zone | No |
| `APP_VERSION` | Version shown by `/api/health` (the Docker build passes it through). | `package.json` version | No |
| `LL_DEV_LOGIN` | `1` enables `/api/dev/login?as=<user id>` for automated tests. Ignored in production. | empty | Never in production |
| `WEBHOOKS_ALLOW_PRIVATE_NETWORK` | `true` lets webhooks reach `localhost` and private network addresses, to test a receiver on your own machine. Ignored in production. | empty | No |
| `DEBUG` | Any value makes the `db:*` scripts print full error traces. | empty | No |

**Read only by `docker-compose.yml` and the Docker image (not by the app)**

| Variable | Purpose |
|---|---|
| `DOMAIN` | Your domain, for Caddy's certificate. Required by Compose. |
| `ACME_EMAIL` | Email for certificate expiry notices. Required by Compose. |
| `CRON_KEY` | The cron key, for the optional cron service. |
| `POSTGRES_PASSWORD` | Password of the optional local `postgres` service (`--profile postgres`). |
| `MIGRATE_ON_START` | `false` stops the container from running `prisma migrate deploy` before the server starts (read by the image's start script). |

`LEARNLOOP_WEBHOOK_SECRET` appears only in the **sample receiver code** on `/developers`; it is a suggested name for a setting in **your** receiving app, not a LearnLoop setting.

---

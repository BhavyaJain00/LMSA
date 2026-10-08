# Admin guide, part 2: site settings, SEO, marketing and communication

This part of the manual is for the people who run the platform. It explains every screen under **Admin → Settings** that shapes how the site looks and behaves, how the site shows up in search engines, the marketing tools (blog, lead forms, legal pages) and every way the platform talks to people (email setup, the outbox, batch emails, broadcasts, automated sequences, direct messages, notifications and the job board).

- [Part 1](04-admin-people-and-money.md) covers members, teams, payments, plans, coupons, affiliates and other growth tools.
- [Part 3](06-admin-system-and-developers.md) covers backups, the audit and error logs, sign-in security, going live and the developer API.
- Course sales pages are explained in the [guide for instructors](03-instructors.md).

> **Round 3 features.** Sections marked **(Round 3)** are *built and covered by automated tests; not yet tried in a browser.* Everything else in this part (general settings, branding, features, sidebar, learning settings, categories, video protection, the installable app, email settings, the outbox, batch emails and the job board) comes from rounds 1 and 2 and has been tested in a browser.

**Contents**

1. [Who can open the pages in this part](#who-can-open-the-pages-in-this-part)
2. [Finding your way around Settings](#finding-your-way-around-settings)
3. [Settings that live in the .env file](#settings-that-live-in-the-env-file)
4. [General settings](#general-settings)
5. [Branding](#branding)
6. [Features (switch whole areas on or off)](#features-switch-whole-areas-on-or-off)
7. [Sidebar links](#sidebar-links)
8. [Learning settings](#learning-settings)
9. [Categories and category landing pages](#categories-and-category-landing-pages)
10. [Video protection, watermark and player](#video-protection-watermark-and-player)
11. [Storage, video conversion and captions (Round 3)](#storage-video-conversion-and-captions-round-3)
12. [Installable app (PWA)](#installable-app-pwa)
13. [AI tutor settings (Round 3)](#ai-tutor-settings-round-3)
14. [SEO: search appearance (Round 3)](#seo-search-appearance-round-3)
15. [SEO: indexing, sitemap, robots.txt, feeds and IndexNow (Round 3)](#seo-indexing-sitemap-robotstxt-feeds-and-indexnow-round-3)
16. [SEO: redirects (Round 3)](#seo-redirects-round-3)
17. [SEO: tracking tags and consent (Round 3)](#seo-tracking-tags-and-consent-round-3)
18. [Blog (Round 3)](#blog-round-3)
19. [Sales pages](#sales-pages)
20. [Leads and lead capture (Round 3)](#leads-and-lead-capture-round-3)
21. [Legal pages, cookie consent and data retention (Round 3)](#legal-pages-cookie-consent-and-data-retention-round-3)
22. [Email setup](#email-setup)
23. [The email outbox](#the-email-outbox)
24. [Batch emails](#batch-emails)
25. [Broadcasts (Round 3)](#broadcasts-round-3)
26. [Audience explorer (Round 3)](#audience-explorer-round-3)
27. [Open and click tracking (Round 3)](#open-and-click-tracking-round-3)
28. [Automated email sequences (Round 3)](#automated-email-sequences-round-3)
29. [Unsubscribes and email preferences](#unsubscribes-and-email-preferences)
30. [Scheduled jobs (cron URLs)](#scheduled-jobs-cron-urls)
31. [Direct messaging settings (Round 3)](#direct-messaging-settings-round-3)
32. [Notifications](#notifications)
33. [Job board administration](#job-board-administration)
34. [Checklists and troubleshooting](#checklists-and-troubleshooting)

---

## Who can open the pages in this part

Roles add up: an admin can do everything, and a member with two roles gets both sets of rights. Pages you are not allowed to open send you to a "forbidden" page.

| Area | URL | Admin | Moderator | Course creator | Evaluator | Student / guest |
|---|---|---|---|---|---|---|
| All settings pages | `/admin/settings/...` | Yes | No | No | No | No |
| Blog editor | `/admin/blog` | Yes (all articles) | Yes (all articles) | Own articles only | No | No |
| Leads | `/admin/leads` | Yes | No | No | No | No |
| Email outbox and batch emails | `/admin/emails`, `/admin/emails/compose` | Yes | Yes | No | No | No |
| Broadcasts, audience, tracking report | `/admin/broadcasts/...` | Yes | Yes | No | No | No |
| Email sequences | `/admin/sequences/...` | Yes | Yes | No | No | No |
| Change open/click tracking switches | `/admin/broadcasts/tracking` | Yes | View only | No | No | No |
| AI tutor review queue and usage | `/admin/ai`, `/admin/ai/usage` | Yes | Yes | Their own courses | No | No |
| Job openings admin | `/admin/jobs` | Yes (all jobs) | Yes (all jobs) | Own jobs | Own jobs | No |
| Post a job on the board | `/jobs/new` | Yes | Yes | Yes | Yes | Any signed-in member (when the Jobs feature is on) |
| Message reports and messaging settings | `/messages/moderation` | Yes (can change settings) | Yes (reports only) | No | No | No |
| Public blog, `/free` page, legal pages | `/blog`, `/free`, `/legal/...` | Everyone, including guests | | | | |

With the demo data (password `password123`):

- `admin@learnloop.test` can open everything in this part.
- `maya@learnloop.test` (course creator and moderator) can use the blog editor (all articles), the outbox, batch emails, broadcasts, sequences, the AI review queue and the jobs admin, but not Settings or Leads.
- `priya@learnloop.test` (evaluator and moderator) has the same rights in this part as Maya, because they all come from the moderator role (moderators can write and edit every blog article).
- `alex@learnloop.test` (student) can only use the public pages, post jobs on `/jobs/new` and manage their own email preferences.

> **Two-step verification for staff.** If an admin has switched on "Require two-step verification for staff" (Settings → Security, see [Part 3](06-admin-system-and-developers.md)), staff are sent to set it up before any admin page opens.

> **Menu shortcuts for moderators.** The left sidebar shows moderators **Manage → Email outbox** and **Manage → Blog**, but there is no sidebar entry for Broadcasts or Sequences: those are linked only from the admin-only Settings menu. A moderator who is not an admin opens them by typing `/admin/broadcasts` or `/admin/sequences` in the address bar (or from a bookmark).

---

## Finding your way around Settings

**What it is.** One place with every site-wide option, grouped into sections.

**Who can use it.** Admins only. Every settings page and every save button checks the admin role again on the server.

**Where.** In the left sidebar, under **Manage**, click **Settings**. The address is `/admin/settings`; it opens **General** (`/admin/settings/general`) straight away.

**How to use it.**

1. Sign in as an admin (for example `admin@learnloop.test`).
2. Click **Settings** in the **Manage** section of the sidebar.
3. Pick a page from the settings menu. On a wide screen the menu is a list on the left, grouped under headings; on a phone or tablet it is a row of buttons you can swipe sideways.
4. Change what you need, then click **Save** in the bar that sticks to the bottom of the form.

The save bar always tells you where you stand: **Not saved** (you changed something), **Saving…**, **Saved**, **Save failed** (a field has an error, shown in red under the field), or **All changes saved**. If you try to leave a page with unsaved changes, a box asks **Discard your changes?** with **Discard** and **Keep editing**.

Changes made on these pages apply to the whole site at once; nobody has to restart anything. Every save is written to the audit log (see [Part 3](06-admin-system-and-developers.md)).

### The settings menu

| Group | Menu item | URL | Where it is explained |
|---|---|---|---|
| System configuration | General | `/admin/settings/general` | [General settings](#general-settings) |
| | Branding | `/admin/settings/branding` | [Branding](#branding) |
| | SEO | `/admin/settings/seo` | [SEO sections](#seo-search-appearance-round-3) |
| | Features | `/admin/settings/features` | [Features](#features-switch-whole-areas-on-or-off) |
| | Learning | `/admin/settings/learning` | [Learning settings](#learning-settings) |
| | Video | `/admin/settings/video` | [Video protection](#video-protection-watermark-and-player) |
| | Storage & video | `/admin/settings/storage` | [Storage](#storage-video-conversion-and-captions-round-3) |
| | AI tutor | `/admin/settings/ai` | [AI tutor settings](#ai-tutor-settings-round-3) |
| | API & webhooks | `/admin/settings/api` | [Part 3](06-admin-system-and-developers.md) |
| | Installable app | `/admin/settings/pwa` | [Installable app](#installable-app-pwa) |
| Content & marketing | Blog | `/admin/blog` | [Blog](#blog-round-3) |
| | Leads | `/admin/leads` | [Leads](#leads-and-lead-capture-round-3) |
| | Analytics | `/admin/analytics` | [Part 1](04-admin-people-and-money.md) |
| | Affiliates | `/admin/affiliates` | [Part 1](04-admin-people-and-money.md) |
| Course configuration | Categories | `/admin/settings/categories` | [Categories](#categories-and-category-landing-pages) |
| | Badges | `/admin/settings/badges` | [Part 1](04-admin-people-and-money.md) |
| | Points & leaderboard | `/admin/settings/gamification` | [Part 1](04-admin-people-and-money.md) |
| | Rubrics | `/admin/rubrics` | [Instructors guide](03-instructors.md) |
| User management | Members, Teams, Instructors & payouts | `/admin/members`, `/admin/teams`, `/admin/marketplace` | [Part 1](04-admin-people-and-money.md) |
| | Security, Login activity | `/admin/settings/security`, `/admin/security` | [Part 3](06-admin-system-and-developers.md) |
| Communication | Email | `/admin/settings/email` | [Email setup](#email-setup) |
| | Broadcasts | `/admin/broadcasts` | [Broadcasts](#broadcasts-round-3) |
| | Email sequences | `/admin/sequences` | [Sequences](#automated-email-sequences-round-3) |
| | Outbox | `/admin/emails` | [The email outbox](#the-email-outbox) |
| Payment | Payments, Transactions, Coupons, Plans, bundles & installments, Taxes & currencies, Upsells | `/admin/settings/payments` and others | [Part 1](04-admin-people-and-money.md) |
| Customization | Sidebar | `/admin/settings/sidebar` | [Sidebar links](#sidebar-links) |
| Legal & compliance | Legal pages | `/admin/settings/legal` | [Legal pages](#legal-pages-cookie-consent-and-data-retention-round-3) |
| | Audit log, Error log | `/admin/audit`, `/admin/errors` | [Part 3](06-admin-system-and-developers.md) |
| Data | Backup & restore | `/admin/settings/data` | [Part 3](06-admin-system-and-developers.md) |

Menu items that point outside `/admin/settings` (Blog, Leads, Broadcasts and so on) open their own full-width page; use your browser's back button or the sidebar's **Settings** link to return.

---

## Settings that live in the .env file

Some things cannot be changed from the browser because they are secrets (passwords, API keys) or because the server needs them before it starts. They live in a text file called `.env` in the project folder (next to `package.json`). The file `.env.example` is a commented template: copy it to `.env` and fill in what you need.

**After you change `.env`, restart the app** so it reads the new values:

- If you started it with `npm run dev` or `npm start`, press `Ctrl+C` in that terminal window and run the same command again.
- With Docker, run `docker compose restart` (see [Part 3](06-admin-system-and-developers.md) and `DEPLOYMENT.md`).

The admin pages in this part show whether each value is set (secrets are never shown in full), so you can check your work after the restart.

| Variable | Used by | Default | What to put in it |
|---|---|---|---|
| `APP_URL` | Every absolute link: emails, sitemap, feeds, cron URLs, share cards | `http://localhost:3000` | The public address of the site, no trailing slash, e.g. `https://learn.example.com` |
| `APP_SECRET` | Signs protected video links, unsubscribe links and the cron key | generated in development | A random value of at least 32 characters (`openssl rand -hex 32`). **Required in production.** Changing it breaks old signed links and changes every cron URL |
| `MAIL_TRANSPORT` | Email | `log` | `log` keeps emails in the outbox without sending; `smtp` delivers them |
| `SMTP_HOST`, `SMTP_PORT` | Email | –, `587` | Your mail provider's SMTP server and port |
| `SMTP_SECURE` | Email | `false` | `true` for implicit TLS (usually port 465); `false` uses STARTTLS |
| `SMTP_REQUIRE_TLS` | Email | `true` | Leave `true`. `false` allows unencrypted delivery to a relay without TLS (not recommended) |
| `SMTP_USER`, `SMTP_PASS` | Email | – | Your SMTP login |
| `MAIL_FROM` | Email | – | Sender address, e.g. `LearnLoop <no-reply@example.com>` |
| `STORAGE_DRIVER` | Uploads | `local` | `local` or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `S3_FORCE_PATH_STYLE` | Uploads in a bucket | – | See [Storage](#storage-video-conversion-and-captions-round-3) |
| `UPLOAD_DIR` | Uploads on this server | `storage/uploads` | Folder for uploaded files |
| `MAX_VIDEO_UPLOAD_MB` | Video uploads | `10240` (10 GB) | Largest video upload in MB |
| `MAX_FILE_UPLOAD_MB` | Images, documents, audio | `25` | Largest other upload in MB (also the logo and favicon limit) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Video conversion | `ffmpeg`, `ffprobe` | Only needed when ffmpeg is not on the system PATH |
| `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | Automatic captions | –, –, `whisper-1` | Any OpenAI-compatible speech-to-text endpoint, e.g. `https://api.openai.com/v1/audio/transcriptions` |
| `ANTHROPIC_API_KEY` | AI tutor | – | An API key from the Anthropic Console |
| `SEO_CANONICAL_HOST` | Host redirects | unset | Unset = redirect only the `www.` twin of the `APP_URL` host; `all` = redirect every other host name (only when your reverse proxy forwards the visitor's Host header); `off` = no host redirects |

---

## General settings

**What it is.** Your platform's name, tagline, footer line, contact details and text direction.

**Who can use it.** Admins.

**Where.** `/admin/settings/general` (Settings → System configuration → **General**). It is also the page `/admin/settings` opens on.

**How to use it.**

1. Open **Settings**; the **General** page opens.
2. Under **Brand**, fill in:
   - **Brand name** (required, up to 60 characters). Shown in the sidebar and the browser tab. Default: `LearnLoop`.
   - **Tagline** (up to 140 characters). The short line on the landing page hero. Default: "Learn by doing. Master real skills."
   - **Footer text** (up to 300 characters). An extra line at the bottom of pages, for example a copyright line. Leave it empty to show nothing extra.
3. Under **Contact information**, fill in:
   - **Email**: where learners can reach your team. Default: `support@example.com` (change it before launch).
   - **URL**: a contact or help-centre page. It must start with `http://` or `https://`.
4. Under **Preferences**, choose **Text direction**: **Automatic** (follows each visitor's language, so Arabic shows right to left), **Left to right** or **Right to left**.
5. Click **Save**. The message "General settings saved" appears.

**Settings that affect it.** The **Contact us** link in the sidebar's **Links** section uses the URL when one is set, otherwise the email address (as a `mailto:` link). With both empty there is no Contact us link.

**Good to know.**

- The brand name is used in many defaults that do **not** change by themselves when you rename the site: the SEO title template (`%s · LearnLoop`), the SEO organization name (`LearnLoop Academy`), the legal company name (`LearnLoop Academy`) and the email "From name" (`LearnLoop`). See the [rebranding checklist](#checklists-and-troubleshooting).
- The logo, favicon and accent colour are on the [Branding](#branding) page.

---

## Branding

**What it is.** Your logo, browser-tab icon (favicon) and the accent colour used for buttons, links, focus rings and progress bars, in light and dark mode.

**Who can use it.** Admins.

**Where.** `/admin/settings/branding` (Settings → System configuration → **Branding**). The page title is **Brand settings**.

**How to use it.**

1. Under **Logo & favicon**:
   - **Brand logo**: click the upload area and pick a file (PNG, SVG, JPG or WebP, up to 25 MB). It is shown in the sidebar next to the brand name; a 32×32 px PNG or SVG works best.
   - **Favicon**: upload a 32×32 px PNG or ICO for the browser tab.
   - You can also paste a web address of an image instead of uploading.
2. Under **Accent color**:
   - Use the colour picker, type a hex value such as `#4f46e5`, or click one of the **Suggested colors**: Indigo (`#4f46e5`, the default), Blue (`#2563eb`), Violet (`#7c3aed`), Emerald (`#059669`), Teal (`#0d9488`), Rose (`#e11d48`), Orange (`#ea580c`) or Slate (`#334155`).
   - Read the contrast message under the field. It says whether white button text on your colour is readable ("passes WCAG AA for normal text", "passes only for large text" or "too low"). Pick a darker shade if it warns you.
   - The **Live preview** shows the sidebar, buttons, links and a progress bar in your colour before you save.
3. Click **Save** ("Branding saved").

**Settings that affect it.** The brand name itself is edited on [General](#general-settings). The upload size limit is `MAX_FILE_UPLOAD_MB` in `.env` (default 25). Uploaded images are stored in `UPLOAD_DIR` or in your S3 bucket ([Storage](#storage-video-conversion-and-captions-round-3)).

**Good to know.** The accent colour is also the theme colour of the [installable app](#installable-app-pwa) (title bar and splash screen). The app icons themselves are fixed files in `public/images/`.

---

## Features (switch whole areas on or off)

**What it is.** Fourteen switches that turn whole areas of the platform on or off.

**Who can use it.** Admins.

**Where.** `/admin/settings/features` (Settings → System configuration → **Features**).

**How to use it.**

1. Open the page. The switches are grouped under **Learning experiences**, **Community**, **Career & credentials** and **Insights**.
2. Turn switches on or off.
3. Click **Save** ("Features updated").

Turning a feature off hides it from the navigation and blocks its pages. Existing data is kept and reappears when you turn the feature back on. Every feature is **on** by default.

| Group | Switch | What it controls |
|---|---|---|
| Learning experiences | **Courses** | Course catalog, course pages and the lesson player |
| | **Batches** | Cohort-based batches with timetables, assessments and announcements |
| | **Programs** | Learning paths that bundle several courses in order |
| | **Live classes** | Scheduled live sessions inside batches, with recordings |
| | **Programming exercises** | In-browser coding exercises checked against test cases |
| Community | **Discussions** | Question & answer threads on lessons, courses and batches (and the Community page) |
| | **Reviews** | Course ratings and written reviews on course pages |
| | **Notes** | Personal lesson notes and highlights for learners |
| | **Badges** | Achievement badges awarded automatically or by hand |
| | **Notifications** | In-app notifications, the notification bell and `/notifications` |
| Career & credentials | **Certifications** | Certificates, evaluations and paid certificates |
| | **Certified members** | Public directory of members who earned certificates (needs Certifications on too) |
| | **Jobs** | The job board where members browse, post and apply to openings |
| Insights | **Statistics** | Platform statistics page |

**Good to know.** Some menu entries depend on other settings too: the **Blog** entry follows "Publish the blog" in [SEO settings](#seo-search-appearance-round-3); **Messages** follows the [messaging settings](#direct-messaging-settings-round-3); **Leaderboard**, **Bundles**, **Membership**, **Affiliate**, **Gifts** and **Teach** follow settings described in [Part 1](04-admin-people-and-money.md).

---

## Sidebar links

**What it is.** Your own links in the left sidebar (for example a community forum, a help centre or a page of this site), plus an overview of the built-in items.

**Who can use it.** Admins set the links. Everyone who sees the sidebar, guests included, sees them under the **Links** heading.

**Where.** `/admin/settings/sidebar` (Settings → Customization → **Sidebar**).

**How to use it.**

1. Under **Custom links**, click **New**. The box **Add a link to the sidebar** opens.
2. Fill in:
   - **Label** (required, up to 40 characters), e.g. "Community forum".
   - **Link** (required): a path on this site such as `/programs` (one leading `/`, no spaces), a full `https://` address, or an email link such as `mailto:help@example.com`.
   - **Icon** (required): type in **Search icons** and click an icon. The **Preview** shows how the link will look.
3. Click **Add** ("Link added to sidebar").
4. To change the order, use the up and down arrows next to a link. To edit, click the pencil (the box is called **Edit sidebar link**; click **Save**). To delete, click the bin and confirm **Remove**.

**Settings that affect it.** The **Built-in items** list on the same page shows Dashboard, Courses, Batches, Programs, Certified members, Jobs, Statistics, Notifications and Contact us, each marked **Visible** or **Hidden**. You cannot edit them here: they follow the [Features](#features-switch-whole-areas-on-or-off) switches, the contact details on [General](#general-settings), and each member's role. Contact us is always the last entry under **Links**.

---

## Learning settings

**What it is.** Who may browse without an account, whether people can sign up, the rules for when a lesson counts as complete, the default home page and announcements of new courses and batches.

**Who can use it.** Admins.

**Where.** `/admin/settings/learning` (Settings → System configuration → **Learning**).

**How to use it.** Change the fields below and click **Save** ("Learning settings saved").

| Section | Field | Default | What it does |
|---|---|---|---|
| Access & availability | **Allow guest access** | On | Visitors can browse course and batch lists and preview lessons without logging in. Also shows the Instructors, Statistics and Leaderboard pages to guests |
| | **Disable sign-up** | Off | When on, new members can only be added by an admin ([Part 1](04-admin-people-and-money.md)) |
| | **Sign-up page content** | empty | Markdown shown on the sign-up page, e.g. a consent notice. Up to 5,000 characters. Use **Write** / **Preview** to check it |
| Completion time | **Lesson completion time (seconds)** | 30 | How long a learner must stay on a text lesson before it can be marked complete (1–3600) |
| | **Video completion threshold (%)** | 90 | How much of a video counts as watched when video completion is enforced (1–100) |
| Enforcement | **Enforce video completion** | On | Lessons with a video can only be completed after the video has been played to the end (the dwell timer is used if the video fails to load) |
| | **Enforce assignment completion** | On | Lessons with an assignment can't be completed until it is submitted |
| | **Enforce quiz completion** | On | Lessons with a quiz can't be completed until the quiz is passed |
| | **Prevent skipping in videos** | Off | Learners can't jump ahead of the furthest point they have watched |
| Home & notifications | **Default home page** | Courses | Where signed-in members land when they open the site: **Courses** or **Dashboard** |
| | **Announce new courses** | In-app | When a course goes live: **Don't notify**, **In-app** or **Email** |
| | **Announce new batches** | In-app | Same choice for batches |

**Good to know.** "Email" announcements need working email ([Email setup](#email-setup)) and are only sent to members who kept the **Announcements** email category on.

---

## Categories and category landing pages

**What it is.** Categories group courses and batches so learners can filter the catalog, and blog articles can use them too. Every category also gets a public landing page at `/courses/category/<slug>` with an introduction and its own search-engine title and description. *(The landing-page editor is Round 3.)*

**Who can use it.** Admins manage categories. Instructors pick a category when they edit a course or batch ([instructors guide](03-instructors.md)).

**Where.** `/admin/settings/categories` (Settings → Course configuration → **Categories**).

### Create a category

1. In the **New category** box, type a **Name** (up to 60 characters, unique).
2. The **Slug** (the part of the address) is suggested from the name; you can change it. Use lowercase letters, numbers and dashes, e.g. `web-development`.
3. Click **Create**.

### Edit, write the landing page, or delete

Each row shows the category, its slug and **Used by** (how many courses and batches use it, or "Not used yet"). A note "No landing page introduction yet" reminds you when a used category has no introduction.

- **Rename or change the slug:** click the pencil, edit **Name** and **Slug**, click **Save**. The old category address keeps working: it redirects to the new one (see [Redirects](#seo-redirects-round-3)).
- **Write the landing page:** click the page icon (**Edit the … landing page**). The box **<Name> landing page** has:
  - **Introduction**: shown above the course list. Say who the courses are for and what learners will be able to do. Markdown works (headings, lists, links). Up to 5,000 characters.
  - **Search title**: up to 70 characters. Empty means "<Name> courses". A counter suggests 30–60 characters.
  - **Search description**: up to 300 characters. Empty means it is built from the introduction. A counter suggests 120–160 characters.
  - **Search result preview**: an approximation of the Google result.
  - **Open the page** opens the public page in a new tab.
  
  Click **Save** ("Landing page saved").
- **Delete:** click the bin and confirm. The category is first removed from every course and batch that uses it, then deleted for good.

**Good to know.** Blog category pages use the same categories, at `/blog/category/<slug>`.

---

## Video protection, watermark and player

**What it is.** Options that keep uploaded lesson videos from being shared with a plain link, an optional moving watermark with the viewer's email, and two player conveniences.

**Who can use it.** Admins.

**Where.** `/admin/settings/video` (Settings → System configuration → **Video**).

**How to use it.**

1. Read the three cards at the top: **Protectable videos** (uploads served through signed links), **Older uploads** (uploaded before protection existed; their public links keep working) and **External links** (videos hosted elsewhere, e.g. YouTube; not affected).
2. Under **Protected uploads**:
   - **Protect uploaded videos** (on by default). Uploaded videos play only through signed links that expire and work for one signed-in account. A copied link does not play for anyone else.
   - **Signed link lifetime (minutes)**: default 60, allowed 5–240. The player renews the link before it expires, so learners are never interrupted.
3. Under **Watermark**:
   - **Show a viewer watermark** (off by default). Shows the signed-in learner's email over lesson videos and moves it every few seconds, also in fullscreen. Guests see no watermark. Picture-in-picture is turned off while the watermark is shown.
   - **Watermark opacity**: 5% to 50% (default 18%), with a live preview.
4. Under **Player**:
   - **Seek-bar previews** (on): a preview frame when hovering the timeline.
   - **Autoplay the next lesson** (on): counts down five seconds after the last video of a lesson and opens the next lesson; learners can cancel.
5. Click **Save**.

**Settings that affect it.** Signing needs `APP_SECRET` in `.env` (at least 32 characters). If it is missing, a yellow box warns you: in development a key is generated for your machine, but in production protected videos can't be signed and learners see them as unavailable.

**Good to know.** The note at the bottom says how many learner views have detailed retention data. Instructors see it per course under **Video analytics** ([instructors guide](03-instructors.md)).

---

## Storage, video conversion and captions (Round 3)

**What it is.** Where uploaded files are kept (this server or an S3-compatible bucket), whether uploaded lesson videos are converted to adaptive streaming (HLS), automatic captions, the conversion queue and a housekeeping URL.

**Who can use it.** Admins.

**Where.** `/admin/settings/storage` (Settings → System configuration → **Storage & video**).

The four cards at the top show **Storage** (this server, or the provider and bucket), **Adaptive streaming** (how many uploaded videos already have an HLS stream), **Conversion queue** (and how many failed) and **Uploads in progress**.

### File storage: local disk or a bucket

The **File storage** section is read-only: it reflects `.env`. With local storage it shows **Driver** (Local disk), **Folder**, **Used** and **Free space**. With a bucket it shows **Provider**, **Bucket**, **Endpoint**, **Region**, **Access key**, **Secret key** (Set or Missing) and **Public URL**.

Click **Test connection** to write a small file, read it back (and download it through a signed link when using S3), then delete it. Each step shows a tick and its time.

**To move uploads to AWS S3** (the recommended storage for a live site; Cloudflare R2, Backblaze B2 and MinIO also work):

1. Create a private bucket and an access key limited to that bucket. For AWS, [ENV-SETUP.md](../../ENV-SETUP.md), section 4, has every step (free-tier rules, a $1 budget alert, the bucket, a lifecycle rule for interrupted uploads and the exact IAM policy).
2. Open `.env` and set:

   | Variable | Value |
   |---|---|
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET` | your bucket name |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the access key |
   | `S3_ENDPOINT` | empty for AWS; Cloudflare R2: `https://<account id>.r2.cloudflarestorage.com`; Backblaze B2: `https://s3.<region>.backblazeb2.com`; MinIO: `http://localhost:9000` |
   | `S3_REGION` | the bucket's region, e.g. `ap-south-1` for AWS (always set it for AWS: when empty it is inferred from the endpoint and falls back to `us-east-1`); `auto` for R2 |
   | `S3_FORCE_PATH_STYLE` | `true` for MinIO (usually) |
   | `S3_PUBLIC_BASE_URL` | leave empty with a private bucket (every file is then served through the app, and the bucket needs no CORS rules). Only for an `https://` CDN in front of the bucket, for files that are not protected; its CORS rules must then allow GET from `APP_URL` |

3. Restart the app and open **Storage & video**. If something is missing you see "STORAGE_DRIVER is s3, but … is missing"; files stay on this server until it is fixed.
4. Click **Test connection**.
5. Files uploaded earlier are listed under **Files still on this server**. Click **Move to bucket** and confirm **Move files**: up to 500 files are copied, checked and then deleted from this server; links keep working. The media cron (below) also moves them over time.

### Delivery: CDN base URL

**CDN base URL** (form field): the public origin of a CDN in front of your bucket, e.g. a Cloudflare or CloudFront domain. Images and documents are then served from it; protected lesson videos still use signed links. It only works with S3-compatible storage (with local storage, put a CDN in front of the whole site instead). When set, it is used instead of `S3_PUBLIC_BASE_URL`. It must start with `https://` (or `http://`) and contain no query string, `#` part or password.

### Video converter (ffmpeg)

The **Video converter** section says either "ffmpeg … is installed" (with its path and when it was checked) or **ffmpeg not found**. ffmpeg turns uploads into HLS streams and makes poster frames. Without it, videos simply play as uploaded.

To install it: `winget install Gyan.FFmpeg` on Windows or `apt install ffmpeg` on Linux, or set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env` to the programs' full paths. Then click **Check again**.

### Adaptive streaming (HLS)

1. **Convert uploaded videos to HLS** (on by default). Each upload is converted in the background, one video at a time. Until a conversion is done, or if it fails, learners get the original file.
2. **Qualities to produce** (at least one): **1080p** Full HD (about 5 Mbit/s), **720p** HD (about 2.8), **480p** SD (about 1.4), **360p** Data saver (about 0.8). Defaults: 1080p, 720p and 480p. Only qualities at or below the uploaded video's resolution are produced; more qualities take longer and use more storage.
3. Click **Save** ("Storage settings saved"; when you just switched conversion on: "Uploaded videos are being queued for conversion").

### Captions

**Generate captions automatically** (off by default). When a video is ready, its audio goes to your transcription service and the transcript becomes captions, a searchable transcript and context for the AI tutor. It needs `TRANSCRIBE_API_URL` and `TRANSCRIBE_API_KEY` in `.env` (any OpenAI-compatible speech-to-text endpoint; `TRANSCRIBE_MODEL` defaults to `whisper-1`) **and** ffmpeg. Until then, instructors can still upload or type transcripts ([instructors guide](03-instructors.md)).

### Conversion queue

- Filter by **All**, **Queued**, **Converting**, **Failed** or **Done**, or search by lesson or course.
- **Retry failed** queues every failed conversion again; **Convert all videos** queues every uploaded video that still needs converting (adaptive streaming must be on).
- Per row: **Cancel** a queued or running conversion (learners keep the original), **Retry** a failed one, or **Convert again**.
- While conversions run, the table updates itself ("Updating live").

### Scheduled housekeeping (media cron)

Copy the **Media cron URL** (`<APP_URL>/api/cron/media?key=…`) and have a scheduler call it every 5–15 minutes. Each run removes uploads abandoned for a day, queues videos that still need converting, restarts the converter after a reboot, deletes streams no lesson uses any more and, with S3, moves leftover local files to the bucket. **Run now** does a run immediately. See [Scheduled jobs](#scheduled-jobs-cron-urls).

---

## Installable app (PWA)

**What it is.** Members can install the site on their phone, tablet or computer and open it in its own window. It also adds a service worker that makes repeat visits faster and shows a branded offline page.

**Who can use it.** Admins set it up; every member benefits.

**Where.** `/admin/settings/pwa` (Settings → System configuration → **Installable app**).

**How to use it.**

1. Under **App & offline support**:
   - **Installable app** (on): the master switch. Turning it off removes the service worker from browsers on their next visit.
   - **Suggest installing the app** (on): shows a small install card when the browser supports installation, and Add to Home Screen steps on iPhone and iPad. Members who dismiss it aren't asked again for 14 days.
   - **Offline page** (on): when a page can't load, show a branded offline screen with a **Try again** button and the pages saved on the device.
   
   The last two can only be changed while the app is on.
2. Click **Save**.
3. Click **Preview offline page** (top right) to see `/offline`.

**Readiness** checks what browsers require:

| Check | Meaning |
|---|---|
| **Served securely** / **HTTPS required** | Service workers only run over HTTPS (or on localhost). Serve the site over HTTPS and set `APP_URL` to the https address |
| **Production build** / **Development build** | The service worker only registers in production builds (`npm run build`, then `npm start`) so development changes are never cached |
| **Web app manifest** | Link to `/manifest.webmanifest`, which tells browsers the app's name, colours and icons |
| **App icons** | Standard and maskable icons at 192 and 512 px |
| **Theme color** | Your brand accent colour, used for the title bar and splash screen |

**This browser** checks the service worker in the browser you are using: **Service worker** (Not installed, Installing, Update waiting, Active), **Version**, whether **This page is controlled**, **Running as installed app**, **Cached entries** and **Storage used by this site**, with buttons **Check for updates** and **Clear offline data**.

**Good to know.** Stored on devices: app files and recently viewed images, the offline page, and public pages visited while signed out. Never stored: API responses, form submissions, lesson videos, and anything from admin or account pages.

---

## AI tutor settings (Round 3)

**What it is.** A teaching assistant that answers learners' questions using only the material of the course they are in (lessons, transcripts and quiz explanations) and links to the lessons it used. It runs on Anthropic's Claude models.

**Who can use it.** Admins configure it here. Instructors switch it on per course and review answers. Enrolled learners ask questions in courses where it is on.

**Where.** `/admin/settings/ai` (Settings → System configuration → **AI tutor**). The **Review queue** button (top right) opens `/admin/ai`.

The cards at the top show **Status** (**Ready**, **Off** or **Key missing**), **Courses with the tutor** (e.g. 0/4), **Answers (30 days)** with the share the course didn't cover, and **Awaiting review** (flagged or reported answers).

### Turn the tutor on

1. Get an API key: sign in to the Anthropic Console, open **API keys** and create a key.
2. Add it to `.env` on the server: `ANTHROPIC_API_KEY=<your key>`. (The key cannot be typed into the admin page: it is read from the server environment only, and shown as **Configured** or **Not set**.)
3. Restart the app and come back to this page.
4. Under **Model**, choose the Claude model that writes the answers. Each option shows its price per million input/output tokens:

   | Option | Note shown | Price (input / output per million tokens) |
   |---|---|---|
   | Claude Opus 5.5 (default) | Recommended: most capable Opus model | $4 / $20 |
   | Claude Sonnet 5.5 | Faster replies at half the cost | $2 / $10 |
   | Claude Haiku 4.5 | Fastest and lowest cost | $1 / $5 |
   | Claude Fable 5.1 | Most capable model, highest cost | $10 / $50 |
   | Claude Opus 5 | Previous Opus model | $5 / $25 |
   | Claude Sonnet 5 | Previous Sonnet model | $2 / $10 |
   | **Another model** | Enter any model id your Anthropic account can use | – |

5. Under **API key**, click **Test connection**. It sends one short request to the selected model and reports "Connected to … in … ms" or the error.
6. Under **Availability**, switch on **Turn on the AI tutor**. (If the key is missing, the tutor stays hidden from learners and a note says so.)
7. Keep **Instructor review queue** on if you want answers that learners mark as not helpful, or report, to go to the course instructors (they get a notification and can approve the answer or write a correction that the learner sees and the tutor uses from then on).
8. Under **Limits**, set **Questions per learner per day** (default 30, 0 = no limit, up to 1000). It resets at midnight UTC. Instructors and admins trying the tutor are not limited.
9. Under **Extra instructions**, optionally write **Instructions for the tutor** (up to 2,000 characters), e.g. tone, audience level, or where to send questions the course doesn't cover. They are added after the built-in ground rules, which they cannot override. Click **Show the built-in ground rules** to read them.
10. Click **Save**.
11. Ask each instructor to switch the tutor on in their course's **Settings** tab ([instructors guide](03-instructors.md)). The card **Courses with the tutor** counts them.

### The review queue and usage pages

Once the tutor is on, **Manage → AI review** appears in the sidebar for course creators, moderators and admins.

- `/admin/ai` (**Review queue**): tabs **Flagged**, **Not covered** (questions the course material couldn't answer: hints at what to add to your lessons), **All answers** and **Reviewed**; filters for search, **Courses**, **Feedback** (Not helpful, Helpful, No feedback) and **Period** (Last 7/30/90 days); **Export CSV**. Course creators see their own courses; moderators and admins see all.
- `/admin/ai/usage` (**Usage**): answers per day, top questions, tokens used, content gaps by lesson and a by-course table.
- `/admin/ai/conversations/<id>`: one full conversation.

Approving and correcting answers is described in the [instructors guide](03-instructors.md).

**Good to know.** Answers cost money on your Anthropic account. Use the daily limit and a cheaper model to control spend; the usage page shows tokens.

---

## SEO: search appearance (Round 3)

**What it is.** How every page is titled and described in Google and in link previews, the organization behind the site, proof that you own the site for Google and Bing, the blog's on/off switch, and a switch that hides the whole site from search engines.

**Who can use it.** Admins.

**Where.** `/admin/settings/seo` (Settings → System configuration → **SEO**). The SEO pages have four tabs: **Search appearance** (this page), **Indexing**, **Redirects** (with a count) and **Tracking**.

**How to use it.**

1. Under **Search appearance**:
   - **Title template** (required, up to 70 characters, must contain `%s`). `%s` is replaced with each page's name. Default: `%s · LearnLoop`. Example: `%s · Your Academy` makes a course page "Introduction to JavaScript · Your Academy".
   - **Default meta description** (up to 300 characters). Used on the home page and any page without its own description. Aim for 120–160 characters that tell searchers what they'll learn.
   - **Keywords** (comma-separated, up to 500 characters). Few search engines still read them.
   - **Default share image**: shown when a page without its own image is shared on social networks. Use 1200×630 px. Leave empty to use the generated brand card.
   - **X (Twitter) handle**, e.g. `@yourbrand` (credited on shared links).
2. Check the **Search result preview** of the home page.
3. Under **Organization** (structured data that tells search engines who runs the site):
   - **Organization name** (required, up to 120 characters). Default: `LearnLoop Academy`.
   - **Logo**: a square logo of at least 112×112 px. Empty = the Branding logo.
   - **Official profiles**: one URL per line (LinkedIn, YouTube, X, Instagram, Wikipedia…), up to 20.
4. Under **Search engine verification**, paste the token or the whole meta tag into **Google Search Console** and/or **Bing Webmaster Tools** (steps below).
5. Under **Blog**, **Publish the blog** (on by default) shows `/blog` with its categories, topics and RSS feed and adds articles to the sitemap, the footer and course pages. When off, articles can still be written under Admin → Blog but aren't public.
6. Under **Indexing**, **Hide the entire site from search engines** (off) adds `noindex` to every page and blocks crawling in `robots.txt`. Use it for a staging copy or before launch. While it is on, a red warning stays at the top of the page. Account, admin and checkout pages are always hidden, whatever you choose.
7. Click **Save** ("SEO settings saved").

### Prove you own the site in Google Search Console

1. Make sure the site is live at its real address and `APP_URL` in `.env` is that address.
2. In Google Search Console choose **Add property → URL prefix**, enter your address, and choose the **HTML tag** method.
3. Copy the tag (it looks like `<meta name="google-site-verification" content="…" />`).
4. Paste it (or just the `content` value) into the **Google Search Console** field on the SEO page and click **Save**.
5. Back in Search Console, click **Verify**.

For Bing: in Bing Webmaster Tools add the site, choose the **HTML Meta Tag** option (`msvalidate.01`) and paste it into the **Bing Webmaster Tools** field the same way.

### Submit the sitemap to Search Console

1. Open the **Indexing** tab and copy the **Sitemap address** (`<APP_URL>/sitemap.xml`).
2. In Google Search Console open **Sitemaps**, paste the address under **Add a new sitemap** and click **Submit**.
3. Do the same in Bing Webmaster Tools (**Sitemaps**).

You only do this once: the sitemap is rebuilt from the live content on every request.

**Good to know.** Every page's canonical address is built from `APP_URL`, not from the address a visitor typed, so set `APP_URL` correctly before launch.

---

## SEO: indexing, sitemap, robots.txt, feeds and IndexNow (Round 3)

**What it is.** A status page for everything search engines read: the sitemap, `robots.txt`, RSS feeds and instant indexing.

**Who can use it.** Admins (the files themselves are public).

**Where.** `/admin/settings/seo/indexing` (SEO → **Indexing** tab).

**What you see and can do.**

- **Sitemap**
  - **Sitemap address**: `<APP_URL>/sitemap.xml`. Above 50,000 addresses it is split into several files under `/sitemaps/…`, and this address becomes the index that lists them.
  - **What is listed**: a count per section (courses, batches, articles…) plus how many images and videos. Drafts, scheduled items, private batches, closed jobs and pages marked noindex are left out.
  - **robots.txt**: `<APP_URL>/robots.txt` tells crawlers to skip admin, account, checkout and API areas (for example `/admin`, `/api/`, `/dashboard`, `/settings`, `/billing`, `/login`, `/register`, `/quiz/`, `/assignments/`) and where the sitemap is.
- **Feeds**: `<APP_URL>/rss.xml` (new courses) and, when the blog is on, `<APP_URL>/blog/rss.xml` (articles). Both are announced in the head of every page.
- **Instant indexing (IndexNow)**: Bing, Yandex, Seznam, Naver and other engines are told the moment a course, batch or article is published, updated, renamed or removed. Google does not take part; it reads the sitemap.
  - **Status**: the last submission made by this server.
  - **Key**: generated automatically the first time something is published. **Copy** copies it; **Key file** opens `<APP_URL>/indexnow.txt`. To keep the key of a site you are moving, paste it and click **Use this key**; otherwise click **Generate key** (or **Generate a new key**). A key is 8–128 letters, digits or dashes.
  - **Send all pages**: submits every sitemap address (after launch, a domain change or a big import). Available only once the site is public.
  - **Check for changes now** → **Check now**: looks for renamed and newly published pages right away; renamed pages get a permanent redirect and new or updated ones are submitted.

**Warnings you may see.** "The site is hidden from search engines" (the noindex switch is on: the sitemap and feeds are empty, robots.txt blocks every crawler and nothing is submitted), or "APP_URL is http://localhost:3000" (search engines can't reach a local address, so nothing is submitted).

**Settings that affect it.** `APP_URL`; the noindex and blog switches on Search appearance; `SEO_CANONICAL_HOST` (see the [.env table](#settings-that-live-in-the-env-file)) controls whether visitors arriving on `www.` or other host names are redirected to the `APP_URL` host. Addresses also lose a trailing slash with one permanent redirect.

**Good to know.** There is also a human-readable sitemap page for visitors at `/sitemap`.

---

## SEO: redirects (Round 3)

**What it is.** When the address (slug) of a course, batch, program, job, article or category changes, the old address keeps working: visitors and search engines are sent to the new one with a permanent (301) redirect, so links and rankings are not lost. These redirects are created for you. You can also add your own, for retired pages or addresses from an older site.

**Who can use it.** Admins.

**Where.** `/admin/settings/seo/redirects` (SEO → **Redirects** tab).

**How to use it.**

1. To add one, fill in **Old address** (e.g. `/courses/old-name`) and **New address** (e.g. `/courses/new-name`) under **Add a redirect** and click **Add**. Only paths on this site work. Pages below the old address follow it too (lessons of a renamed course keep working).
2. Use the filter **All** or **Leading to a deleted page**, the **Search addresses** box and **Export CSV**.
3. The table shows **Old address**, **New address**, **Destination** and **Added**. Destination badges: **Live** (a published page), **Not public** (a draft or private page: visitors without access see "not found"), **Deleted** (point the old address elsewhere or remove the redirect) and **Page** (another page of the site).
4. To remove redirects, tick them and click **Remove selected**, or use the bin on one row. The old address then answers "not found" again.

**Good to know.** Redirects are also written to a file under `storage/seo/`, so the `storage/` folder must be writable and kept together with the database (see [Part 3](06-admin-system-and-developers.md)).

---

## SEO: tracking tags and consent (Round 3)

**What it is.** Google Analytics 4 and the Meta Pixel, loaded only after a visitor agrees in the cookie banner.

**Who can use it.** Admins.

**Where.** `/admin/settings/seo/tracking` (SEO → **Tracking** tab).

**How to use it.**

1. Under **Measurement tags**:
   - **Google Analytics 4**: the Measurement ID of your web data stream (Google Analytics → Admin → Data streams), e.g. `G-AB12CD34EF`. Loads after a visitor accepts **analytics** cookies.
   - **Meta Pixel**: the numeric Pixel (dataset) ID from Meta Events Manager, e.g. `123456789012345`. Loads after a visitor accepts **marketing** cookies.
   - Leave a field empty to switch that tag off.
2. Click **Save** ("Tracking settings saved").

**Events sent** (use them as conversions in Google Analytics and Meta Ads Manager):

| Google Analytics | Meta Pixel | When |
|---|---|---|
| `page_view` | `PageView` | Every page, including navigation inside the app |
| `generate_lead` | `Lead` | A visitor subscribes through a lead form |
| `sign_up` | `CompleteRegistration` | A lead confirms their email address |
| `purchase` | `Purchase` | A paid order succeeds (once per order, with value, currency and coupon) |

**How consent works.** Tags never load before the visitor agrees. Withdrawing consent stops both tags at once, in every open tab, and deletes their cookies. Sign-in tokens, signed links and email addresses are removed from page addresses before they are reported.

**Settings that affect it.** If **Ask visitors for cookie consent** is off on the [Legal pages](#legal-pages-cookie-consent-and-data-retention-round-3) page and a tag is set, a warning appears here: nobody is asked, so tags only load for visitors who open **Cookie settings** in the footer and accept.

### Share images

When a page is shared on social networks it shows a picture:

- Course, batch, program, blog article, job and instructor pages get a generated card automatically.
- Other pages use the **Default share image** from Search appearance, or a generated brand card (`/opengraph-image`) when none is set.

---

## Blog (Round 3)

**What it is.** Articles that bring visitors in from search engines and point them to your courses, with an SEO checker, FAQ blocks, scheduling, categories and topics, related courses and an RSS feed.

**Who can use it.**

- Writing: course creators (their own articles), moderators and admins (every article). Only moderators and admins can choose another **Author**.
- Reading: everyone, including guests, once the blog is published.

**Where.**

- Admin: **Manage → Blog** in the sidebar, or `/admin/blog` (also Settings → Content & marketing → **Blog**). Staff can write even while the public blog is switched off.
- Public: `/blog` (the **Blog** menu entry appears for everyone when **Publish the blog** is on in [SEO settings](#seo-search-appearance-round-3)).

### The article list

`/admin/blog` lists articles (course creators see only theirs) with tabs **All**, **Published**, **Scheduled** and **Drafts**, a search box (title, slug, tag or keyword), **Category** and **Author** filters, and the buttons **View blog**, **Export CSV** and **New article**. Columns: **Article**, **Status**, **Views**, **Updated**.

- Row menu: **Edit**, **View article** (or **Preview** for unpublished articles), **Duplicate**, **Delete**.
- Tick several articles for bulk actions: **Publish**, **Move to drafts**, **Hide from search engines**, **Show to search engines**, or delete them.
- If the blog is switched off, a yellow note says articles are not public yet (admins get a **Turn it on in SEO settings** link).

### Write an article

1. Click **New article** (`/admin/blog/new`).
2. **Article**:
   - **Title** (required, up to 150 characters).
   - **Slug** (the address `/blog/<slug>`; a suggestion is offered from the title).
   - **Excerpt** (up to 300 characters): shown on article cards and under the title. Empty = the first paragraph.
   - **Content** (Markdown). `##` and `###` headings build the table of contents (shown once there are three headings). Use **Upload an image into the article** to add a PNG, JPG, WebP or GIF; it is added at the end as Markdown, so move it where it belongs and adjust the alt text.
3. **Frequently asked questions** (optional): **Add a question**, then fill in the question and the answer (Markdown allowed). They are shown under the article and marked up for Google rich results. Use the arrows to reorder.
4. **Search engine optimization** panel:
   - **Search result preview**.
   - **SEO title** (up to 70 characters; empty = the article title).
   - **Meta description** (up to 200 characters; empty = generated from the excerpt and the article).
   - **Focus keyword** (up to 80 characters): the phrase the article should rank for, e.g. "javascript roadmap".
   - **On-page checks** with a score out of 100 and a verdict per check (**Good**, **Could be better**, **Needs work**): title length, meta description length, content length (at least 300 words; 600+ tends to rank better), subheadings, the keyword in the SEO title and main heading, keyword density and more.
5. **Publishing**: choose **Draft** ("Only editors can see it"), **Published** ("Live on the blog now") or **Scheduled** ("Goes live on the date you pick") and set the date in your local time. Moderators and admins can also choose the **Author**.
6. **Cover image**: 1200×630 or wider works best for cards and sharing.
7. **Categories and topics**: tick up to 5 **Categories** (the same categories as courses, managed in [Categories](#categories-and-category-landing-pages)) and type **Topics** separated by commas (up to 12).
8. **Related courses** (up to 6): promoted under the article and linked from those courses' pages.
9. **Indexing**: **Hide from search engines** (adds noindex and leaves the article out of the sitemap; anyone with the link can still read it) and **Canonical URL** (only for articles first published elsewhere).
10. Click the save button. Its label follows the status: **Save draft**, **Publish**, **Schedule** or **Update**.

**Scheduling.** A scheduled article becomes public by itself when its time comes; no cron job is needed. If the time you picked has already passed, the article is published when you save.

**Preview.** Editors can open an unpublished article at `/blog/<slug>`; a banner says it is a draft and only editors can see it.

**Deleting.** Deleted articles can't be restored. The address stops working and search engines are told the page is gone.

### The public blog

| Page | Address |
|---|---|
| Article list with search | `/blog` |
| One article | `/blog/<slug>` |
| A category | `/blog/category/<slug>` |
| A topic | `/blog/tag/<tag>` |
| RSS feed | `/blog/rss.xml` |

Article pages show a table of contents, share buttons, an author box, the FAQ, related courses and a lead form ("Enjoyed this article? Get the next one by email"). With the demo data, two sample articles are already published.

---

## Sales pages

Each course can have its own long-form sales page, built at `/admin/courses/<id>/sales-page`. This is explained in the [guide for instructors, course creators and evaluators](03-instructors.md).

---

## Leads and lead capture (Round 3)

**What it is.** Email sign-up forms for visitors who are not ready to create an account, with double opt-in: a lead only counts as confirmed after clicking the link in a confirmation email. Only confirmed leads receive [broadcasts](#broadcasts-round-3) and [sequences](#automated-email-sequences-round-3).

**Who can use it.** Any visitor (guests included) can subscribe. Only admins can see and manage leads.

**Where.**

- Admin list: `/admin/leads` (Settings → Content & marketing → **Leads**).
- The forms appear here:

  | Form | Where | Source shown in the admin |
  |---|---|---|
  | "Get free lessons by email" | The free resources page `/free` | Free resources page |
  | "Get the syllabus by email" | A public course page that has lessons, for visitors who are not enrolled | Course page |
  | "Enjoyed this article? Get the next one by email" | Under every blog article | Blog |
  | A compact sign-up form | The full footer on public pages | Footer |

### What a visitor experiences

1. They enter their email (the name is optional), tick the consent box (required) and submit.
2. They receive a confirmation email. The link works for 7 days.
3. Clicking it opens `/free/confirm` ("Your email is confirmed"). They then get a welcome email, or the course syllabus if they signed up on a course page. Someone who already confirmed earlier gets the syllabus straight away without confirming again.
4. Every marketing email after that has an unsubscribe link that opens `/free/unsubscribe`.

The `/free` page also lists free preview lessons, free courses and recent articles.

Spam protection is built in: a hidden "honeypot" field, a minimum time to fill in the form, and a limit on sign-ups per network ("Too many sign-ups from your network").

### Managing leads

On `/admin/leads`:

- Cards: **Total leads** (and how many in the last 7 days), **Confirmed** (with the confirmation rate), **Awaiting confirmation**, **Last 30 days** (and unsubscribes in total), a sign-ups chart for 30 days and a **By source** list.
- Tabs **All**, **Confirmed**, **Awaiting confirmation** and **Unsubscribed**; search by email or name; **Source**, **Course**, **From** and **To** filters; **Filter** and **Clear**.
- Buttons **Free resources page** and **Export CSV**.
- Tick leads, then **Resend confirmation** (only for leads awaiting confirmation; leads emailed in the last hour are skipped) or **Delete**. Deleting erases the email address and sign-up details for good and stops any sequence they are in; use it for data-erasure requests.

**Settings that affect it.**

- Confirmation emails need working delivery ([Email setup](#email-setup)): with `MAIL_TRANSPORT=log` nobody receives them.
- The privacy link next to the consent box points to your published Privacy Policy ([Legal pages](#legal-pages-cookie-consent-and-data-retention-round-3)).
- A sequence with the trigger **New lead** starts when a lead confirms ([Sequences](#automated-email-sequences-round-3)).
- When tracking tags are set, sign-ups send `generate_lead` and confirmations send `sign_up` ([Tracking](#seo-tracking-tags-and-consent-round-3)).

---

## Legal pages, cookie consent and data retention (Round 3)

**What it is.** Your Privacy Policy, Terms of Service, Refund Policy and Cookie Policy (starter templates included), any extra legal pages you need, the company details filled into them, the cookie consent banner and how long logs are kept.

**Who can use it.** Admins edit. Everyone can read published pages.

**Where.** `/admin/settings/legal` (Settings → Legal & compliance → **Legal pages**). Public pages live at `/legal/<slug>`.

### Get the standard pages ready for launch

The four standard pages start as unpublished starter templates. Until all four are published, a yellow box says **Not ready for launch**, because sign-up and checkout refer to these pages.

| Page | Public address | What it is for |
|---|---|---|
| Privacy Policy | `/legal/privacy` | What personal information you collect, why, how long you keep it and members' rights |
| Terms of Service | `/legal/terms` | The agreement members accept when they create an account or buy a course |
| Refund Policy | `/legal/refunds` | When and how buyers can get their money back; linked from checkout |
| Cookie Policy | `/legal/cookies` | Which cookies the site sets; linked from the cookie banner |

1. First fill in the company details at the bottom of `/admin/settings/legal` (see below) and click **Save**.
2. In the **Pages** list, click **Edit** next to a page (`/admin/settings/legal/<slug>`).
3. Read the yellow notice "Template — review with a lawyer before publishing". Laws differ by country and business: have the text checked and adapt it to how you really collect and use data.
4. Edit **Title** (up to 120 characters) and **Content** (Markdown: `##` for headings, `-` for lists, `**bold**`, `[links](https://…)`; up to 100,000 characters). Switch between **Write** and **Preview**.
5. Use **Insert:** to add placeholders that are filled in when the page is shown:

   | Placeholder | Filled with |
   |---|---|
   | `{{companyName}}` | Company name from the legal settings |
   | `{{companyAddress}}` | Registered address |
   | `{{contactEmail}}` | Privacy / legal contact email |
   | `{{siteName}}` | Your platform's name |
   | `{{siteUrl}}` | Public address of the site |
   | `{{lastUpdated}}` | Date of the last published change |

6. When the text is final, click **Remove notice**. A page that still contains the template notice cannot be published.
7. Click **Save draft** to keep working privately, or **Publish**. Later edits to a published page go live as a new version when you click **Publish changes**.

Other buttons: **Unpublish** (visitors get "page not found" and the footer, sign-up and checkout links to it disappear until you publish again), **Restore template** (standard pages only: puts the original text back and unpublishes the page) and **Delete page** (custom pages only; standard pages can only be unpublished).

Badges in the list: **Published · v<number>**, **Draft**, **Starter template**, **Review with a lawyer** (the notice is still in the text) and **Custom**. **View** opens a published page.

### Add a custom legal page

1. Click **New page** (top right).
2. Enter a **Title** (e.g. "Imprint" or "Accessibility statement") and an **Address** (lower-case letters, numbers and hyphens, up to 60 characters).
3. Click **Create page**. The editor opens; write the page and publish it as above.

### Company details, cookie banner and data retention

At the bottom of `/admin/settings/legal`:

| Section | Field | Default | Meaning |
|---|---|---|---|
| Company details | **Company name** (required, up to 120) | `LearnLoop Academy` | The legal entity that runs the site |
| | **Registered address** | empty | Shown in the privacy policy and terms |
| | **Privacy contact email** | empty = the contact email from General | Where members send privacy and legal requests |
| Cookies and data retention | **Ask visitors for cookie consent** | On | Shows the cookie banner on the first visit |
| | **Keep logs for** (days) | 365 | Audit events, error reports and cookie-consent records older than this are deleted automatically (consent records are always kept for at least a year). 30–3650 days |

Click **Save**.

### What visitors see: the cookie banner

On their first visit, visitors see a banner with **Customize**, **Reject non-essential** and **Accept all**. **Customize** opens **Cookie settings**:

- **Strictly necessary** (always on): sign-in, security, theme and the cookie choice itself.
- **Analytics** (for example Google Analytics).
- **Marketing** (for example the Meta Pixel).

Its buttons are **Reject non-essential**, **Save choices** and **Accept all**. Visitors can change their mind at any time with the **Cookie settings** link in the footer. When the banner is switched off nobody is asked, but visitors can still choose from that footer link, and optional tags stay off until they do.

**Good to know.** Old log entries are purged at most every six hours, triggered when admins open the log pages and when new audit entries are written. Members' own data export and deletion requests are covered in [Part 3](06-admin-system-and-developers.md).

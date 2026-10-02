# Administrator handbook (admins and moderators)

This is the manual for the people who run a LearnLoop site: **administrators** (role `admin`) and **moderators** (role `moderator`). It explains how to install and set up the platform, manage members, configure every settings page, take payments, run marketing and email, keep the system healthy and go live.

> **Status.** Features from rounds 1 and 2 were tested page by page in a browser. Round 3 features (marked **(Round 3)** in this handbook: the SQLite database, membership plans, bundles, installments, gifts, upsells, taxes and currencies, abandoned checkouts, teams, affiliates, the instructor marketplace, analytics, direct messages, the AI tutor, the blog, leads, broadcasts and sequences, the developer API and webhooks, data requests and more) are **built and covered by automated tests; not yet tried in a browser.**

**Other handbooks.** Building courses, batches, programs, quizzes, assignments, grading and certificates is in the [Instructor handbook](instructor.md); evaluations and certificates in the [Evaluator handbook](evaluator.md); what learners see in the [Student handbook](student.md). This handbook links there instead of repeating those tasks. Admins and moderators can do everything described in those handbooks, for every course and batch.

Examples use the demo data and the local address `http://localhost:3000`. All demo accounts use the password `password123`.

## Contents

**Part A: You and your role**
1. [Who this is for](#1-who-this-is-for)
2. [Signing in and your account](#2-signing-in-and-your-account)
3. [Your menu](#3-your-menu)
4. [What you can and cannot do](#4-what-you-can-and-cannot-do)
5. [Moderators: exactly what you can and cannot do](#5-moderators-exactly-what-you-can-and-cannot-do)

**Part B: First-time setup**
6. [Install and start the platform](#6-install-and-start-the-platform)
7. [The .env file, the first admin and demo data](#7-the-env-file-the-first-admin-and-demo-data)
8. [Removing the demo accounts and demo content](#8-removing-the-demo-accounts-and-demo-content)

**Part C: People**
9. [Members: find, add and edit](#9-members-find-add-and-edit)
10. [Import members from a CSV file](#10-import-members-from-a-csv-file)
11. [Roles](#11-roles)
12. [Disable, reset a password, delete](#12-disable-reset-a-password-delete)
13. [Login activity, locked accounts and two-step verification resets](#13-login-activity-locked-accounts-and-two-step-verification-resets)
14. [Data requests: GDPR export and erasure](#14-data-requests-gdpr-export-and-erasure)
15. [Message reports (direct messages)](#15-message-reports-direct-messages)

**Part D: Settings (one chapter per settings page)**
16. [General](#16-general)
17. [Branding](#17-branding)
18. [Features](#18-features)
19. [Sidebar](#19-sidebar)
20. [Learning](#20-learning)
21. [Categories](#21-categories)
22. [Video](#22-video)
23. [Storage & video: uploads, S3, ffmpeg and captions](#23-storage--video-uploads-s3-ffmpeg-and-captions)
24. [Installable app (PWA)](#24-installable-app-pwa)
25. [AI tutor](#25-ai-tutor)
26. [SEO and tracking](#26-seo-and-tracking)
27. [SEO: indexing and redirects](#27-seo-indexing-and-redirects)
28. [Legal pages and the cookie banner](#28-legal-pages-and-the-cookie-banner)
29. [Email and SMTP](#29-email-and-smtp)
30. [Payments: gateways, Stripe, Razorpay and webhooks](#30-payments-gateways-stripe-razorpay-and-webhooks)
31. [Transactions, refunds and invoices](#31-transactions-refunds-and-invoices)
32. [Coupons](#32-coupons)
33. [Plans, bundles, installments, gifts and checkouts](#33-plans-bundles-installments-gifts-and-checkouts)
34. [Taxes & currencies](#34-taxes--currencies)
35. [Points & leaderboard](#35-points--leaderboard)
36. [Badges](#36-badges)
37. [Security](#37-security)
38. [Backup & restore](#38-backup--restore)
39. [API keys and webhooks](#39-api-keys-and-webhooks)

**Part E: Money and growth**
40. [Upsells](#40-upsells)
41. [Affiliates](#41-affiliates)
42. [Teams](#42-teams)
43. [Instructor marketplace](#43-instructor-marketplace)
44. [Analytics](#44-analytics)

**Part F: Content, marketing and communication**
45. [Blog](#45-blog)
46. [Leads](#46-leads)
47. [Email outbox and Send a batch email](#47-email-outbox-and-send-a-batch-email)
48. [Broadcasts](#48-broadcasts)
49. [Email sequences](#49-email-sequences)

**Part G: Jobs**
50. [Jobs admin](#50-jobs-admin)

**Part H: System health**
51. [Audit log](#51-audit-log)
52. [Error log](#52-error-log)
53. [Health check](#53-health-check)
54. [Scheduled jobs (cron)](#54-scheduled-jobs-cron)

**Part I: Going live**
55. [Going live](#55-going-live)

**Part J: Developers**
56. [The developer API in brief](#56-the-developer-api-in-brief)

**Part K: Reference**
57. [Every environment variable](#57-every-environment-variable)

**Part L: Checklists and help**
58. [Daily and weekly checklist](#58-daily-and-weekly-checklist)
59. [Troubleshooting and FAQ](#59-troubleshooting-and-faq)
60. [URL quick reference](#60-url-quick-reference)

---

# Part A: You and your role

## 1. Who this is for

**Administrators** (`admin`) have full access: every page a moderator, course creator or evaluator can open, plus **Admin → Settings**, payments and money, analytics, leads, teams, affiliates, the marketplace, upsells, logs, login activity, backups and the developer API. An admin passes every role check in the code (`hasRole` in `src/lib/auth/session.ts` returns true for any check when the member has `admin`).

**Moderators** (`moderator`) oversee people and content but not the site configuration. They manage every course, batch, program, quiz and job (not only their own), add and import members, change roles (except Admin), read the email outbox, send batch emails, broadcasts and email sequences, and handle reported direct messages. They cannot open **Settings** or any admin-only page. Chapter 5 lists the exact differences.

**How someone gets these roles.**

| Role | Who can give it | Where |
|---|---|---|
| Admin | Only an admin | Member page `/admin/members/<id>` → **Roles**, the profile's **Roles** tab `/user/<username>/roles`, **Add member** or **Import members** (the Admin switch and the `admin` value in a CSV only work for admins) |
| Moderator | A moderator or an admin | The same places |
| The very first admin | Whoever installs the site | `.env`: `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` with `SEED_DEMO_DATA=false` (chapter 7), or the demo account `admin@learnloop.test` |

The first admin created from `.env` receives every staff role: Admin, Moderator, Course creator and Evaluator (`src/lib/db/bootstrap.ts`).

**Demo accounts for this role.**

| Account | Email | Roles |
|---|---|---|
| Admin User | `admin@learnloop.test` | Admin, Moderator, Course creator, Evaluator |
| Maya Chen | `maya@learnloop.test` | Course creator, Moderator |
| Priya Raman | `priya@learnloop.test` | Evaluator, Moderator |
| Daniel Okafor | `daniel@learnloop.test` | Course creator only (useful to compare: no moderator tools) |
| Alex Johnson | `alex@learnloop.test` | Student |

Maya and Priya are moderators, so they see every course and the moderator tools. Sign in as `admin@learnloop.test` to try admin-only pages.

## 2. Signing in and your account

The [Student handbook](student.md) explains signing in, profiles, notifications and account settings in full. What matters for admins and moderators:

1. **Sign in** at `/login` with your email and password. If two-step verification is on for your account, enter the 6-digit code on `/two-factor` (or click **Use a recovery code**).
2. **Set up two-step verification.** It is strongly advised for staff. Open the account menu (your avatar, top right) → **Security** (`/settings/security`) → **Set up two-step verification**. Scan the QR code, enter the code, and save the 10 recovery codes.
3. **When the site requires it.** If **Admin → Settings → Security → Require two-step verification for staff** is on and you have not set it up, every `/admin` page sends you to `/settings/security?required=2fa` first, with the banner **Two-step verification is required for your role**. Students are not affected.
4. **The Admin link.** Staff (course creators, evaluators, moderators, admins) get an **Admin** item in the account menu. It opens the **Overview** at `/admin`.
5. **Your profile and settings** work as for every member: **My profile** (`/user/<username>`), **Edit profile**, **Account settings** (`/settings`), **Security**, **Email notifications** (`/settings/notifications`), **Privacy & data** (`/settings/privacy`).
6. **Sign out** from the account menu → **Log out**. **Settings → Security → Signed-in devices** lets you sign out other devices.

**Lost your phone and recovery codes?** Another admin can reset your two-step verification in **Login activity** (chapter 13). If you are the only admin, keep your recovery codes safe: there is no other way back in except restoring a backup made before you turned it on.

**Good to know.**

- You cannot remove your own Admin role, and a moderator cannot remove their own Moderator role.
- There must always be at least one enabled administrator; the code refuses to disable, delete or demote the last one.
- There is no "log in as this member" (impersonation) feature. To see what a learner sees, sign in with a test student account in a private window.

## 3. Your menu

The sidebar is built in `src/lib/nav.ts`. It shows only what your role may open and what is switched on.

### Main and You sections

You see the same **Main** links as every member (Dashboard, Courses, Batches, Programs, Bundles, Membership, Certified members, Jobs, Instructors, Blog, Statistics, Community, Leaderboard, each only when its feature is on) and the **You** links (Notifications, Messages, My team, Affiliate, Peer reviews, Gifts, Teach, My profile, each with its own condition). The [Student handbook](student.md) describes them.

### Manage section

| Link | Address | Admin | Moderator | Shown when |
|---|---|---|---|---|
| Overview | `/admin` | Yes | Yes | Always (staff) |
| Manage courses | `/admin/courses` | Yes | Yes | Always |
| Manage batches | `/admin/batches` | Yes | Yes | Batches feature on |
| Manage programs | `/admin/programs` | Yes | Yes | Programs feature on |
| Quizzes | `/admin/quizzes` | Yes | Yes | Always |
| Question bank | `/admin/questions` | Yes | Yes | Always |
| Assignments (with the number of submissions waiting) | `/admin/assignments` | Yes | Yes | Always |
| Rubrics | `/admin/rubrics` | Yes | Yes | Always |
| Exercises | `/admin/exercises` | Yes | Yes | Programming exercises feature on |
| Certificates | `/admin/certificates` | Yes | Yes | Certifications feature on |
| Job openings | `/admin/jobs` | Yes | Yes | Jobs feature on |
| Blog | `/admin/blog` | Yes | Yes | Always (articles can be drafted while the public blog is off) |
| AI review | `/admin/ai` | Yes | Yes | AI tutor switched on |
| Members | `/admin/members` | Yes | Yes | Always |
| Email outbox | `/admin/emails` | Yes | Yes | Always |
| Settings | `/admin/settings` | Yes | No | Admins only |

### Links section

Extra links you add in **Admin → Settings → Sidebar**, then **Contact us** (the contact URL, or a `mailto:` link to the contact email, from **Admin → Settings → General**).

### Pages without a sidebar link

Many admin pages are reached from the grouped menu on the left of **Settings** (on phones, a scrollable row of buttons). The groups, exactly as in `src/components/admin/settings/settings-nav.tsx`:

| Group | Items (address) |
|---|---|
| System configuration | General (`/admin/settings/general`), Branding (`/admin/settings/branding`), SEO (`/admin/settings/seo`), Features (`/admin/settings/features`), Learning (`/admin/settings/learning`), Video (`/admin/settings/video`), Storage & video (`/admin/settings/storage`), AI tutor (`/admin/settings/ai`), API & webhooks (`/admin/settings/api`), Installable app (`/admin/settings/pwa`) |
| Content & marketing | Blog (`/admin/blog`), Leads (`/admin/leads`), Analytics (`/admin/analytics`), Affiliates (`/admin/affiliates`) |
| Course configuration | Categories (`/admin/settings/categories`), Badges (`/admin/settings/badges`), Points & leaderboard (`/admin/settings/gamification`), Rubrics (`/admin/rubrics`) |
| User management | Members (`/admin/members`), Teams (`/admin/teams`), Instructors & payouts (`/admin/marketplace`), Security (`/admin/settings/security`), Login activity (`/admin/security`) |
| Communication | Email (`/admin/settings/email`), Broadcasts (`/admin/broadcasts`), Email sequences (`/admin/sequences`), Outbox (`/admin/emails`) |
| Payment | Payments (`/admin/settings/payments`), Transactions (`/admin/settings/transactions`), Coupons (`/admin/settings/coupons`), Plans, bundles & installments (`/admin/settings/plans`), Taxes & currencies (`/admin/settings/taxes`), Upsells (`/admin/upsells`) |
| Customization | Sidebar (`/admin/settings/sidebar`) |
| Legal & compliance | Legal pages (`/admin/settings/legal`), Audit log (`/admin/audit`), Error log (`/admin/errors`) |
| Data | Backup & restore (`/admin/settings/data`) |

Pages whose address starts with `/admin/settings/` open inside the settings frame with this menu. The others (Members, Teams, Analytics, Affiliates, Upsells, Login activity, Audit log and so on) open as full pages; use the breadcrumbs at the top to get back.

**Moderators** do not see the Settings menu. They reach **Broadcasts** (`/admin/broadcasts`) and **Email sequences** (`/admin/sequences`) by typing the address, and **Message reports** (`/messages/moderation`) from the top of the Messages page.

### The Overview page (`/admin`)

**What it is.** Your staff home page: a greeting, upcoming live classes and evaluations, key numbers, quick links, recent enrollments, recent sign-ups and activity.

- **Key numbers**: Courses, Learners, Enrollments this week, Completions, **Revenue this month** (a link to Transactions for admins), Pending grading, Courses under review (a link to `/admin/courses?tab=under_review` for moderators and admins), Published.
- **Quick links** depend on your role. Moderators get Courses, Batches, Programs, Quizzes, Question bank, Assignments, Grading queue, Quiz submissions, Exercises, Certificates, Job openings, Members and Statistics (each only when its feature is on). Admins also get **Transactions**, **Coupons** and **Settings**.
- Opening the Overview as an admin also sends due **payment reminders** when that setting is on (chapter 30).

### Search (command palette)

Press `Ctrl K` (`⌘K` on a Mac) or click **Search or jump to…**. Admins get **Site settings** among the quick links; for moderators and admins, **People** results open the member list.

## 4. What you can and cannot do

Every page checks the role again on the server, so typing an address never gets around it. Someone without the role is sent to `/forbidden` ("No permission"); someone signed out is sent to `/login?next=…`.

| Area | Admin | Moderator |
|---|---|---|
| Overview `/admin` | Yes | Yes |
| All courses, chapters, lessons, sales pages, video analytics (any owner) | Yes | Yes |
| All batches, programs, quizzes, question bank, assignments, rubrics, exercises, peer review management | Yes | Yes |
| Certificates: issue, bulk issue, publish, revoke | Yes | Yes |
| Approve courses waiting for review | Yes | Yes |
| Job openings: edit or close any posting | Yes | Yes |
| Blog articles | Yes | Yes |
| AI tutor review queue and usage (when the tutor is on) | Yes | Yes |
| Members: list, add, import, edit profiles, change roles | Yes | Yes, except anything involving the Admin role or an admin's account |
| Members: change email, disable or enable, set a password, delete | Yes | No |
| Email outbox, single email view, **Send a batch email** | Yes | Yes |
| Email settings and the cron URLs | Yes | No |
| Open and click tracking switches | Yes | Read only |
| Broadcasts, broadcast audience, email tracking report | Yes | Yes |
| Email sequences | Yes | Yes |
| Message reports: read reported conversations, remove messages, resolve | Yes | Yes |
| Messaging switches (Direct messages, Learners can message classmates) | Yes | Read only |
| Points history of any member (`/leaderboard/points?member=…`) | Yes, with **Adjust points** | View only |
| Everything under `/admin/settings/…` | Yes | No |
| Leads, Analytics, Affiliates, Teams, Instructors & payouts, Upsells | Yes | No |
| Login activity, Audit log, Error log, Backup & restore, reload demo data | Yes | No |
| API keys and webhooks | Yes | No (the public `/developers` page only) |
| Any team's **My team** page (`/team?org=…`) | Yes | Only teams they own or manage |

Guards behind this table: pages use `requireRole(["admin"], …)` or `requireRole(["moderator"], …)`; server actions repeat the check with `isAdmin()` or `isModerator()` (`src/lib/auth/session.ts`). `isModerator()` is true for moderators and admins.

## 5. Moderators: exactly what you can and cannot do

This chapter is for moderators, and for admins deciding whether to give someone the Moderator role instead of Admin.

**In one sentence.** A moderator is a super-instructor and community manager: full control of all teaching content and of members (except admins), plus email and message moderation, but no site configuration, money or system data.

### What a moderator can do

1. **Everything a course creator and an evaluator can do, for every owner.** The code counts moderators as course creators (`isCreator`) and evaluators (`isEvaluator`), and `canManageCourse`, `canManageBatch`, `canManageProgram`, `canManageQuiz` and `canManageJob` all return true for moderators. So a moderator edits any course, batch, program, quiz or job, issues certificates and grades any submission. See the [Instructor handbook](instructor.md) and the [Evaluator handbook](evaluator.md) for how.
2. **Review courses.** The **Courses under review** number on the Overview links to the **Under review** tab of **Manage courses** (`/admin/courses?tab=under_review`).
3. **Members** (`/admin/members`): search and filter, **Add member**, **Import** from CSV, edit a member's **Profile** (name, username, location, headline, bio) and **Roles** (chapters 9 to 11).
4. **Roles**: give or remove Student, Course creator, Evaluator and Moderator, on the member page or the profile's **Roles** tab (`/user/<username>/roles`).
5. **Email outbox** (`/admin/emails`): read every email the platform sent and its delivery status, send a test email, retry failed emails, and **Send a batch email** (`/admin/emails/compose`) (chapter 47).
6. **Broadcasts** (`/admin/broadcasts`) and **Email sequences** (`/admin/sequences`): create, test, schedule and send; use the audience builder and the tracking report (chapters 48 and 49).
7. **Message reports** (`/messages/moderation`): read reported conversations, remove messages that break the rules and resolve reports (chapter 15).
8. **View anyone's points history** at `/leaderboard/points?member=<username>`.

### What a moderator cannot do

| Action | What happens if a moderator tries | Where the guard is |
|---|---|---|
| Open **Settings** or any `/admin/settings/…` page | Sent to `/forbidden`; the Settings link is not in the menu | `src/app/(app)/admin/settings/layout.tsx` and every settings page: `requireRole(["admin"])` |
| Grant the Admin role | The Admin switch is hidden; the server answers "Only administrators can grant the admin role." | `src/lib/actions/members.ts` |
| Change an admin's roles or profile | The admin's profile and roles show read only; "Only administrators can change an administrator's roles." / "Only administrators can edit an administrator's profile." | `src/lib/actions/members.ts` |
| Remove their own Moderator role | "You cannot remove your own moderator role." | `src/lib/actions/members.ts` |
| Change a member's email address | The Email field is read only | `src/app/(app)/admin/members/[id]/page.tsx` (`canEditEmail`) |
| Disable or enable an account | The **Sign-in access** card is not shown; "Only administrators can enable or disable members." | `src/lib/actions/members.ts` |
| Set a new password for someone | The **Reset password** card is not shown; "Only administrators can reset passwords." | `src/lib/actions/members.ts` |
| Delete a member | No bin icon and no **Delete member** card; "Only administrators can delete members." | `src/lib/actions/members.ts` |
| Import admins | Rows with the `admin` role fail the check | `src/lib/actions/members.ts` |
| Change email settings or see the cron URLs | Settings links and the **Cron URL** are hidden in the Outbox and Email sequences pages | `src/app/(app)/admin/emails/page.tsx`, `src/app/(app)/admin/sequences/page.tsx` |
| Change open and click tracking | Switches are read only; "Only administrators can change email tracking." | `src/lib/actions/broadcasts.ts` |
| Change the messaging switches | Shown disabled with "Only administrators can change these settings." | `src/lib/actions/messages.ts` |
| Leads, Analytics, Affiliates, Teams, Instructors & payouts, Upsells | `/forbidden` | `requireRole(["admin"])` on each page |
| Login activity, Audit log, Error log, Backup & restore | `/forbidden` | `requireRole(["admin"])` |
| Transactions, coupons, plans, taxes, payments | `/forbidden` | Settings pages |
| API keys and webhooks | `/forbidden` | `/admin/settings/api` |
| Adjust a member's points | No **Adjust points** button (the points settings page is admin-only) | `src/app/(app)/leaderboard/points/page.tsx` |
| Open payment settings from a course's pricing dialog | The **Open payment settings** button is hidden: "Ask an administrator to configure one, then turn on pricing here." | `src/components/admin/courses/course-settings-form.tsx` |

> **Note on wording.** The role switch describes Moderator as "Oversee every member, all content and the system settings" (`src/components/admin/settings/roles.ts`). In practice moderators cannot open the system settings; the description is out of date.

### Moderator quick start

1. Sign in (as `maya@learnloop.test` in the demo).
2. Open **Manage → Overview** to see what is waiting: grading, courses under review, upcoming live classes.
3. Open **Manage → Members** to add people or adjust roles.
4. Open **Manage → Email outbox** to check that emails are going out.
5. Open **Messages** and click **Message reports** at the top to handle reports.
6. For newsletters, type `/admin/broadcasts` in the address bar.

---

# Part B: First-time setup

## 6. Install and start the platform

**What it is.** LearnLoop is one Next.js web application with its own database (SQLite, built into Node.js). There is no separate database server. You run it on your computer to try it out, or on a server for real use (chapter 55).

**Who does it.** The site owner or a developer with access to the project folder (`C:/Users/pc/Desktop/ll/lms` on the owner's machine).

**Where.** A terminal opened in the project folder, and a browser at `http://localhost:3000`.

### Requirements

| You need | Why | Notes |
|---|---|---|
| **Node.js 22.13 or newer** (Node.js 24 recommended) | The app runs on Node.js and the database uses Node's built-in `node:sqlite` | Older versions stop with "SQLite storage needs Node.js 22.13 or newer". Check with `node --version`. The Docker image uses Node 24. |
| npm | Installs the packages | Comes with Node.js |
| A modern browser | To use the site | Chrome, Edge, Firefox or Safari |
| ffmpeg and ffprobe (optional) | Converts uploaded videos to adaptive streaming and makes thumbnails | Without them, videos play as uploaded. Set `FFMPEG_PATH` / `FFPROBE_PATH` if they are not on your PATH. |

### Step by step

1. Open a terminal in the project folder, for example `cd C:/Users/pc/Desktop/ll/lms`.
2. Install the packages: `npm install` (once, and again after updating the code).
3. Create your settings file from the template:
   - Git Bash, macOS, Linux: `cp .env.example .env`
   - Windows Command Prompt or PowerShell: `copy .env.example .env`
4. Decide between the demo site and an empty site (chapter 7). For a first try, leave `.env` as it is: you get the demo site.
5. Start the development server: `npm run dev`. On the very first start the terminal also shows `[store] created a new SQLite database at …`.
6. Open `http://localhost:3000`, click **Log in** and sign in as `admin@learnloop.test` with `password123` (demo site) or with your own `ADMIN_EMAIL` and `ADMIN_PASSWORD` (empty site).
7. Stop the server with `Ctrl + C`. Your data stays in the `storage/` folder.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server that reloads when code changes |
| `npm run build`, then `npm run start` | Production build and server (needed to try the installable app; requires `APP_SECRET` and an `https://` `APP_URL` unless the address is local) |
| `npm run db:backup` | Makes a database backup now (chapter 38) |
| `npm run db:restore -- <backup>` | Restores a backup (stop the app first when you can) |
| `npm run db:export` | Exports the whole database as JSON |
| `npm test`, `npm run lint` | Automated tests and code style checks (for developers) |

### Where your data lives

Everything the platform stores is in the `storage/` folder (never committed to Git):

| Path | Contents |
|---|---|
| `storage/lms.sqlite` (plus `-wal` and `-shm`) | The database: members, courses, progress, orders, settings. Change with `SQLITE_PATH`. |
| `storage/uploads/` | Uploaded images, documents, videos and their converted versions. Change with `UPLOAD_DIR`, or use S3 (chapter 23). |
| `storage/backups/` | Automatic daily backups (the newest 14 are kept) and backups you make. |
| `storage/.app-secret` | The generated development secret (only when `APP_SECRET` is empty). |
| `storage/.quiz-attempt-key` | The generated quiz-attempt signing key (only when `QUIZ_ATTEMPT_SECRET` is empty). |
| `storage/seo/` | SEO files such as the IndexNow key and redirects. |
| `storage/db.json` | The old JSON database. If it exists when a new SQLite database is created, it is imported once and renamed to `db.json.migrated-<timestamp>`. |

**Good to know.** Only one app process may use the database at a time. If you see "… is locked by another process", stop the other server or script first. Keep `storage/` on a local disk (not a network share).

### Emails while you try things out

With the default `MAIL_TRANSPORT=log` nothing is delivered. Every email is stored in the **Email outbox** (`/admin/emails`) with its status. One-time links (password reset, email confirmation) are hidden in the outbox but printed in the terminal on a line that starts with `[email:log] DEV ONLY — not delivered, not printed in production.` Copy the link into your browser to finish the flow. Real delivery needs SMTP (chapter 29).

## 7. The .env file, the first admin and demo data

**What it is.** `.env` is a text file in the project folder with secrets and server options. The server reads it when it starts, so **restart the server after every change**. Everything else (branding, features, prices, legal pages) is changed in **Admin → Settings** without a restart. The full list of variables is in chapter 57.

### The values that matter on day one

| Variable | Default | What to do |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | The public address without a trailing slash. Used in emails, payment callbacks, calendar feeds, the sitemap and cron URLs. |
| `APP_SECRET` | empty | A random value of at least 32 characters (`openssl rand -hex 32`). Empty is fine in development (one is generated in `storage/.app-secret`). **Required in production.** Never change it later (chapter 57 explains what breaks). |
| `SEED_DEMO_DATA` | `true` | `true`: a new database is filled with the demo school. `false`: a new database is empty except for one admin account. |
| `ADMIN_NAME` | `Administrator` | Name of that first admin (only with `SEED_DEMO_DATA=false`). |
| `ADMIN_EMAIL` | empty | Email of the first admin. **Required** with `SEED_DEMO_DATA=false`. |
| `ADMIN_PASSWORD` | empty | Password of the first admin, at least 8 characters. **Required** with `SEED_DEMO_DATA=false`. Change it after the first sign-in. |
| `MAIL_TRANSPORT` | `log` | Keep `log` while testing; `smtp` for real email (chapter 29). |

> **Important.** `SEED_DEMO_DATA` and the `ADMIN_…` values are read only when the database is created. Changing them later does nothing to an existing database. To start over, see chapter 8.

### Demo data on: the demo school

With `SEED_DEMO_DATA=true` (the default) a new database contains eight members on `@learnloop.test` (all with the password `password123`), six courses, three batches, a program, coupons (`LAUNCH20`, `REACT10`, the expired `SUMMER`), job openings, blog articles, membership plans, a bundle, an upsell, tax rules, badges, orders and activity. The log-in page shows a box **Demo accounts (password: password123)**. Never use demo data on a live site: the password is public.

### Demo data off: an empty site with your own admin

1. Stop the server.
2. In `.env` set:
   ```ini
   SEED_DEMO_DATA=false
   ADMIN_NAME=Your Name
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=a-long-password-1
   ```
3. Make sure no database exists yet: move `storage/lms.sqlite`, `storage/lms.sqlite-wal` and `storage/lms.sqlite-shm` out of `storage/`, and make sure there is no `storage/db.json` (it would be imported instead).
4. Run `npm run dev` and sign in with that email and password.

What you get: one enabled account with every staff role (Admin, Moderator, Course creator, Evaluator), default settings (brand name "LearnLoop", contact email `support@example.com`, manual payments, every feature on except the AI tutor and the instructor marketplace), no courses and no other members. The username is the part of the email before `@`.

If `ADMIN_EMAIL` or `ADMIN_PASSWORD` is missing, the server stops with: "SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD in your .env file to create the first admin account." A shorter password stops it with "ADMIN_PASSWORD must be at least 8 characters."

### Your first ten minutes as the new admin

1. Sign in and open the account menu → **Security**. Change your password and turn on two-step verification.
2. **Admin → Settings → General**: brand name, tagline, contact email (replace `support@example.com`).
3. **Admin → Settings → Branding**: logo, favicon, accent color.
4. **Admin → Settings → Features**: switch off what you do not use.
5. **Admin → Settings → Learning**: guest access, sign-up, default home page.
6. **Admin → Settings → Email**: sender name and footer; send a test email once SMTP is set.
7. **Admin → Settings → Payments**: choose a gateway and currency.
8. **Admin → Settings → Legal pages**: fill in company details, edit and publish the four policies.
9. **Manage → Members**: add your instructors and give them the Course creator role.

## 8. Removing the demo accounts and demo content

**What it is.** How to get rid of the demo school, either to start your real site or to reset a test copy.

**Who can do it.** Admins (in the browser) or whoever runs the server (files).

### Option A: start from a fresh, empty database (recommended)

1. Stop the server.
2. Set `SEED_DEMO_DATA=false`, `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` (chapter 7).
3. Move `storage/lms.sqlite`, `storage/lms.sqlite-wal` and `storage/lms.sqlite-shm` out of `storage/` (keep them somewhere in case you need them). Make sure there is no `storage/db.json`.
4. Optionally empty `storage/uploads/` (demo uploads) and `storage/backups/` (backups of the demo database).
5. Start the server. The new database contains only your admin.

### Option B: clean up by hand in the browser

Use this only when you already built real content on top of the demo site.

1. Create your own admin account: **Manage → Members → Add member**, switch on **Admin** (and the other roles you want), click **Add member**.
2. Sign out and sign in with the new account.
3. Delete or reassign the demo content first. A member who owns content (courses, batches, programs, quizzes, questions, assignments, exercises, live classes, job posts, or who is listed as a course instructor or evaluator) cannot be deleted: "This member owns courses, batches or other content. Reassign it, or disable the account instead." Delete demo courses in **Manage courses**, batches in **Manage batches** and so on (see the [Instructor handbook](instructor.md)).
4. In **Manage → Members**, search for `learnloop.test` and delete each demo account (`admin`, `maya`, `daniel`, `priya`, `alex`, `sofia`, `liam`, `emma`) with the bin icon. Accounts that still own content can be **disabled** instead (member page → **Sign-in access** → **Disable account**); a disabled account cannot sign in.
5. Delete demo coupons (**Settings → Coupons**), plans and bundles (**Settings → Plans, bundles & installments**), the demo upsell (**Upsells**), tax rules (**Settings → Taxes & currencies**), job openings, blog articles and badges you do not want.
6. Review every settings page: the demo values (for example the contact email) stay until you change them.

> **Note.** DEPLOYMENT.md's pre-launch checklist says to search for `example.com` addresses to find demo accounts. The demo accounts actually use `@learnloop.test`; search for that instead.

### Option C: reload the demo data (test copies only)

**Where.** **Admin → Settings → Backup & restore** (`/admin/settings/data`), red card **Reload demo data** at the bottom.

1. Click **Reload demo data**.
2. In **Reload the demo data?**, type `RESET` (capitals).
3. Click **Reload demo data**.

What happens: the current data is first saved as a **Safety** backup (restore it from the list on the same page if you change your mind), then every record (members, courses, progress, payments and settings) is replaced with the original demo content and everyone is signed out. If your account exists in the demo data you stay signed in ("Demo data reloaded. Your previous data is kept as …"); otherwise you go to the log-in page ("Demo data reloaded. Sign in with a demo account (password: password123)."). If the site was started with `SEED_DEMO_DATA=false`, the card warns that the admin account from your `.env` file will be gone.

---

# Part C: People

## 9. Members: find, add and edit

**What it is.** The list of everyone with an account, where you add people, edit profiles, change roles and (admins) manage access.

**Who can use it.** Moderators and admins. Admin-only parts are marked.

**Where.** `/admin/members`. Sidebar **Manage → Members**, or **Settings → User management → Members**.

### The members list

- Header numbers: **Members** (every account), **Staff** ("Any role besides student"), **Disabled**.
- Header buttons: **Settings** (admins only; opens General settings), **Import**, **Add member**.
- Filters: the search box ("Search by name, email or username"), **Filter by role** (All roles, Student, Course creator, Evaluator, Moderator, Admin) and **Filter by status** (Any status, Enabled, Disabled). Filters are kept in the address, for example `/admin/members?role=moderator&status=enabled&search=maya`, so you can bookmark them.
- Table: **User** (name and email), **Roles** (a red **Disabled** badge for disabled accounts), **Enrollments**, **Last active**, **Joined**. Newest first, 25 at a time; **Load more** shows the next 25.
- Row icons: the person icon opens the public profile (`/user/<username>`); the bin icon (admins only, not on your own row) deletes the member.

### Add a member

1. Click **Add member** (`/admin/members/new`).
2. Under **Account** fill in **Full name** (required), **Email** (required, unique), **Username** ("Optional. Taken from the email if left empty.") and **Password** (at least the minimum length from Security settings, 8 by default, with letters and numbers). **Generate** fills in a strong password; the eye icon shows it.
3. Under **Roles**, switch on what the person needs. "Members with no role are added as students." Only admins see the **Admin** switch.
4. Click **Add member**. You land on the new member's page.
5. Send the password securely. "They can change it from their profile once signed in."

Accounts created by staff count as having a confirmed email, so the email-confirmation rule never blocks them.

### A member's page

**Where.** `/admin/members/<id>` (click a name in the list).

- **Top**: name, email, `@username`, role badges, **Disabled** when disabled, **You** on your own page, and **Go to Profile**.
- **Profile**: Full name, Email ("Only administrators can change email addresses."), Username, Location, Headline, Bio. Edit, then save in the save bar ("Member updated"). Moderators see an admin's profile read only.
- **Roles**: chapter 11.
- **Admins only**: **Sign-in access**, **Reset password** and **Delete member** (chapter 12).
- **Side panel**: Joined, Last active, Courses (enrollments and completed), Batches, Certificates, the member's learning-goals answers (persona) if given, and **Badges**.
- **Below**: **Course enrollments** with progress and how access was granted, **Batches**, **Payments** (admins get **View in Transactions** and invoice links), **Certificates**.

**Good to know.** Every add, import, profile change, role change, enable/disable, password reset and deletion is written to the **Audit log** (chapter 51).

## 10. Import members from a CSV file

**What it is.** Add up to 500 members at once from a spreadsheet, with every row checked before anything is created.

**Who can use it.** Moderators and admins. "Only administrators can import admins."

**Where.** `/admin/members/import` (the **Import** button on the members list).

### Step 1: prepare the file

1. Click **Download template**. It downloads `members-import-template.csv`:
   ```csv
   email,name,roles,password
   ada@example.com,Ada Lovelace,student,
   grace@example.com,Grace Hopper,"course_creator; batch_evaluator",Welcome2024
   alan@example.com,Alan Turing,moderator,
   ```
2. Fill it in with Excel or Google Sheets and save it as **CSV (UTF-8)** ("In Excel or Google Sheets, use File → Download → CSV.").

| Column | Required | Rules |
|---|---|---|
| `email` | Yes | Unique within the file and among existing members. Also recognised as "Email address", "E-mail", "Email ID", "User email". |
| `name` | Yes | Full name. Also recognised as "Full name", "Fullname", "Member name". |
| `roles` | No | Several separated by semicolons. Empty means Student. Accepted: `student`, `course_creator`, `batch_evaluator`, `moderator`, `admin`, the labels ("Course creator", "Evaluator"…) and the aliases `instructor`, `creator`, `evaluator`, `learner`, `administrator`. |
| `password` | No | Same rules as Add member. Empty means a password is generated and shown once after the import. |

Limits: 1 MB per file, 500 member rows per file. Column order does not matter; blank lines are skipped.

### Step 2: upload and check

1. Drop the file on the box ("Drop a CSV file here or click to browse").
2. The **Preview** shows how many rows are ready, how many have errors and how many passwords will be generated. Each row shows **Line**, **Member**, **Roles**, **Password** ("Generated" or "From file"), **Status** and **Errors**.
3. Tick **Show only rows with errors** to see just the problems (duplicate emails, existing members, unknown roles, short passwords).
4. Fix the file and click **Choose another file**, or continue: rows with errors are skipped.

### Step 3: import

1. Click **Import N members**. If some rows have errors, confirm with **Import valid rows**.
2. The summary shows **Imported**, **Skipped** and **Generated passwords**.
3. If passwords were generated, click **Download results** immediately: "Generated passwords appear only on this page."
4. **Import another file** starts again.

## 11. Roles

**What it is.** Roles decide what a member may do. A member can have several roles.

| Role (as shown) | Code | Description on the role switch |
|---|---|---|
| Student | `student` | Take courses and follow their progress |
| Course creator | `course_creator` | Create and manage courses, chapters and lessons |
| Evaluator | `batch_evaluator` | Run batches and review and grade submissions |
| Moderator | `moderator` | Oversee every member, all content and the system settings (but see chapter 5: no settings in practice) |
| Admin | `admin` | Full access, including site settings, payments and data |

**Who can change roles.** Moderators and admins; only admins can give or remove **Admin** or change an admin's roles.

**Where.** On the member page (`/admin/members/<id>`, card **Roles**), or on the member's profile **Roles** tab (`/user/<username>/roles`). When adding or importing members you set roles at the same time.

**Step by step.**

1. Open **Manage → Members** and find the person.
2. Open their page and go to **Roles**.
3. Switch roles on or off and save. The member sees the new menus on their next page load; they do not need to sign in again.

**Rules the server enforces** (`src/lib/actions/members.ts`):

- "Only administrators can grant the admin role." / "Only administrators can change an administrator's roles."
- "You cannot remove your own admin role." / "You cannot remove your own moderator role." (the switch is locked on your own page).
- "There must be at least one administrator."
- Unticking every role makes the member a Student.
- Every change goes to the audit log.

**Choosing a role.**

| You want someone to… | Give them |
|---|---|
| Build and teach their own courses | Course creator |
| Run cohorts, grade and issue certificates | Evaluator |
| Look after every course, member and email, but not money or settings | Moderator |
| Configure the site, payments and data | Admin (give it to as few people as possible) |

Instructors who join through the marketplace get **Course creator** automatically when you approve them (chapter 43).

## 12. Disable, reset a password, delete

**Who can do it.** Admins only, and never on their own account.

### Disable or enable an account

1. Open the member's page and find **Sign-in access**.
2. Click **Disable account**, then **Disable** in "Disable <name>?". "They're signed out right away and can't sign in again until you re-enable the account."
3. To undo: **Enable account**, then **Enable**. They sign in with their current password.

The last enabled administrator cannot be disabled ("There must be at least one enabled administrator."). A disabled member who tries to sign in sees "This account has been disabled. Contact support."

### Set a new password for a member

1. Open the member's page and find **Reset password** ("Choose a new password and send it to the member securely.").
2. Type a **New password** and the same in **Confirm password**, or click **Generate**.
3. Leave **Sign the member out on every device** ticked unless you have a reason not to.
4. Click **Update password** ("Password updated for <name>.").

This also cancels emailed reset links and any sign-in waiting for a two-step code. To let the member choose their own password, use **Send reset link** in Login activity (chapter 13).

### Delete a member

1. Open the member's page → **Delete member**, or click the bin icon in the list.
2. Confirm **Delete** in "Delete <name>?" ("The account is deleted permanently. This can't be undone.").

What is removed: the account, sessions, enrollments and progress, video watch data, notes, reviews, submissions, batch and program memberships, certificates and requests, evaluator slots, badges, activity, notifications, job applications and the member's discussion posts. **Payment records are kept** for accounting; unpaid orders are marked failed.

Refused when: it is your own account, the last administrator, or a member who owns content ("Reassign it, or disable the account instead.").

### Delete or erase?

| | Delete member (member page) | Erase account (Audit log → Data requests, chapter 14) |
|---|---|---|
| Account record | Removed | Kept, stripped of personal data |
| Learning records | Removed | Personal data removed; counts stay correct |
| Payments | Kept as they were | Kept, billing details removed |
| Blocked when | Member owns content; last admin | Only admin; membership billed by a gateway |
| Recorded as a data request | No | Yes |

Use **Erase** for a privacy (GDPR) request; use **Delete** for test or spam accounts.

## 13. Login activity, locked accounts and two-step verification resets

**What it is.** A log of every sign-in attempt (successful, failed or blocked) with IP address and device, a list of locked accounts, and account tools for one member.

**Who can use it.** Admins only.

**Where.** `/admin/security` (**Settings → User management → Login activity**). The **Security settings** button goes to `/admin/settings/security` (chapter 37).

**Numbers at the top**: Sign-ins (24h), Failed attempts (24h), Locked accounts, Staff with 2-step.

### Find attempts

1. Search ("Search email, name or IP").
2. **Filter by outcome**: Any outcome, Signed in, Failed or blocked.
3. **Filter by reason** (see the table).
4. **Time period**: Last 24 hours, Last 7 days, Last 30 days (default), All time.
5. Click an IP address to see every attempt from it. 50 rows per page; **Newer** and **Older** to move.

| Outcome shown | Meaning |
|---|---|
| Signed in | Normal sign-in |
| Account created | First sign-in after sign-up |
| Signed in with authenticator code | Two-step code accepted |
| Signed in with a recovery code | A recovery code was used (worth checking with the member) |
| Signed in after resetting password | Sign-in through a reset link |
| Password accepted, waiting for code | Not a failure; the code step is still open |
| Wrong password / No account with this email | Failed attempt |
| Wrong password — account locked | This failure triggered the lockout |
| Blocked: account temporarily locked / account disabled / too many attempts | Refused before checking the password |
| Wrong verification code / Wrong verification code — account locked | Bad two-step code |

### Account tools for one member

1. Search for the member; their name appears as a chip after **Account tools:**. Click it (or open `/admin/security?user=<member id>`).
2. A card shows **Status** (Active, Locked with time left, Disabled), **Email** (Confirmed, Admin-created, Not confirmed), **Two-step** (On with recovery codes left, Setup unfinished, Off) and **Failed attempts**.
3. Use the buttons:

| Button | Shown when | What it does |
|---|---|---|
| **Unlock** | Locked or has failed attempts | Clears the lockout and the counter |
| **Send reset link** | Account enabled | Emails a password reset link valid for 1 hour (needs working email) |
| **Mark email confirmed** | Email not confirmed | Marks the address confirmed; only do this if you know the member owns it |
| **Reset two-step verification** | Member uses it (not on yourself) | For a lost phone and lost recovery codes. Their authenticator and codes stop working, they are signed out everywhere and get a security email; they set it up again after signing in |
| **Sign out everywhere** | Not on yourself | Ends every session of the member |

**Open member profile →** goes to the member's admin page.

**Good to know.**

- The lockout rules (attempts, minutes) are set in chapter 37.
- Behind a reverse proxy, set `TRUST_PROXY_HOPS` (usually `1`) or IP addresses show as unknown.
- There is no per-device list of another member's sessions; each member manages their own under **Settings → Security**.

## 14. Data requests: GDPR export and erasure

**What it is.** Carry out a member's privacy request received by email or letter: give them a copy of their data, or erase their account. Members can also do both themselves under **Settings → Privacy & data** (`/settings/privacy`). (Round 3)

**Who can use it.** Admins only.

**Where.** `/admin/audit?tab=requests` (**Settings → Legal & compliance → Audit log**, tab **Data requests**), card **Requests received by email or letter**.

### Download a member's data

1. Under **Download a member's data**, choose the **Member**.
2. Click **Download data**. You get the same JSON file the member gets from their privacy settings.
3. Send it to the member over a secure channel. The download is rate limited; "Too many data downloads in the last hour" means wait and try again.

### Erase a member's account

1. Click **Erase an account…**.
2. Choose the **Member**, type **Your password** ("Confirms that you are making this change.") and type `DELETE` in **Type DELETE to confirm**.
3. Confirm.

What happens: the member is signed out everywhere and can never sign in again. Personal data is removed (name, email, profile, sessions, sign-in history, notes, preferences, notifications, emails, AI tutor chats, direct messages they sent, leads, job applications, uploaded pictures and résumés). Their posts and reviews show "Deleted user". Orders keep amounts and invoice numbers, but billing name, address and tax IDs are removed. A confirmation email goes to the old address and other admins are notified.

Refused for the only administrator and for members whose membership is still billed automatically by Stripe or Razorpay (cancel it first, chapter 33). You cannot erase yourself here.

### The requests list

Below the tools: chips **All**, **Data downloads**, **Account deletions**; search ("Search member or request id"); **Export CSV**; columns **Requested**, **Member**, **Type**, **Status**, **Completed**.

**Settings that affect it.** Retention of logs: **Settings → Legal pages → Keep logs for** (chapter 28).

## 15. Message reports (direct messages)

**What it is.** Members can send each other direct messages and report a conversation. Moderators and admins review reports here. (Round 3)

**Who can use it.** Moderators and admins review reports; only admins change the switches.

**Where.** `/messages/moderation` (**Messages** in the sidebar → **Message reports** button at the top, shown to moderators and admins).

**Step by step.**

1. Read the numbers: **Open reports**, **Resolved**, **Direct messages** (On or Off).
2. Choose the **Open** or **Resolved** tab, or search ("Search by member, reason or course").
3. Click **Review** to open the reported conversation. Moderators can read it and remove messages that break the rules.
4. Click **Resolve** when you are done ("Report resolved").
5. **Export CSV** downloads the reports.

**Messaging settings** (card at the bottom, `#settings`):

| Switch | Default | What it does |
|---|---|---|
| **Direct messages** | On | "Members get a Messages inbox. Learners can write to the instructors of courses and batches they're enrolled in; instructors and moderators can write to any member." |
| **Learners can message classmates** | Off | "Lets learners start conversations with other learners who share a course or batch with them." |

Admins click **Save messaging settings**. Moderators see "Only administrators can change these settings."

---

# Part D: Settings

**Who can use Part D.** Admins only. Every settings page and every save checks the Admin role again on the server (`requireRole(["admin"])` in `src/app/(app)/admin/settings/layout.tsx` and each page).

**How the settings pages work.**

1. Open **Manage → Settings** (`/admin/settings`). It opens **General**.
2. Pick a page from the grouped menu on the left (chapter 3 lists every group).
3. Change what you need. A save bar sticks to the bottom of the form and tells you where you stand: **Not saved**, **Saving…**, **Saved**, **Save failed** (the field with the problem turns red) or **All changes saved**.
4. Click **Save**. Changes apply to the whole site at once; no restart is needed.
5. If you try to leave with unsaved changes, **Discard your changes?** asks you to **Discard** or **Keep editing**.

Every save is written to the audit log (chapter 51). Settings that live in `.env` (secrets, keys, SMTP, storage) are shown read only on these pages with **Set** / **Missing** badges; change them in `.env` and restart (chapter 57).

## 16. General

**What it is.** Your platform's name, tagline, footer line, contact details and text direction.

**Where.** `/admin/settings/general` (System configuration → **General**).

**Step by step.**

1. Under **Brand** ("How your platform introduces itself across the app"):
   - **Brand name** (required, up to 60 characters): "shown in the sidebar and the browser tab". Default `LearnLoop`.
   - **Tagline** (up to 140): "A short line shown on the landing page hero." Default "Learn by doing. Master real skills."
   - **Footer text** (up to 300): "Shown at the bottom of every page, e.g. a copyright line."
2. Under **Contact information** ("Powers the "Contact us" link in the sidebar. A URL takes precedence over an email address."):
   - **Email**: where learners can reach your team. Default `support@example.com`; change it before launch.
   - **URL**: a contact or help-centre page (http or https).
3. Under **Preferences**, **Text direction**: **Automatic** (follows each visitor's language; Arabic shows right to left), **Left to right** or **Right to left**.
4. Click **Save** ("General settings saved").

**Good to know.** Renaming the brand does **not** change other places that contain "LearnLoop" by default. Update them too: the SEO **Title template** (`%s · LearnLoop`) and **Organization name** (`LearnLoop Academy`) in chapter 26, the legal **Company name** (`LearnLoop Academy`) in chapter 28, and the email **From name** (`LearnLoop`) and **Footer text** ("You are receiving this email because you have an account on LearnLoop.") in chapter 29.

## 17. Branding

**What it is.** Logo, browser-tab icon (favicon) and the accent color used for buttons, links, focus rings and progress bars in light and dark mode.

**Where.** `/admin/settings/branding` (System configuration → **Branding**; page title **Brand settings**).

**Step by step.**

1. Under **Logo & favicon**:
   - **Brand logo**: "Shown in the sidebar next to the brand name. Use a 32×32 px PNG or SVG." PNG, SVG, JPG or WebP up to 25 MB (`MAX_FILE_UPLOAD_MB`). You can upload a file or paste an image address.
   - **Favicon**: "Use a 32×32 px PNG or ICO."
2. Under **Accent color**: use the picker, type a hex value such as `#4f46e5`, or click one of the **Suggested colors** (Indigo, the default, Blue, Violet, Emerald, Teal, Rose, Orange, Slate).
3. Read the contrast line under the field: "passes WCAG AA for normal text", "passes only for large text" or "too low". Pick a darker shade if it warns you.
4. Check the **Live preview**, then click **Save** ("Branding saved").

**Good to know.** The accent color is also the theme color of the installable app (chapter 24). The app icons themselves are fixed files in `public/images/`. The default share image for social networks is set in SEO (chapter 26).

## 18. Features

**What it is.** Fourteen switches that turn whole areas of the platform on or off. "Turning a feature off hides it from navigation and blocks its pages. Existing data is kept and reappears when you turn it back on." All are on by default.

**Where.** `/admin/settings/features` (System configuration → **Features**).

| Group | Switch | What it controls |
|---|---|---|
| Learning experiences | **Courses** | Course catalog, course pages and the lesson player |
| | **Batches** | Cohort-based batches with timetables, assessments and announcements |
| | **Programs** | Learning paths that bundle several courses in order |
| | **Live classes** | Scheduled live sessions inside batches, with recordings |
| | **Programming exercises** | In-browser coding exercises checked against test cases |
| Community | **Discussions** | Question & answer threads on lessons, courses and batches (and the Community page) |
| | **Reviews** | Course ratings and written reviews |
| | **Notes** | Personal lesson notes and highlights |
| | **Badges** | Achievement badges |
| | **Notifications** | In-app notifications and the bell |
| Career & credentials | **Certifications** | Certificates, evaluations and paid certificates |
| | **Certified members** | Public directory of certified members (needs Certifications too) |
| | **Jobs** | The job board |
| Insights | **Statistics** | Platform statistics page |

Click **Save** ("Features updated").

**Other switches live elsewhere.**

| Feature | Switch |
|---|---|
| Guest access, sign-up | Learning (chapter 20) |
| Blog | SEO → **Publish the blog** (chapter 26) |
| Points and leaderboard | Points & leaderboard (chapter 35) |
| AI tutor | AI tutor (chapter 25), off by default |
| Membership plans, bundles, installments, gifts, checkout reminders | Plans, bundles & installments (chapter 33) |
| Affiliates | Affiliates → Settings tab (chapter 41) |
| Team seats | Teams → Settings tab (chapter 42) |
| Instructor marketplace | Instructors & payouts → Settings tab (chapter 43), off by default |
| Direct messages | Message reports page (chapter 15) |
| Installable app | Installable app (chapter 24) |
| Developer API | API & webhooks (chapter 39) |

## 19. Sidebar

**What it is.** Your own links in the sidebar's **Links** section (a forum, a help centre, a page of this site), plus an overview of the built-in items.

**Where.** `/admin/settings/sidebar` (Customization → **Sidebar**).

**Step by step.**

1. Under **Custom links** ("Shown under "Links" in the sidebar, in this order."), click **New**. **Add a link to the sidebar** opens.
2. Fill in **Label** (required, up to 40 characters), **Link** ("A path such as /programs or a full https:// URL"; `mailto:` links work too) and **Icon** (type in **Search icons** and click one). Check the **Preview**.
3. Click **Add** ("Link added to sidebar").
4. Reorder with the up and down arrows; edit with the pencil (**Edit sidebar link**); delete with the bin (**Remove**).

**Built-in items** shows Dashboard, Courses, Batches, Programs, Certified members, Jobs, Statistics, Notifications and Contact us as **Visible** or **Hidden**. You cannot edit them here: "These follow your Features and contact settings and each member's role."

## 20. Learning

**What it is.** Guest access, sign-up, lesson completion rules, the default home page and announcements of new courses and batches.

**Where.** `/admin/settings/learning` (System configuration → **Learning**).

| Section | Field | Default | What it does |
|---|---|---|---|
| Access & availability | **Allow guest access** | On | Visitors browse course and batch lists and preview lessons without logging in (also shows Instructors, Statistics and Leaderboard to guests) |
| | **Disable sign-up** | Off | "New members can only be added by an admin." (moderators can add members too) |
| | **Sign-up page content** | Empty | Markdown shown on the sign-up page, e.g. a consent notice (up to 5,000 characters; **Write** / **Preview**) |
| Completion time | **Lesson completion time (seconds)** | 30 | Time on a text lesson before it can be marked complete (1–3600) |
| | **Video completion threshold (%)** | 90 | How much of a video counts as watched (1–100) |
| Enforcement | **Enforce video completion** | On | Lessons with a video complete only after the video is played to the end |
| | **Enforce assignment completion** | On | Lessons with an assignment need it submitted |
| | **Enforce quiz completion** | On | Lessons with a quiz need it passed |
| | **Prevent skipping in videos** | Off | Learners can't jump ahead of the furthest point watched |
| Home & notifications | **Default home page** | Courses | Where signed-in members land: **Courses** or **Dashboard** |
| | **Announce new courses** | In-app | **Don't notify**, **In-app** or **Email** when a course goes live |
| | **Announce new batches** | In-app | The same for batches |

Click **Save** ("Learning settings saved").

**Good to know.** "Email" announcements need working email (chapter 29) and reach only members who kept the **Announcements** email category on.

## 21. Categories

**What it is.** Categories group courses and batches in the catalog and blog articles on the blog. Each category has a public landing page at `/courses/category/<slug>` with an introduction and its own search title and description (the landing-page editor is Round 3).

**Where.** `/admin/settings/categories` (Course configuration → **Categories**). Instructors choose a category when they edit a course or batch.

**Step by step.**

1. **Create**: in **New category**, type a **Name** (up to 60, unique); the slug is suggested (lowercase letters, numbers, dashes). Click **Create**.
2. **Rename**: click the pencil, change **Name** and **Slug**, click **Save**. The old address redirects to the new one (chapter 27).
3. **Landing page**: click the page icon (**Edit the <name> landing page**). Fill in **Introduction** (Markdown, up to 5,000 characters), **Search title** (up to 70; empty means "<Name> courses") and **Search description** (up to 300; empty means built from the introduction). Check the **Search result preview**, use **Open the page**, then **Save** ("Landing page saved").
4. **Delete**: click the bin and confirm. "The category is first removed from every course and batch that uses it, then deleted for good. You can't undo this."

The list shows **Category**, **Slug** and **Used by** ("Not used yet" or the number of courses and batches), with a note "No landing page introduction yet" where one is missing. Blog category pages use the same categories at `/blog/category/<slug>`.

## 22. Video

**What it is.** Protection for uploaded lesson videos, an optional moving watermark and two player options.

**Where.** `/admin/settings/video` (System configuration → **Video**).

1. Read the cards at the top: **Protectable videos**, **Older uploads** (uploaded before protection existed; their links keep working) and **External links** (YouTube and similar, not affected).
2. **Protected uploads**:
   - **Protect uploaded videos** (on): "Videos uploaded to this site play only through signed links that expire and work for one signed-in account."
   - **Signed link lifetime (minutes)**: default 60, 5–240. The player renews links automatically.
3. **Watermark**:
   - **Show a viewer watermark** (off): shows the signed-in learner's email over the video and moves it every few seconds, also in fullscreen. Picture-in-picture is off while it is shown.
   - **Watermark opacity**: 5% to 50% (default 18%), with a preview.
4. **Player**: **Seek-bar previews** (on) and **Autoplay the next lesson** (on; a five-second countdown learners can cancel).
5. Click **Save**.

**Settings that affect it.** Signing needs `APP_SECRET` (at least 32 characters). Without it, a warning appears; in production protected videos cannot be signed and show as unavailable.

## 23. Storage & video: uploads, S3, ffmpeg and captions

**What it is.** Where uploaded files are kept (this server or an S3-compatible bucket), conversion of lesson videos to adaptive streaming (HLS), automatic captions, the conversion queue and the media housekeeping job. (Round 3)

**Where.** `/admin/settings/storage` (System configuration → **Storage & video**).

The cards at the top show **Storage**, **Adaptive streaming** (videos that already have an HLS stream), **Conversion queue** (and failures) and **Uploads in progress**.

### File storage (read only, from `.env`)

Local storage shows **Driver** (Local disk), **Folder**, **Used** and **Free space**. A bucket shows **Provider**, **Bucket**, **Endpoint**, **Region**, **Access key**, **Secret key** (Set or Missing) and **Public URL**. **Test connection** writes a small file, reads it back (and through a signed link on S3), then deletes it.

**Move uploads to AWS S3, Cloudflare R2, Backblaze B2 or MinIO.**

1. Create a bucket and an access key with read/write rights.
2. In `.env` set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and as needed `S3_ENDPOINT` (empty for AWS; R2 `https://<account id>.r2.cloudflarestorage.com`; B2 `https://s3.<region>.backblazeb2.com`; MinIO `http://localhost:9000`), `S3_REGION`, `S3_FORCE_PATH_STYLE=true` (MinIO) and `S3_PUBLIC_BASE_URL` (an `https://` CDN for unprotected files).
3. Restart and open this page. A message such as "STORAGE_DRIVER is s3, but … is missing" means a value is missing; files stay local until it is fixed.
4. Click **Test connection**.
5. Under **Files still on this server**, click **Move to bucket** and confirm. Up to 500 files are copied, checked and removed locally per run; links keep working. The media job (chapter 54) also moves them over time.

DEPLOYMENT.md section 9 adds bucket advice: allow `GET` and `HEAD` from your `APP_URL` in CORS and expose `Content-Range`, `Content-Length` and `Accept-Ranges`; add a lifecycle rule that aborts incomplete multipart uploads after 1 day.

### Delivery

**CDN base URL**: the public origin of a CDN in front of your bucket. Images and documents are then served from it; protected videos still use signed links. Works only with S3 storage, overrides `S3_PUBLIC_BASE_URL`, and must have no query string, `#` or password.

### Video converter (ffmpeg)

Shows "ffmpeg … is installed" or **ffmpeg not found**. ffmpeg makes HLS streams and poster frames; without it videos play as uploaded. Install it (`winget install Gyan.FFmpeg` on Windows, `apt install ffmpeg` on Linux; already in the Docker image) or set `FFMPEG_PATH` / `FFPROBE_PATH`, then click **Check again**.

### Adaptive streaming (HLS)

1. **Convert uploaded videos to HLS** (on): each upload is converted in the background, one at a time. Until then (or if it fails) learners get the original file.
2. **Qualities to produce**: 1080p, 720p, 480p (defaults) and 360p. Only qualities at or below the uploaded resolution are made.
3. Click **Save** ("Storage settings saved").

### Captions

**Generate captions automatically** (off): sends the audio of new videos to a speech-to-text service; the transcript becomes captions, a searchable transcript and AI-tutor context. Needs `TRANSCRIBE_API_URL` and `TRANSCRIBE_API_KEY` (any OpenAI-compatible endpoint; `TRANSCRIBE_MODEL` defaults to `whisper-1`) **and** ffmpeg. Instructors can always upload or type transcripts.

### Conversion queue

Filter **All**, **Queued**, **Converting**, **Failed**, **Done**, or search. **Retry failed** requeues failures; **Convert all videos** queues every video that still needs it. Per row: **Cancel**, **Retry**, **Convert again**. The table updates itself while conversions run.

### Media cron

Copy the **Media cron URL** (`<APP_URL>/api/cron/media?key=…`) for a scheduler (every 5–15 minutes, chapter 54). **Run now** runs it immediately.

## 24. Installable app (PWA)

**What it is.** Members can install the site on a phone, tablet or computer; it opens in its own window, loads faster and shows a branded offline page.

**Where.** `/admin/settings/pwa` (System configuration → **Installable app**).

1. Under **App & offline support**:
   - **Installable app** (on): the master switch. Off removes the service worker on the next visit.
   - **Suggest installing the app** (on): a small install card (and Add to Home Screen steps on iPhone and iPad). Dismissed cards stay away for 14 days.
   - **Offline page** (on): a branded offline screen with **Try again**.
   The last two can only be changed while the app is on.
2. Click **Save**. **Preview offline page** opens `/offline`.

**Readiness** checks: **Served securely** (HTTPS or localhost), **Production build** (the service worker never registers in `npm run dev`), **Web app manifest** (`/manifest.webmanifest`), **App icons**, **Theme color** (your accent color). **This browser** shows the service worker state with **Check for updates** and **Clear offline data**.

**Good to know.** Stored on devices: app files, recently viewed images, the offline page and public pages visited signed out. Never stored: API responses, form submissions, lesson videos, admin or account pages.

## 25. AI tutor

**What it is.** A tutor that answers learners' questions using only the material of their course (lessons, transcripts, quiz explanations) and links to the lessons it used. It runs on Anthropic's Claude models. **Off by default.** (Round 3)

**Where.** `/admin/settings/ai` (System configuration → **AI tutor**). **Review queue** (top right) opens `/admin/ai`.

Cards at the top: **Status** (**Ready**, **Off** or **Key missing**), **Courses with the tutor**, **Answers (30 days)**, **Awaiting review**.

**Turn it on.**

1. Create a key in the Anthropic Console under **API keys**.
2. Add `ANTHROPIC_API_KEY=<your key>` to `.env` and restart. The key cannot be typed into this page: "The key is read from the server environment and never shown in full." It shows as **Configured** or **Not set**.
3. Under **Model**, choose the model. Each option shows its price per million input/output tokens:

   | Option | Note | Input / output per million tokens |
   |---|---|---|
   | Claude Opus 5.5 (default) | Recommended: most capable Opus model | $4 / $20 |
   | Claude Sonnet 5.5 | Faster replies at half the cost | $2 / $10 |
   | Claude Haiku 4.5 | Fastest and lowest cost | $1 / $5 |
   | Claude Fable 5.1 | Most capable model, highest cost | $10 / $50 |
   | Claude Opus 5 | Previous Opus model | $5 / $25 |
   | Claude Sonnet 5 | Previous Sonnet model | $2 / $10 |
   | **Another model** | Enter any model id your Anthropic account can use | |

4. Under **API key**, click **Test connection** ("Connected to <model> in … ms").
5. Under **Availability**, switch on **Turn on the AI tutor**. Keep **Instructor review queue** on so answers marked not helpful or reported go to the course instructors.
6. Under **Limits**, set **Questions per learner per day** (default 30, 0 = no limit; resets at midnight UTC; instructors and admins are not limited).
7. Optionally write **Instructions for the tutor** under **Extra instructions** (added after the built-in ground rules, which they cannot override; **Show the built-in ground rules** shows them).
8. Click **Save**.
9. Ask instructors to switch the tutor on in each course's **Settings** tab (see the [Instructor handbook](instructor.md)).

**Afterwards.** **Manage → AI review** appears for course creators, moderators and admins: `/admin/ai` (tabs **Flagged**, **Not covered**, **All answers**, **Reviewed**; **Export CSV**), `/admin/ai/usage` (answers, top questions, tokens, gaps) and `/admin/ai/conversations/<id>`. Moderators and admins see all courses.

**Good to know.** Answers cost money on your Anthropic account. Use the daily limit and a cheaper model to control spend.

## 26. SEO and tracking

**What it is.** How pages appear in search results and link previews, who runs the site (structured data), ownership proof for Google and Bing, the blog switch, a switch that hides the site, and Google Analytics / Meta Pixel tags loaded only after consent. (Round 3)

**Where.** `/admin/settings/seo` (System configuration → **SEO**). Four tabs: **Search appearance**, **Indexing**, **Redirects**, **Tracking** (`/admin/settings/seo/tracking`).

### Search appearance

1. **Search appearance**:
   - **Title template** (required, up to 70, must contain `%s`). Default `%s · LearnLoop`. Example: `%s · Your Academy`.
   - **Default meta description** (up to 300; aim for 120–160 characters).
   - **Keywords** (comma-separated, up to 500).
   - **Default share image** (1200×630 px; empty = a generated brand card).
   - **X (Twitter) handle**, e.g. `@yourbrand`.
2. Check the **Search result preview**.
3. **Organization**: **Organization name** (required; default `LearnLoop Academy`), **Logo** (square, at least 112×112 px; empty = the Branding logo), **Official profiles** (one URL per line, up to 20).
4. **Search engine verification**: paste the token or the whole meta tag into **Google Search Console** and/or **Bing Webmaster Tools**.
5. **Blog**: **Publish the blog** (on) makes `/blog` public with categories, topics and RSS. Off: articles can still be written but are not public.
6. **Indexing**: **Hide the entire site from search engines** (off) adds `noindex` to every page and blocks crawling in `robots.txt` (for staging or before launch; a red warning stays at the top while it is on). Account, admin and checkout pages are always hidden.
7. Click **Save** ("SEO settings saved").

**Verify in Google Search Console.**

1. Make sure the site is live and `APP_URL` is its real address.
2. In Search Console choose **Add property → URL prefix**, enter the address and pick **HTML tag**.
3. Paste the tag (or its `content` value) into **Google Search Console** here and **Save**.
4. Click **Verify** in Search Console. Bing works the same way with its **HTML Meta Tag** (`msvalidate.01`).

### Tracking

1. **Google Analytics 4**: the Measurement ID (for example `G-AB12CD34EF`). Loads after a visitor accepts **analytics** cookies.
2. **Meta Pixel**: the numeric Pixel ID. Loads after a visitor accepts **marketing** cookies.
3. Empty switches a tag off. Click **Save** ("Tracking settings saved").

Events sent: `page_view` / `PageView` (every page), `generate_lead` / `Lead` (lead form sign-up), `sign_up` / `CompleteRegistration` (lead confirms), `purchase` / `Purchase` (paid order, once per order). Tags never load before consent; withdrawing consent stops them in every tab. If **Ask visitors for cookie consent** is off (chapter 28) and a tag is set, a warning explains that tags only load for visitors who accept via **Cookie settings** in the footer.

**Good to know.** Canonical addresses are built from `APP_URL`, so set it correctly before launch. Course, batch, program, article, job and instructor pages get generated share cards automatically.

## 27. SEO: indexing and redirects

### Indexing

**Where.** `/admin/settings/seo/indexing` (SEO → **Indexing** tab).

- **Sitemap**: **Sitemap address** `<APP_URL>/sitemap.xml` (split into files under `/sitemaps/…` above 50,000 addresses), what is listed per section, and the `robots.txt` address (it tells crawlers to skip admin, account, checkout and API areas).
- **Feeds**: `<APP_URL>/rss.xml` (new courses) and `<APP_URL>/blog/rss.xml` (articles, when the blog is on).
- **Instant indexing (IndexNow)**: Bing, Yandex, Seznam, Naver and others are told when a course, batch or article is published, changed, renamed or removed (Google reads the sitemap instead).
  - **Key**: generated the first time something is published. **Copy**; **Key file** opens `<APP_URL>/indexnow.txt`. Paste an existing key and click **Use this key** when moving a site, or **Generate key**.
  - **Send all pages**: submits every sitemap address (only once the site is public).
  - **Check for changes now** → **Check now**: finds renamed and new pages immediately.

**Submit the sitemap.** Copy the **Sitemap address**, open **Sitemaps** in Google Search Console (and Bing Webmaster Tools), paste it and click **Submit**. Once is enough; the sitemap is rebuilt on every request.

Warnings you may see: "The site is hidden from search engines" (the noindex switch is on), or that `APP_URL` is `http://localhost:3000` (nothing is submitted from a local address).

`SEO_CANONICAL_HOST` in `.env` controls host redirects (chapter 57). There is also a human-readable sitemap at `/sitemap`.

### Redirects

**What it is.** When the address of a course, batch, program, job, article or category changes, the old address redirects (301) to the new one automatically. You can add your own redirects for retired pages or an older site.

**Where.** `/admin/settings/seo/redirects` (SEO → **Redirects** tab, with a count).

1. Under **Add a redirect**, fill in **Old address** (for example `/courses/old-name`) and **New address**, and click **Add**. Only paths on this site work; pages below the old address follow it.
2. Filter **All** or **Leading to a deleted page**, search, or **Export CSV**.
3. The table shows **Old address**, **New address**, **Destination** (**Live**, **Not public**, **Deleted**, **Page**) and **Added**.
4. Tick rows and click **Remove selected**, or use the bin on one row.

**Good to know.** Redirects are also written under `storage/seo/`, so `storage/` must be writable and kept with the database.

## 28. Legal pages and the cookie banner

**What it is.** Privacy Policy, Terms of Service, Refund Policy and Cookie Policy (starter templates), any extra legal pages, company details filled into them, the cookie consent banner and how long logs are kept. (Round 3)

**Where.** `/admin/settings/legal` (Legal & compliance → **Legal pages**); one page: `/admin/settings/legal/<slug>`. Public pages: `/legal/<slug>`.

### Get the four standard pages ready

They start as unpublished templates. Until all four are published, a yellow box says **Not ready for launch** (sign-up and checkout link to them).

| Page | Public address |
|---|---|
| Privacy Policy | `/legal/privacy` |
| Terms of Service | `/legal/terms` |
| Refund Policy | `/legal/refunds` |
| Cookie Policy | `/legal/cookies` |

1. Fill in the company details at the bottom of the page (below) and click **Save**.
2. In **Pages**, click **Edit** next to a page.
3. Read the notice "Template — review with a lawyer before publishing". Have the text checked and adapt it.
4. Edit **Title** (up to 120) and **Content** (Markdown, up to 100,000 characters; **Write** / **Preview**).
5. Use **Insert:** for placeholders: `{{companyName}}`, `{{companyAddress}}`, `{{contactEmail}}`, `{{siteName}}`, `{{siteUrl}}`, `{{lastUpdated}}`.
6. When the text is final, click **Remove notice** (a page with the notice cannot be published).
7. Click **Save draft** or **Publish**. Later edits go live with **Publish changes**.

Other buttons: **Unpublish**, **Restore template** (standard pages; puts the original back and unpublishes) and **Delete page** (custom pages only). Badges: **Published · v<number>**, **Draft**, **Starter template**, **Review with a lawyer**, **Custom**.

**Add a custom page** (for example an Imprint): **New page**, enter **Title** and **Address** (lowercase letters, numbers, hyphens, up to 60), **Create page**, then write and publish it.

### Company details, cookie banner and data retention

| Section | Field | Default | Meaning |
|---|---|---|---|
| Company details | **Company name** (required) | `LearnLoop Academy` | The legal entity that runs the site |
| | **Registered address** | Empty | Shown in the privacy policy and terms |
| | **Privacy contact email** | Empty (uses the General contact email) | Where privacy and legal requests go |
| Cookies and data retention | **Ask visitors for cookie consent** | On | Shows the cookie banner on the first visit |
| | **Keep logs for** (days) | 365 | Audit events, error reports and consent records older than this are deleted (consent records at least a year). 30–3650 |

Click **Save**.

**What visitors see.** A banner with **Customize**, **Reject non-essential** and **Accept all**. **Cookie settings** offers **Strictly necessary** (always on), **Analytics** and **Marketing**. Visitors can change their choice from the **Cookie settings** link in the footer. With the banner off nobody is asked, and optional tags stay off until a visitor accepts there.

## 29. Email and SMTP

**What it is.** How the platform sends email: delivery status (from `.env`), the sender name, which notifications are emailed, a test email and scheduled delivery.

**Where.** `/admin/settings/email` (Communication → **Email**). **Open outbox** (top right) goes to `/admin/emails`.

### Delivery (read only, from `.env`)

The badge says **Log only** (`MAIL_TRANSPORT=log`), **SMTP ready** or **Needs attention**. Rows: **Transport**, **Server** (host and port), **Encryption** (implicit TLS or "STARTTLS (required)"), **Sign-in** (`SMTP_USER` with **SMTP_PASS set** / **SMTP_PASS missing**), **Sender address** (from `MAIL_FROM`, or `SMTP_USER`), and **Connection check** with **Verify connection** ("Connects, negotiates TLS and signs in without sending any email").

**Set up real email.**

1. Choose a provider and verify your sending domain there (SPF, DKIM, DMARC), or mail lands in spam.
2. In `.env`:
   ```ini
   MAIL_TRANSPORT=smtp
   SMTP_HOST=smtp.postmarkapp.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_REQUIRE_TLS=true
   SMTP_USER=<user or token>
   SMTP_PASS=<password or token>
   MAIL_FROM="Acme Academy <no-reply@acme.example>"
   ```
3. Restart. The badge should say **SMTP ready**. Click **Verify connection**.
4. Under **Send a test email**, enter an address in **Send to** and click **Send test email**.

| Provider | `SMTP_HOST` | Port / `SMTP_SECURE` | User / password |
|---|---|---|---|
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 / false | SES SMTP credentials |
| Postmark | `smtp.postmarkapp.com` | 587 / false | Server API token as both |
| SendGrid | `smtp.sendgrid.net` | 587 / false | `apikey` / the API key |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | 587 / false | Domain SMTP login / password |
| Brevo | `smtp-relay.brevo.com` | 587 / false | Account login / SMTP key |
| Google Workspace | `smtp.gmail.com` | 465 / true | Address / app password (low limits) |

`SMTP_REQUIRE_TLS=true` (default) refuses unencrypted delivery to a remote server. Many VPS providers block port 25; use 587 or 465.

### The settings form

| Section | Field | Default | What it does |
|---|---|---|---|
| Notification emails | **Send email notifications** | On | "Email copies of notifications, announcements, batch messages and receipts. Password reset and verification emails are always sent." |
| | **Emailed notification types** | Enrollments, Live classes, Assignment grading, Quiz grading, Certificates, Announcements, Discussion replies, Mentions | Members only receive checked types, and can turn categories off in their own preferences. Also available: Badges, New courses, New batches, Other updates. **Select all** / **Clear** |
| Sender | **From name** | `LearnLoop` | The sender name; the address comes from `MAIL_FROM` |
| | **Reply-to address** | Empty | Where replies go (empty = the sender address) |
| | **Footer text** | "You are receiving this email because you have an account on LearnLoop." | Printed at the bottom of every email, e.g. your postal address |

Click **Save**.

### Scheduled delivery

"Emails go out in the background as soon as they're queued and are retried automatically (1 min, 5 min, 30 min, 2 h, 12 h; marked failed after 6 attempts)."

- **Cron URL**: `<APP_URL>/api/cron/emails?key=…` with a copy button. "Keep it secret: anyone with the URL can trigger delivery. It changes when APP_SECRET changes." The part after `key=` is **the cron key for every scheduled job** (chapter 54).
- **Outbox**: queued, sent and failed counts.
- **Last delivery run**: in this server process.

**Good to know.** Open and click tracking are switched on the **Email tracking** page (chapter 48). Members manage their categories at `/settings/notifications`; every marketing email carries an unsubscribe link.

---

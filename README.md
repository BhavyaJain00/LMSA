# lms

**LearnLoop** is a learning management system built with Next.js 16 (App Router), React 19, TypeScript and Tailwind CSS 4. It is inspired by [Frappe LMS](https://github.com/frappe/lms) and rebuilt from scratch with a fully custom UI. Lesson videos are self-hosted and protected (signed, expiring URLs), converted to adaptive HLS with ffmpeg and played in a hand-built HLS player. There are no YouTube/Vimeo embeds and no third-party UI, player, form, icon, mail or payment libraries. The only runtime dependencies are `next`, `react`, `react-dom` and `server-only`.

- **User guide:** [docs/README.md](docs/README.md) has one handbook per role (student, instructor, evaluator, admin).
- **Going live:** [DEPLOYMENT.md](DEPLOYMENT.md).
- **Contributing:** [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md).

## Features

**Round 1: the Frappe LMS feature set**
- Courses with chapters and lessons (video, Markdown, embeds, files), enrollment, progress, reviews, discussions, notes and certificates (public verification and printable pages).
- Batches with live classes, evaluations and evaluator slots; programs; quizzes with a question bank; assignments; code exercises.
- Jobs board, certified members, public profiles, statistics, notifications, onboarding persona questionnaire.
- Staff workspace for courses, batches, programs, quizzes, questions, assignments, exercises and certificates; admin members, roles, settings, branding, categories and sidebar.

**Round 2: platform**
- Protected video: signed and expiring media URLs, watch-progress tracking, custom player.
- Payments with Stripe and Razorpay (checkout, coupons, refunds, invoices), SMTP email with an outbox, templates and unsubscribe links.
- Account security: two-factor authentication (TOTP, QR codes, recovery codes), login history, rate limits, session management.
- Drip content and prerequisites, installable PWA with offline page, calendar (`.ics`) feeds, gamification (points, badges, streaks, leaderboard).

**Round 3: market-ready**
- **Data:** SQLite database (built-in `node:sqlite`) with automatic daily backups, restore and JSON export; optionally PostgreSQL / Supabase through Prisma (`DB_DRIVER=postgres`, see [DEPLOYMENT.md](DEPLOYMENT.md#15-using-supabase--postgresql)).
- **Media:** resumable chunked uploads up to 10 GB, local or S3/R2 storage, HLS conversion queue, adaptive-bitrate player, transcripts and automatic captions.
- **Commerce:** membership plans and subscriptions, bundles, installments, gifts, upsells, taxes/VAT invoices and currencies, abandoned-checkout reminders.
- **Growth:** affiliates, teams (seat purchases and invitations), instructor marketplace with revenue split and earnings, analytics.
- **Communication:** direct messages with moderation, broadcasts, email sequences, open/click tracking, segments, leads (double opt-in).
- **Teaching tools:** rubrics, peer review, course versions and copy, scheduled publishing.
- **SEO and marketing:** blog, course sales pages, category landing pages, sitemaps, RSS, IndexNow, JSON-LD, redirects, GA4/Meta Pixel after cookie consent.
- **Developers:** REST API v1 (`/api/v1`, API keys, OpenAPI) and signed outgoing webhooks.
- **AI tutor** answering from course material (Anthropic Claude, off by default).
- **Legal and operations:** editable legal pages, cookie consent, GDPR export and erasure, audit log, error log, health check, Docker + Caddy.

**Languages:** the interface is available in English, Hindi, Spanish, French and Arabic (right-to-left). The language follows the account preference, then the `ll_locale` cookie, then the browser. Course and blog content stays in the language it was written in.

## Quick start

Requires Node.js 24 (the database uses the built-in `node:sqlite` module). ffmpeg is optional in development: without it videos play as MP4.

```sh
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# set APP_SECRET in .env to 32+ random characters, e.g. `openssl rand -hex 32`
npm run dev
```

Open `http://localhost:3000`. On first start the database (`storage/lms.sqlite`) is created and, with `SEED_DEMO_DATA=true`, filled with demo content.

### Demo accounts

All demo accounts use the password `password123`. They exist only when `SEED_DEMO_DATA=true`. Remove them before going live.

| Email | Role |
| --- | --- |
| `admin@learnloop.test` | Administrator |
| `maya@learnloop.test` | Instructor (course creator, moderator) |
| `priya@learnloop.test` | Evaluator |
| `alex@learnloop.test` | Student |

## Route map

URLs are the same in every language. `[x]` is a dynamic segment.

**Public**
- Catalog: `/`, `/courses`, `/courses/[slug]`, `/courses/category`, `/courses/category/[slug]`, `/courses/tag`, `/courses/tag/[tag]`, `/batches`, `/batches/[slug]`, `/programs`, `/programs/[slug]`, `/bundles`, `/bundles/[slug]`, `/pricing`
- Content and people: `/blog`, `/blog/[slug]`, `/blog/category/[slug]`, `/blog/tag/[tag]`, `/instructors`, `/instructors/[username]`, `/user/[username]`, `/user/[username]/badges`, `/user/[username]/certificates`, `/jobs`, `/jobs/[slug]`, `/certified-members`, `/certificates`, `/certificates/[code]`, `/statistics`, `/leaderboard`, `/leaderboard/points`, `/developers`, `/sitemap`
- Marketing and gifts: `/free`, `/free/confirm`, `/free/unsubscribe`, `/gift`, `/redeem`, `/legal/[slug]`, `/offline`
- Sign-in: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/two-factor`, `/verify-email`
- Machine-readable: `/sitemap.xml`, `/sitemaps/[file]`, `/robots.txt`, `/rss.xml`, `/blog/rss.xml`, `/indexnow.txt`, `/manifest.webmanifest`, `/api/health`

**Learner** (signed in)
- Learning: `/dashboard`, `/you`, `/persona`, `/courses/[slug]/learn`, `/courses/[slug]/learn/[ref]` (ref = `chapter-lesson`, e.g. `1-3`), `/courses/[slug]/ask` (AI tutor), `/courses/[slug]/certification`, `/quiz/[id]`, `/quiz/submissions/[id]`, `/assignments/[id]`, `/exercises/[id]`, `/exercises/submissions`, `/exercises/submissions/[id]`, `/peer-reviews`, `/peer-reviews/[id]`
- Community: `/notifications`, `/messages`, `/messages/new`, `/messages/[conversationId]`, `/community`, `/jobs/new`, `/jobs/mine`, `/jobs/applications`, `/jobs/[slug]/edit`, `/jobs/[slug]/applications`
- Account: `/settings`, `/settings/security`, `/settings/notifications`, `/settings/calendar`, `/settings/privacy`, `/settings/subscription`, `/user/[username]/edit`, `/user/[username]/schedule`
- Purchases: `/billing/[type]/[id]`, `/billing/success/[orderId]`, `/billing/cancelled`, `/billing/history`, `/billing/invoice/[orderId]`, `/affiliate`, `/team`, `/team/buy`, `/join/[token]`

**Instructor and evaluator** (course creators, moderators, evaluators)
- `/teach`, `/teach/earnings`, `/peer-reviews/manage`, `/peer-reviews/manage/[assignmentId]`, `/user/[username]/slots`
- `/admin` overview, `/admin/courses` (`/new`, `/import`, `/[id]`, `/[id]/dashboard`, `/[id]/lessons/[lessonId]`, `/[id]/lessons/[lessonId]/transcript`, `/[id]/sales-page`, `/[id]/video-analytics`)
- `/admin/batches`, `/admin/programs`, `/admin/quizzes`, `/admin/questions`, `/admin/assignments`, `/admin/exercises`, `/admin/rubrics`, `/admin/certificates` (`/new`, `/bulk`), `/admin/jobs`, `/admin/blog`, `/admin/ai` (each with `/new`, `/[id]` and, where relevant, `/submissions`)

**Admin** (some pages are also open to moderators)
- People: `/admin/members` (`/new`, `/import`, `/[id]`), `/user/[username]/roles`, `/admin/security`, `/messages/moderation`
- Communication: `/admin/emails` (`/compose`, `/[id]`), `/admin/broadcasts` (`/new`, `/audience`, `/tracking`, `/[id]`, `/[id]/edit`), `/admin/sequences` (`/new`, `/[id]`, `/[id]/edit`), `/admin/leads`
- Money and growth: `/admin/analytics`, `/admin/affiliates`, `/admin/teams`, `/admin/marketplace`, `/admin/upsells`
- Operations: `/admin/audit`, `/admin/errors`, `/admin/ai/usage`, `/admin/ai/conversations/[id]`
- Settings: `/admin/settings` and `/general`, `/branding`, `/features`, `/sidebar`, `/learning`, `/categories`, `/badges`, `/gamification`, `/video`, `/storage`, `/pwa`, `/ai`, `/email`, `/payments`, `/plans`, `/coupons`, `/taxes`, `/transactions`, `/security`, `/legal`, `/legal/[slug]`, `/seo`, `/seo/indexing`, `/seo/redirects`, `/seo/tracking`, `/api`, `/api/webhooks/[id]`, `/data` (backup and restore)

**APIs:** `/api/v1/*` (public REST API, see `/developers`), `/api/payments/{stripe,razorpay}/webhook`, `/api/cron/{emails,webhooks,comms,media,commerce}`, plus internal routes for uploads, media, progress, search, transcripts and the AI tutor.

## Architecture

```
src/
  app/          routes: (app) shell pages, (auth), (learn) lesson player, (public) printable certificates, api/
  components/   ui/ kit, player/ (HLS engine and controls), layout/, and one folder per feature area
  i18n/         interface languages (no library): config, negotiation, formatter, messages/<locale>/<namespace>.ts
  lib/
    db/         store API, SQLite, PostgreSQL (Prisma) and JSON drivers, migrations, backups, seed data
    actions/    Server Actions ("use server"), one file per area
    services/   shared domain logic (progress, enrollment, notifications, badges, points, drip, ...)
    data/       read models (courses, users)
    <area>/     commerce, growth, comms, teaching, media, payments, email, seo, legal, ai, api, webhooks, ...
    events.ts   in-process domain event bus; handlers.ts registers each area's handlers
  proxy.ts      request proxy (Next.js 16's replacement for middleware)
```

- **Store and SQLite.** All data access goes through `src/lib/db/store.ts` (`getDb`, `all`, `findById`, `filter`, `insert`, `update`, `remove`, `mutate`, `getSettings`). The whole database is held in memory; the SQLite driver (`node:sqlite`, one table of JSON documents per collection) writes only the changed records, one transaction per mutation. `mutate()` runs callbacks one at a time, so read-check-write logic is race-free. Migrations run at start-up. Entity types live in `src/lib/types.ts`.
- **Services.** Cross-cutting rules (completing a lesson, issuing certificates, enrolling, notifying, awarding points and badges) live in `src/lib/services` and the feature folders, so pages, actions, the REST API and webhooks share one implementation.
- **Event bus.** Core flows `emit()` domain events (`payment.paid`, `payment.refunded`, `enrollment.created`, `user.registered`, `lead.created`, `lesson.completed`, `course.completed`, `certificate.issued`, `subscription.changed`) after the change is saved. Areas react with `on()` in `src/lib/<area>/handlers.ts`. Handlers run after the mutation, and their errors are logged but never reach the caller.
- **i18n.** Server code uses `getT(namespace)` and `getFormatter()` from `@/i18n/server`; client components use `useT` and `useFormatter` under an `I18nProvider`. See [src/i18n/README.md](src/i18n/README.md).
- **Configuration.** Secrets and server options come from `.env` (`src/lib/config.ts`, `src/lib/server-env.ts`, checked at start-up by `src/lib/env-check.ts`). Everything else is edited in *Admin → Settings*.

## Testing and scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build (standalone output) and server |
| `npm test` | Node's built-in test runner over `tests/**/*.test.ts` against a throwaway database (never touches `storage/` or `.env`) |
| `npm run test:watch` | Tests in watch mode |
| `npx eslint src tests` | Lint |
| `npx tsc --noEmit` | Type check |
| `npm run db:backup` | Back up the database (`-- --list` lists backups) |
| `npm run db:restore -- <backup>` | Restore a backup (takes a safety backup first) |
| `npm run db:export` | Export the database as JSON |
| `npm run test:pg` | PostgreSQL tests; the integration part needs `TEST_DATABASE_URL` (a throwaway server) |
| `npm run prisma:schema` | Regenerate `prisma/schema.prisma` (and a migration) after adding a collection |
| `npm run prisma:migrate` | Create or update the PostgreSQL tables (`prisma migrate deploy`, needs `DIRECT_URL`) |
| `npm run db:to-postgres` | Copy the SQLite database or a JSON export into an empty PostgreSQL database |

## Going live

Read [DEPLOYMENT.md](DEPLOYMENT.md): Docker + Caddy with automatic HTTPS, environment variables, cron jobs, backups, payments webhooks, SMTP, S3/R2, ffmpeg, upgrades and a pre-launch checklist. In short: set `APP_URL` (https) and `APP_SECRET`, set `SEED_DEMO_DATA=false` with your own admin, configure SMTP and a payment gateway, schedule the cron URLs, and test a backup restore before launch.

# Contributing to LearnLoop

This is the contract for everyone (people and AI agents) changing this LMS. Read it before writing code. The app is a **Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind CSS 4** rebuild of Frappe LMS with **fully custom components**. See [README.md](README.md) for the feature list and route map, and [DEPLOYMENT.md](DEPLOYMENT.md) for operations.

## Hard rules

1. **No third-party runtime libraries.** Allowed runtime dependencies: `next`, `react`, `react-dom`, `server-only`. UI, player, forms, icons, Markdown, dates, crypto, mail (SMTP), payments, S3 signing and i18n are all hand-built. Never import transitive packages from `node_modules` (e.g. `zod`).
2. **Never embed YouTube or Vimeo.** Videos are self-hosted, served through signed URLs and played by the custom HLS player in `src/components/player` (`VideoPlayer`) or, on lesson pages, `src/components/learn/lesson-video.tsx` (`LessonVideo`, which records watch progress).
3. **Next.js 16 conventions** differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` first.
   - `params` and `searchParams` are Promises: `const { slug } = await props.params`.
   - Use the global helpers `PageProps<"/courses/[slug]">`, `LayoutProps<"/">`, `RouteContext<"/api/x/[id]">` (run `npx next typegen` after adding routes).
   - `cookies()` and `headers()` are async. Middleware is `src/proxy.ts`.
4. **Permissions are checked on the server, every time.** Use `src/lib/auth/session.ts`: `getCurrentUser()`, `requireUser(nextPath)`, `requireRole([...roles], nextPath)`, `hasRole`, `isAdmin`, `isModerator`, `isCreator`, `isEvaluator`, `isStaff`. Roles: `student | course_creator | moderator | batch_evaluator | admin` (admin implies all). Course checks: `canManageCourse`, `canViewCourse` in `src/lib/data/courses.ts`. Every Server Action, route handler and API route re-checks permissions; never trust client input.
5. **Never touch real data or secrets.** Do not modify `.env`, `storage/db.json` or `storage/*.sqlite*`, and never commit them (`.gitignore` excludes `/storage/`, `.env*` except `.env.example`, and every `*.sqlite*`).

## Data: the store API and SQLite

- All data access goes through `src/lib/db/store.ts`: `getDb()`, `all(name)`, `findById`, `findOne`, `filter`, `count`, `insert`, `insertMany`, `update(name, id, patchOrFn)`, `remove`, `removeWhere`, `mutate(db => …)`, `getSettings()`. Never open the SQLite file directly from feature code.
- The database lives in memory; the SQLite driver (`src/lib/db/sqlite.ts`, `sqlite-core.mjs`, built-in `node:sqlite`) stores one JSON document per row, one table per collection, and writes only changed documents in one transaction per mutation. `DB_DRIVER=json` exists for development and tests.
- `mutate()` runs callbacks one at a time. Put every read-check-write sequence in **one** `mutate` callback, and change documents through references obtained inside it. Never call `mutate`/`insert`/`update` from inside a `mutate` callback (it deadlocks).
- With SQLite, documents and collections are tracking Proxies: `structuredClone()` cannot copy them. Clone documents (`{ ...doc }`, `JSON.parse(JSON.stringify(doc))`) or use `exportDatabase()`.
- Entity shapes and collection names are in `src/lib/types.ts`. Add new fields as **optional**. A new collection needs its type in `Database` and its name in `COLLECTIONS` (`store.ts`); its table is created automatically. Schema changes go in `MIGRATIONS` (`sqlite-core.mjs`): append a step and bump `SCHEMA_VERSION`, never edit a released step.
- Ids come from `uid("prefix")` (`src/lib/utils.ts`). Dates are ISO strings (`YYYY-MM-DD` for day-only values). Money is stored in the smallest currency unit (cents/paise).
- Record administrative actions with `audit(actor, "area.verb", { type, id }, meta)` from `src/lib/audit.ts` (never put secrets or request bodies in `meta`).

## Services, actions and events

- **Server Actions** live in `src/lib/actions/<area>.ts` with `"use server"` at the top and return `ActionResult<T>` (`src/lib/types.ts`) or call `redirect()`. Read form fields with `fd`, `fdBool`, `fdNumber`. After mutations call `revalidatePath(...)`; use `setFlash(message, tone)` (`src/lib/flash.ts`) before a `redirect()` to show a toast.
- **Shared services**, reuse them instead of re-implementing the rule:
  - `src/lib/services/`: `progress.ts` (`completeLesson`, `setLessonStatus`, `recalculateCourseProgress`, `issueCertificate`), `enrollment.ts`, `notifications.ts` (`notify`, `notifyMany`, `notifyModerators`), `badges.ts`, `points.ts`, `activity.ts`, `drip.ts`, `leads.ts`.
  - `src/lib/data/courses.ts` and `src/lib/data/users.ts` for read models (`getCourseOutline`, `getCourseSummaries`, `getPublicUser`, …).
  - Feature areas keep their logic in `src/lib/<area>/` (`commerce`, `payments`, `growth`, `comms`, `teaching`, `media`, `storage`, `email`, `seo`, `legal`, `ai`, `api`, `webhooks`, `calendar`, `transcripts`). Pages, actions, `/api/v1` and webhooks call the same functions.
- **Domain events** (`src/lib/events.ts`, names and payload types in `src/lib/events-shared.ts`):
  - Core flows call `emit(name, data)` after the change is saved: `payment.paid`, `payment.refunded`, `enrollment.created`, `user.registered`, `lead.created`, `lesson.completed`, `course.completed`, `certificate.issued`, `subscription.changed`. `emit` never throws and handlers run on a later tick.
  - React to an event in your area's `src/lib/<area>/handlers.ts` with `on(name, handler, { key: "area:purpose" })` (a stable `key` prevents duplicates on hot reload). Register the file with **one** import line in `src/lib/handlers.ts`.
  - Handlers must be idempotent (an event can be re-emitted after a retry or webhook replay) and must not rely on running inside the emitter's `mutate`. Add a new event to `events-shared.ts` with its payload type before emitting it.
- **Configuration.** Read environment variables only in `src/lib/config.ts` (public-safe) or `src/lib/server-env.ts` (secrets, server only). A new variable also goes into `.env.example` (grouped, with a placeholder and a one-line comment), `src/lib/env-check.ts` if a wrong value would break production, and the table in `DEPLOYMENT.md`. Everything an admin can change belongs in Settings (`src/lib/db/defaults.ts`), not in `.env`.
- **Cron.** Background work runs lazily during requests and through `/api/cron/{emails,webhooks,comms,media,commerce}`, all protected by `verifyCronKey`. Add new periodic work to the matching endpoint rather than creating a new one.

## UI and i18n

- **UI kit** in `src/components/ui`: buttons, inputs, cards, badges, avatars, progress, skeletons and empty states, tables, dialogs, tabs, dropdowns, toasts, `Icon.<Name>` (custom SVG set; add icons there in the same style), `FileUpload` (resumable uploads). Markdown: `<Markdown content={md} />` from `src/lib/markdown.tsx`. Use the kit; do not fork it.
- **Styling.** Tailwind 4 with the semantic tokens in `src/app/globals.css` (`surface`, `ink`, `ink-muted`, `border`, `accent`, `success`, `warning`, `danger`, `rounded-card`, `shadow-card`, …). Never hard-code palette colors: dark mode works through the tokens. Mobile-first, must work at 375 px. Use logical utilities (`ms-/me-`, `ps-/pe-`, `text-start`) and `rtl:rotate-180` on directional icons for Arabic.
- **Server Components by default**; add `"use client"` only for interactivity, and keep client components small.
- **Layouts.** `src/app/(app)` gets the sidebar shell, `(auth)` the minimal sign-in layout, `(learn)` the full-width lesson player, `(public)` printable pages.
- **Every user-facing string is translated** (English, Hindi, Spanish, French, Arabic). Follow [src/i18n/README.md](src/i18n/README.md):
  - Server: `const t = await getT("namespace")`, `getFormatter()`, `getLocale()` from `@/i18n/server`; use `generateMetadata` instead of a static `metadata` title.
  - Client: `useT("namespace")` and `useFormatter()` from `@/i18n/client`, under an `<I18nProvider namespaces={[…]} pick={…}>` in a server layout (admin pages use the slices in `src/components/admin/i18n-slices.ts`).
  - Add each key to `src/i18n/messages/en/<namespace>.ts` first, then to `hi`, `es`, `fr` and `ar`, with the same placeholders. Keys are stable `area.element` ids; never concatenate translated fragments; use ICU plurals (Arabic needs `zero/one/two/few/many/other`).
  - Format dates, numbers and prices with the formatter, never a hard-coded `"en-US"`. Emails, logs, audit entries, exports and API responses stay in English. Course and blog content is not translated.
- **Wording:** friendly, concise, sentence case. Empty states explain what will appear and offer the primary action. No TODOs or placeholder text.
- **Service worker:** when `public/sw.js` changes, bump its `VERSION` constant.

## Tests and quality bar

- `npm test` runs Node's built-in test runner over `tests/**/*.test.ts`. `tests/register.mjs` points every test process at a throwaway JSON database and upload folder with a fixed `APP_SECRET`; the real `storage/` and `.env` are never read. Next.js modules are stubbed in `tests/stubs/`.
- Put tests in `tests/<area>-<topic>.test.ts` (or `tests/<area>/`). Use `resetDb(fixture)` and the `make*` factories from `tests/helpers/db.ts`, `tests/helpers/request.ts` for request state, `fake-s3.ts` and `smtp-server.ts` for integrations, and `settleEvents()` before asserting on event handler effects. Tests must not touch the network.
- Every change ships with tests for its rules (permissions, money, state transitions, edge cases) and every bug fix with a regression test.
- Before finishing: `npx tsc --noEmit`, `npx eslint src tests` and `npm test` all pass. When several people or agents work at once, run only your own test files during development (`node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./tests/register.mjs --test tests/<file>.test.ts`) and the full suite once at the end.
- Keep the docs current: the role handbooks in `docs/roles/`, `README.md` (features, route map) and `DEPLOYMENT.md` (env vars, cron, webhooks) when behavior they describe changes.

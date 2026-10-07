# Interface languages (i18n)

LearnLoop's interface ships in **English** (`en`, the source), **Hindi** (`hi`),
**Spanish** (`es`), **French** (`fr`) and **Arabic** (`ar`, right-to-left). There is
no i18n library: this folder is the whole framework. This guide is the one
pattern every translator follows.

## How it works

| Piece | File | Use |
| --- | --- | --- |
| Locales, namespaces, `Intl` tags, `og:locale` | `config.ts` | `LOCALES`, `LOCALE_INFO`, `isLocale()` (client-safe) |
| Locale negotiation | `negotiate.ts` | account preference → `ll_locale` cookie → `Accept-Language` → English |
| Message formatting (ICU-lite) | `format.ts` | `{name}`, `{n, number}`, `plural`, `selectordinal`, `select` |
| Translator objects | `translate.ts` | `t(key, vars)`, `t.rich(key, vars)`, `t.raw(key)`, `t.has(key)` |
| Server helpers | `server.ts` | `getT(ns)`, `getFormatter()`, `getLocale()`, `getDirection()` |
| Client hooks | `client.tsx` | `useT(ns)`, `useFormatter()`, `useLocale()`, `useDirection()` |
| Client provider (server component) | `provider.tsx` | `<I18nProvider namespaces={[…]} pick={…}>` |
| What the client receives | `provided.ts` | `global.` keys, key-by-key merging of nested providers |
| `Intl` formatters | `formatters.ts` | dates, times, numbers, prices, relative time, lists, durations |
| All messages | `catalog.ts` + `messages/<locale>/<namespace>.ts` | do not edit `catalog.ts` |

- URLs are the same in every language. The language is stored in the `ll_locale`
  cookie and, for signed-in members, on the account (`User.locale`). It is
  changed with `setLocaleAction` / `setLocaleFormAction` (`src/lib/actions/locale.ts`),
  which the switchers use: header account menu → Language, `/settings` → Language,
  and the compact select in the auth screens and the site footer.
- The root layout sets `<html lang dir>` from the active language. Arabic is
  `dir="rtl"`, unless an admin forced a direction in Settings → General.
- **Content is not translated.** Course, lesson, quiz, blog and job text, user
  names, and anything admins type stay in the language they were written in.
  Translate only the interface around them. SEO follows the content: hreflang
  lists the content language and `x-default` (`CONTENT_LANGUAGES` in
  `src/lib/seo/metadata.ts`). Per-language URLs (`/es/...`) are a possible
  future step and need no change to message files.

## Namespaces and who edits what

| Namespace | Owner | Covers |
| --- | --- | --- |
| `common` | framework | generic actions and statuses, shared UI components, language switcher |
| `shell` | framework | sidebar, header, account menu, notifications bell, phone tab bar |
| `auth` | framework | log in, sign up, password reset, two-step verification, email confirmation |
| `public` | translator "public" | catalog, course/batch/program pages, blog, jobs, instructors, pricing, legal, marketing |
| `learning` | translator "learning" | lesson player, quizzes, assignments, exercises, peer reviews, AI tutor |
| `account` | translator "account" | dashboard, profile, settings, notifications, billing, messages, community, teams, PWA |
| `admin` | translator "admin" | everything under `/admin`, course editor, quiz builder, teaching tools, developers |

Each translator edits **only** the five files of their namespace:

```
src/i18n/messages/en/<namespace>.ts   ← English source: add every key here first
src/i18n/messages/hi/<namespace>.ts
src/i18n/messages/es/<namespace>.ts
src/i18n/messages/fr/<namespace>.ts
src/i18n/messages/ar/<namespace>.ts
```

`common`, `shell` and `auth` are read-only for translators. Use a `common` key
when it fits exactly (`t("actions.save")` through `useT("common")` /
`getT("common")`). If you need a word that is not there, add it to your own
namespace instead of editing `common`.

## Message files

English is a flat object of dotted keys, checked with `satisfies Messages`. Its
type defines the valid keys of the namespace:

```ts
// src/i18n/messages/en/learning.ts
import type { Messages } from "../../types";

const learning = {
  "player.next": "Next lesson",
  "player.progress": "{done} of {total} lessons complete",
  "quiz.questionsLeft": "{count, plural, one {# question left} other {# questions left}}",
} satisfies Messages;

export default learning;
```

Every other language is a `Translation<typeof en>`: the same keys, each
optional. A missing key falls back to English, and a key that does not exist in
English is a type error:

```ts
// src/i18n/messages/fr/learning.ts
import type en from "../en/learning";
import type { Translation } from "../../types";

const learning: Translation<typeof en> = {
  "player.next": "Leçon suivante",
  "player.progress": "{done} leçons terminées sur {total}",
  "quiz.questionsLeft": "{count, plural, one {# question restante} other {# questions restantes}}",
};

export default learning;
```

Rules for keys:

- `area.element`, lower camelCase segments: `catalog.filters.level`,
  `checkout.summary.total`, `editor.lesson.saveDraft`. Start with the page or
  component area so keys group and can be sliced with `pick`.
- Keys are stable identifiers. Do not encode the English text in the key, and
  do not rename keys later.
- One key per sentence or label. Never build sentences by concatenating
  translated fragments: word order differs between languages. Use placeholders.
- Translate every key into all four languages. Fallback to English is a safety
  net, not a plan.

## Message syntax (ICU-lite)

| Syntax | Example | Notes |
| --- | --- | --- |
| Placeholder | `"Hi {name}"` | values print as given; a missing value stays visible as `{name}` |
| Number | `"{count, number} learners"` | grouped for the locale: `12,000`, `12 000`, `12.000` |
| Plural | `"{count, plural, =0 {No lessons} one {# lesson} other {# lessons}}"` | `#` is the formatted number; `=N` exact matches win over categories |
| Ordinal | `"{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"` | |
| Select | `"{role, select, admin {Administrator} other {Member}}"` | `other` is required |
| Rich text | `"New here? <link>Create an account</link>"` | render with `t.rich` (below) |

Plural categories come from `Intl.PluralRules` of each language. `other` is
always required, and a missing category falls back to `other`:

| Language | Categories | Notes |
| --- | --- | --- |
| English, Spanish | `one`, `other` (Spanish also `many` for 1,000,000) | |
| French | `one`, `other` (`many` for large round numbers) | **0 and 1 are `one`**: "0 leçon", "1 leçon", "2 leçons" |
| Hindi | `one`, `other` | **0 and 1 are `one`**; nouns often do not change, but verbs and postpositions may |
| Arabic | `zero`, `one`, `two`, `few` (3–10), `many` (11–99), `other` (100+) | write all six; use `zero` for "no …" |

Arabic example:

```ts
"quiz.questionsLeft": "{count, plural, zero {لا توجد أسئلة متبقية} one {سؤال واحد متبقٍ} two {سؤالان متبقيان} few {# أسئلة متبقية} many {# سؤالًا متبقيًا} other {# سؤال متبقٍ}}",
```

There is no quoting: apostrophes are ordinary characters. A `{` that does not
start a valid placeholder is printed as is. Keep every placeholder of the
English message in each translation, with the same names (the tests check this).

## Server components, `generateMetadata`, actions, route handlers

```tsx
import { getT, getFormatter } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("public");
  return { title: t("catalog.metaTitle") };
}

export default async function CoursesPage() {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <>
      <h1>{t("catalog.title")}</h1>
      <p>{t("catalog.count", { count: courses.length })}</p>
      <p>{f.date(course.publishedAt)} · {f.price(course.priceCents, course.currency, t("catalog.free"))}</p>
    </>
  );
}
```

- Replace `export const metadata = { title: "…" }` with `generateMetadata`.
  Pass the active locale to SEO builders that accept one:
  `pageMetadata({ …, locale: await getLocale() })` sets `og:locale`.
- Server Actions: translate user-facing `error`, `message` and `fieldErrors`
  with `await getT(ns)` inside the action. Do not translate values that are
  compared in code (status ids, enum values, `fieldErrors.session === "expired"`).
- Emails, logs, audit entries, CSV/JSON exports and API responses stay in
  English. The recipient of an email may use another language than the person
  who triggers it.

## Client components

```tsx
"use client";
import { useT, useFormatter } from "@/i18n/client";

export function LessonFooter({ done, total }: { done: number; total: number }) {
  const t = useT("learning");
  const f = useFormatter();
  return <p>{t("player.progress", { done, total })} · {f.relative(updatedAt)}</p>;
}
```

`useT(ns)` reads messages that a **server** layout or page above the component
provided. `common` and `shell` are always there. For your namespace, wrap the
pages you own:

```tsx
// src/app/(learn)/layout.tsx (a server component in your directories)
import { I18nProvider } from "@/i18n/provider";

export default async function LearnLayout({ children }: LayoutProps<"/">) {
  return <I18nProvider namespaces={["learning"]}>{/* existing JSX */}{children}</I18nProvider>;
}
```

- Put the provider in the highest layout you own that covers the client
  components, or create a `layout.tsx` in a directory you own. Wrapping the
  JSX of a page works too.
- Only the listed namespaces are sent to the browser. For a large namespace,
  send the slices a page needs:
  `<I18nProvider namespaces={["admin"]} pick={{ admin: ["courses.", "editor."] }}>`.
  Nested providers merge key by key, so adding a provider never hides keys
  provided higher up, and providing the same namespace twice is harmless.
- **`global.` keys are on every page.** The root layout provides every
  `global.`-prefixed key of every namespace. Use that prefix (sparingly) for
  client components that render where your group has no layout: components
  mounted by the root or `(app)` layout (PWA install prompt, command palette,
  account security banner, footer sign-up form) and client components reused
  on another group's pages (for example `global.courseCard.enroll`).
  Exception: large areas listed in `ROUTE_PROVIDED_GLOBALS` (`provided.ts`)
  are left out of the root slice and provided by the layouts that use them.
  `global.player.*` (the video and audio player) comes from `PlayerI18n`
  (`src/components/player/player-i18n.tsx`): wrap any new page that renders
  `VideoPlayer` or `AudioPlayer` in it.
- `/admin` is split by route: the admin layout sends only shared admin
  slices, the members and settings layouts add theirs, and every settings
  page's own `layout.tsx` adds its form's slice (`<AdminI18n section=…>`,
  sections listed in `src/components/admin/i18n-slices.ts`). A new client
  prefix in `admin` must be added to the section of the route that renders
  it; `tests/i18n-payload.test.ts` fails for a prefix no section provides and
  for a client component whose keys its route's layouts do not provide.
- A simpler alternative for small client components: translate in the server
  parent with `getT` and pass the strings as props.
- Without a provider, `useT` shows keys instead of text and logs a development
  error naming the missing provider. Check every client component you convert
  is under a provider for its namespace (or uses `global.` keys).

## Rich text, links and emphasis

Keep a whole sentence in one message and mark the parts that become elements:

```tsx
// "register.loginPrompt": "Already have an account? <link>Log in</link>"
t.rich("register.loginPrompt", { link: (text) => <Link href="/login">{text}</Link> });

// "reset.subtitle": "For your {brand} account <b>{email}</b>."
t.rich("reset.subtitle", { brand, email, b: (text) => <strong>{text}</strong> });
```

Tag names and placeholder names must differ (`<b>{email}</b>`, not
`<email>{email}</email>`). A placeholder may also take a React element:
`t.rich("x", { count: <strong>{n}</strong> })`.

## Formatting dates, numbers and money

Never hard-code `"en-US"`. Use the formatter for the active language:
`getFormatter()` on the server, `useFormatter()` on the client.

| Method | Example output (en / fr / ar) |
| --- | --- |
| `f.date(iso, options?)` | Mar 1, 2026 / 1 mars 2026 / 1 مارس 2026 |
| `f.dateTime(iso)` | date and time |
| `f.clock("14:30")` | 2:30 PM / 14:30 |
| `f.number(n, options?)`, `f.count(n)` | 12,000 / 12 000; `count` is compact above 10,000 |
| `f.percent(42)` | 42% / 42 % |
| `f.price(cents, currency, freeLabel)` | $19.99 / 19,99 $US |
| `f.relative(iso)` | 3 days ago / il y a 3 jours / قبل 3 أيام |
| `f.list(["a", "b"])` | a and b / a et b |
| `f.duration(seconds)` | 1h 2m in the locale's unit style |

The helpers in `src/lib/utils.ts` (`formatDate`, `formatDateTime`,
`formatClock`, `formatPrice`, `formatNumber`, `relativeTime`) accept an optional
locale as their last argument. Without one they keep the English output.
Arabic and Hindi use Western digits so that prices and codes read the same next
to the catalog content.

Relative times and clock times differ between the server and the browser.
In client components, render them after mount, or reuse the existing
client-time components, to avoid hydration mismatches.

## Right-to-left

Arabic renders the whole document `dir="rtl"`. When you touch markup:

- Use logical utilities: `ms-/me-` (margin), `ps-/pe-` (padding),
  `inset-s-/inset-e-` (position), `text-start/text-end`,
  `border-s/border-e`, `rounded-s/rounded-e`. Avoid `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`.
- Flip directional icons: `<Icon.ArrowRight className="rtl:rotate-180" />`
  (also chevrons and "→" arrows). Do not flip icons that are not directional
  (play, search, check).
- Mark content that must stay left-to-right: email addresses, URLs, code,
  keyboard shortcuts and IDs get `dir="ltr"` on their own element.
- Letter-spacing is disabled for Arabic and Hindi (`globals.css`), because it
  breaks joined letters. Do not work around it.
- Arabic punctuation: `،` (comma), `؟` (question mark), `؛` (semicolon), and
  `«…»` for quotes. Hindi uses `।` only in long-form prose, and `.` is fine in
  UI text.

## Tone

- Natural, professional, product-quality wording, in the form a polished app in
  that language would use. Not word-for-word.
- Hindi in Devanagari, with common English loanwords where Indian users expect
  them (कोर्स, क्विज़, डैशबोर्ड, लॉग इन).
- Spanish: neutral, `tú`. French: `vous`, with a space before `: ; ? !`
  (« Supprimer ? »). Arabic: Modern Standard Arabic.
- Product terms: course / batch / program / quiz / assignment / certificate
  are used consistently. Check the `shell` files for how the navigation
  translated them and match it.
- The brand name, user content and placeholders are never translated.

## Testing

- `node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./tests/register.mjs --test "tests/i18n-*.test.ts"`
  checks every namespace in every language: no keys missing from English,
  placeholder names match English, every plural/select has `other`, Arabic
  plurals cover `zero/one/two/few/many`, and every template parses.
- `npx tsc --noEmit` catches unknown keys in `t("…")` calls and in translation
  files.
- To look at a language in the browser, use the language switcher (footer, or
  account menu → Language) or send `Accept-Language: ar` as a guest.

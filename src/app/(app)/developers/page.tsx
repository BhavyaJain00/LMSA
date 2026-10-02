import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/lib/config";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { pageMetadata } from "@/lib/seo/metadata";
import { buildEndpointDocs, curlExample, ERROR_CODES } from "@/lib/api/docs";
import { API_TAGS, ENDPOINT_LIST, endpoints } from "@/lib/api/endpoints";
import { WEBHOOK_HEADERS } from "@/lib/api/openapi";
import { DEFAULT_PER_PAGE, MAX_PER_PAGE, SORT_VALUES } from "@/lib/api/pagination";
import { API_AUTH_FAILURE_LIMIT, API_KEY_RATE_LIMIT } from "@/lib/api/rate-limit";
import { API_SCOPES } from "@/lib/api/scopes";
import { VERIFY_SAMPLES } from "@/lib/api/webhook-samples";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { TEST_EVENT_ID_PREFIX, buildTestPayload } from "@/lib/webhooks/payload";
import {
  AUTO_DISABLE_AFTER_MS,
  AUTO_DISABLE_MIN_FAILURES,
  DELIVERY_RETENTION_DAYS,
  DELIVERY_TIMEOUT_MS,
  MAX_DELIVERY_ATTEMPTS,
  RESPONSE_BODY_LIMIT,
  RETRY_DELAYS_MS,
} from "@/lib/webhooks/policy";
import { SIGNATURE_HEADER, SIGNATURE_TOLERANCE_SECONDS, WEBHOOK_SECRET_PREFIX } from "@/lib/webhooks/signature";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { tagAnchor } from "@/components/developers/anchors";
import { CodeBlock } from "@/components/developers/code-block";
import { CodeTabs } from "@/components/developers/code-tabs";
import { DocsNav, type DocsNavItem } from "@/components/developers/docs-nav";
import { EndpointBrowser } from "@/components/developers/endpoint-browser";
import { HashOpener } from "@/components/developers/hash-opener";
import { StatusCode } from "@/components/developers/method-badge";
import { ObjectList } from "@/components/developers/object-list";
import { InlineCode, RichText } from "@/components/developers/rich-text";
import { WebhookEventList } from "@/components/developers/webhook-event-list";
import { getFormatter, getLocale, getT } from "@/i18n/server";

type AdminT = Awaited<ReturnType<typeof getT<"admin">>>;

/** "1 minute", "3 hours" in the active language. */
function delayText(t: AdminT, ms: number): string {
  const HOUR = 3_600_000;
  if (ms % HOUR === 0) return t("pages.developers.delay.hours", { count: ms / HOUR });
  return t("pages.developers.delay.minutes", { count: Math.round(ms / 60_000) });
}

/**
 * Public developer documentation: REST API v1 and outgoing webhooks.
 * Everything is generated from the same registry the API validates against
 * (`src/lib/api/endpoints.ts`) and from the webhook event catalog, so the
 * reference cannot drift from the running API. The machine-readable form is
 * `/api/v1/openapi.json`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const [settings, t, locale] = await Promise.all([getSettings(), getT("admin"), getLocale()]);
  return pageMetadata(
    {
      title: t("pages.developers.metaTitle", { brand: settings.brand.name }),
      description: t("pages.developers.metaDescription"),
      path: "/developers",
      locale,
    },
    settings,
  );
}

function Section({ id, title, children, lead }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-border pt-8 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {lead && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{lead}</div>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function SubHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 pt-2 text-base font-semibold text-ink">
      {children}
    </h3>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-2 text-sm leading-relaxed text-ink-muted">{children}</div>;
}

function Definitions({ rows }: { rows: readonly { term: ReactNode; detail: ReactNode; key: string }[] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border text-sm">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:gap-4">
          <dt className="shrink-0 sm:w-56">{row.term}</dt>
          <dd className="min-w-0 text-ink-muted">{row.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

const ERROR_EXAMPLE = JSON.stringify(
  {
    error: {
      code: "validation_failed",
      message: "Some fields are invalid. See details for each one.",
      details: { email: "Must be a valid email address.", "roles[0]": 'Must be one of "student", "course_creator", "moderator", "batch_evaluator".' },
    },
  },
  null,
  2,
);

export default async function DevelopersPage() {
  const [settings, viewer, t, f] = await Promise.all([getSettings(), getCurrentUser(), getT("admin"), getFormatter()]);
  const code = (chunks: ReactNode) => <InlineCode>{chunks}</InlineCode>;
  const strong = (chunks: ReactNode) => <strong className="text-ink">{chunks}</strong>;
  const baseUrl = siteConfig.appUrl;
  const apiBase = `${baseUrl}/api/v1`;
  const brand = settings.brand.name;
  const admin = isAdmin(viewer);
  const docs = buildEndpointDocs(ENDPOINT_LIST, baseUrl);
  const tags = API_TAGS.filter((tag) => docs.some((doc) => doc.tag === tag));
  const perMinute = Math.round((API_KEY_RATE_LIMIT.limit * 60_000) / API_KEY_RATE_LIMIT.windowMs);
  const eventExamples = Object.fromEntries(
    WEBHOOK_EVENTS.map((event) => [event.name, JSON.stringify(buildTestPayload(event.name, baseUrl, `${TEST_EVENT_ID_PREFIX}4k8d2m`, new Date("2026-01-15T09:30:00.000Z")), null, 2)]),
  );
  const firstEvent = WEBHOOK_EVENTS[0]!;

  const nav: DocsNavItem[] = [
    { href: "#overview", label: t("pages.developers.nav.overview") },
    { href: "#authentication", label: t("pages.developers.nav.authentication") },
    { href: "#scopes", label: t("pages.developers.nav.scopes") },
    { href: "#rate-limits", label: t("pages.developers.nav.rateLimits") },
    { href: "#pagination", label: t("pages.developers.nav.pagination") },
    { href: "#errors", label: t("pages.developers.nav.errors") },
    { href: "#endpoints", label: t("pages.developers.nav.endpoints"), children: tags.map((tag) => ({ href: `#${tagAnchor(tag)}`, label: tag })) },
    { href: "#objects", label: t("pages.developers.nav.objects") },
    {
      href: "#webhooks",
      label: t("pages.developers.nav.webhooks"),
      children: [
        { href: "#webhook-requests", label: t("pages.developers.nav.requests") },
        { href: "#signatures", label: t("pages.developers.nav.signatures") },
        { href: "#retries", label: t("pages.developers.nav.retries") },
        { href: "#events", label: t("pages.developers.nav.events") },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl animate-fade-in pb-16">
      <HashOpener />
      <header className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
            <Icon.Code className="size-4" /> {t("pages.developers.eyebrow")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{brand} API</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {t("pages.developers.intro", { brand })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/openapi.json" className={buttonClasses({ variant: "outline", size: "sm" })} download="openapi.json">
            <Icon.Download className="size-4" />
            {t("pages.developers.openApiSpec")}
          </a>
          {admin && (
            <ButtonLink href="/admin/settings/api" size="sm" leftIcon={<Icon.Lock className="size-4" />}>
              {t("pages.developers.keysAndWebhooks")}
            </ButtonLink>
          )}
        </div>
      </header>

      {!settings.api.enabled && (
        <div role="status" className="mb-8 flex items-start gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            {t.rich(admin ? "pages.developers.disabled.admin" : "pages.developers.disabled.guest", { b: (chunks) => <strong>{chunks}</strong>, code })}
          </p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div>
          <DocsNav items={nav} />
        </div>

        <div className="min-w-0 space-y-10">
          <Section
            id="overview"
            title={t("pages.developers.nav.overview")}
            lead={
              <p>
                {t.rich("pages.developers.overview.lead", { code })}
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "base", term: <span className="font-medium text-ink">{t("pages.developers.overview.baseUrl")}</span>, detail: <InlineCode>{apiBase}</InlineCode> },
                {
                  key: "spec",
                  term: <span className="font-medium text-ink">{t("pages.developers.overview.openApi")}</span>,
                  detail: (
                    <a href="/api/v1/openapi.json" className="text-accent hover:underline">
                      {apiBase}/openapi.json
                    </a>
                  ),
                },
                { key: "format", term: <span className="font-medium text-ink">{t("pages.developers.overview.format")}</span>, detail: t("pages.developers.overview.formatDetail") },
                { key: "dates", term: <span className="font-medium text-ink">{t("pages.developers.overview.dates")}</span>, detail: t("pages.developers.overview.datesDetail") },
                { key: "money", term: <span className="font-medium text-ink">{t("pages.developers.overview.amounts")}</span>, detail: t("pages.developers.overview.amountsDetail") },
                { key: "nulls", term: <span className="font-medium text-ink">{t("pages.developers.overview.missing")}</span>, detail: t("pages.developers.overview.missingDetail") },
              ]}
            />
            <SubHeading>{t("pages.developers.quickStart.title")}</SubHeading>
            <ol className="max-w-3xl list-decimal space-y-2 ps-5 text-sm leading-relaxed text-ink-muted">
              <li>
                {t.rich("pages.developers.quickStart.step1", { b: strong })}
              </li>
              <li>
                {t.rich("pages.developers.quickStart.step2", { code })}
              </li>
              <li>{t("pages.developers.quickStart.step3")}</li>
            </ol>
            <CodeBlock code={curlExample(endpoints.getKeyInfo, baseUrl)} label="curl" />
          </Section>

          <Section
            id="authentication"
            title={t("pages.developers.nav.authentication")}
            lead={
              <p>
                {t.rich("pages.developers.auth.lead", { code, format: <InlineCode>{"ll_live_<id>_<secret>"}</InlineCode> })}
              </p>
            }
          >
            <CodeBlock code={`Authorization: Bearer ll_live_7tq2x9mb4c_…`} label={t("pages.developers.auth.header")} />
            <Prose>
              <p>
                {t.rich("pages.developers.auth.failures", { unauthorized: <StatusCode status={401} />, tooMany: <StatusCode status={429} />, limit: API_AUTH_FAILURE_LIMIT.limit })}
              </p>
              <p>{t("pages.developers.auth.audit")}</p>
            </Prose>
          </Section>

          <Section
            id="scopes"
            title={t("pages.developers.nav.scopes")}
            lead={
              <p>
                {t.rich("pages.developers.scopes.lead", { code, forbidden: <StatusCode status={403} /> })}
              </p>
            }
          >
            <Definitions
              rows={API_SCOPES.map((scope) => ({
                key: scope.id,
                term: <InlineCode className="text-xs">{scope.id}</InlineCode>,
                detail: scope.description,
              }))}
            />
          </Section>

          <Section
            id="rate-limits"
            title={t("pages.developers.nav.rateLimits")}
            lead={
              <p>
                {t.rich("pages.developers.rateLimits.lead", { code, perMinute, tooMany: <StatusCode status={429} /> })}
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "limit", term: <InlineCode className="text-xs">X-RateLimit-Limit</InlineCode>, detail: t("pages.developers.rateLimits.limit") },
                { key: "remaining", term: <InlineCode className="text-xs">X-RateLimit-Remaining</InlineCode>, detail: t("pages.developers.rateLimits.remaining") },
                { key: "reset", term: <InlineCode className="text-xs">X-RateLimit-Reset</InlineCode>, detail: t("pages.developers.rateLimits.reset") },
                { key: "retry", term: <InlineCode className="text-xs">Retry-After</InlineCode>, detail: t("pages.developers.rateLimits.retry") },
              ]}
            />
            <Prose>
              <p>{t("pages.developers.rateLimits.advice")}</p>
            </Prose>
          </Section>

          <Section
            id="pagination"
            title={t("pages.developers.nav.pagination")}
            lead={
              <p>
                {t.rich("pages.developers.pagination.lead", { code, envelope: <InlineCode>{"{ data: [...], meta: { page, perPage, total, totalPages, hasMore } }"}</InlineCode> })}
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "page", term: <InlineCode className="text-xs">page</InlineCode>, detail: t("pages.developers.pagination.page") },
                {
                  key: "perPage",
                  term: <InlineCode className="text-xs">perPage</InlineCode>,
                  detail: t("pages.developers.pagination.perPage", { default: DEFAULT_PER_PAGE, max: MAX_PER_PAGE }),
                },
                {
                  key: "sort",
                  term: <InlineCode className="text-xs">sort</InlineCode>,
                  detail: (
                    <>
                      {SORT_VALUES.map((value, index) => (
                        <span key={value}>
                          {index > 0 && ", "}
                          <InlineCode>{value}</InlineCode>
                        </span>
                      ))}
                      {t("pages.developers.pagination.sort")}
                    </>
                  ),
                },
                {
                  key: "updated_since",
                  term: <InlineCode className="text-xs">updated_since</InlineCode>,
                  detail: t("pages.developers.pagination.updatedSince"),
                },
              ]}
            />
            <SubHeading>{t("pages.developers.pagination.syncTitle")}</SubHeading>
            <Prose>
              <p>
                {t.rich("pages.developers.pagination.sync", { code })}
              </p>
            </Prose>
            <CodeBlock code={`curl "${apiBase}/enrollments?sort=updated_at&updated_since=2026-01-15T09:00:00Z&perPage=${MAX_PER_PAGE}" \\\n  -H "Authorization: Bearer $LL_API_KEY"`} label="curl" />
          </Section>

          <Section
            id="errors"
            title={t("pages.developers.nav.errors")}
            lead={
              <p>
                {t.rich("pages.developers.errors.lead", { code })}
              </p>
            }
          >
            <CodeBlock code={ERROR_EXAMPLE} label={t("pages.developers.errors.example")} />
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {Object.entries(ERROR_CODES).map(([code, info]) => (
                <li key={code} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="flex shrink-0 items-baseline gap-2 sm:w-64">
                    <StatusCode status={info.status} className="w-8" />
                    <InlineCode className="text-xs">{code}</InlineCode>
                  </span>
                  <RichText text={info.description} className="min-w-0 text-ink-muted" />
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="endpoints"
            title={t("pages.developers.nav.endpoints")}
            lead={
              <p>
                {t.rich("pages.developers.endpoints.lead", { base: <InlineCode>{apiBase}</InlineCode> })}
              </p>
            }
          >
            <EndpointBrowser docs={docs} tags={tags} />
          </Section>

          <Section id="objects" title={t("pages.developers.nav.objects")} lead={<p>{t("pages.developers.objects.lead")}</p>}>
            <ObjectList />
          </Section>

          <Section
            id="webhooks"
            title={t("pages.developers.nav.webhooks")}
            lead={
              <p>
                {t.rich("pages.developers.webhooks.lead", {
                  code,
                  link: (chunks) => (
                    <a href="#createWebhook" className="text-accent hover:underline">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            }
          >
            <SubHeading id="webhook-requests">{t("pages.developers.nav.requests")}</SubHeading>
            <Prose>
              <p>
                {t.rich("pages.developers.webhooks.requests", { code, body: <InlineCode>{"{ id, type, createdAt, data }"}</InlineCode> })}
              </p>
            </Prose>
            <CodeBlock code={eventExamples[firstEvent.name] ?? "{}"} label={t("pages.developers.webhooks.bodyLabel", { event: firstEvent.name })} />
            <Definitions rows={WEBHOOK_HEADERS.map((header) => ({ key: header.name, term: <InlineCode className="text-xs">{header.name}</InlineCode>, detail: <RichText text={header.description} /> }))} />

            <SubHeading id="signatures">{t("pages.developers.nav.signatures")}</SubHeading>
            <Prose>
              <p>
                {t.rich("pages.developers.signatures.lead", { secret: <InlineCode>{`${WEBHOOK_SECRET_PREFIX}…`}</InlineCode> })}
              </p>
              <ol className="list-decimal space-y-1 ps-5">
                <li>
                  {t("pages.developers.signatures.step1")}
                </li>
                <li>
                  {t.rich("pages.developers.signatures.step2", { code, header: <InlineCode>{SIGNATURE_HEADER}</InlineCode> })}
                </li>
                <li>
                  {t.rich("pages.developers.signatures.step3", { input: <InlineCode>{"<t>.<raw body>"}</InlineCode> })}
                </li>
                <li>{t("pages.developers.signatures.step4")}</li>
                <li>{t("pages.developers.signatures.step5", { minutes: SIGNATURE_TOLERANCE_SECONDS / 60 })}</li>
              </ol>
            </Prose>
            <CodeTabs samples={VERIFY_SAMPLES} title={t("pages.developers.signatures.sample")} />

            <SubHeading id="retries">{t("pages.developers.nav.retries")}</SubHeading>
            <Prose>
              <p>
                {t("pages.developers.retries.timeout", { seconds: DELIVERY_TIMEOUT_MS / 1000 })}
              </p>
              <p>
                {t.rich("pages.developers.retries.schedule", {
                  code,
                  attempts: MAX_DELIVERY_ATTEMPTS,
                  delays: f.list(RETRY_DELAYS_MS.map((delay) => delayText(t, delay))),
                })}
              </p>
              <p>
                {t.rich("pages.developers.retries.disable", {
                  gone: <StatusCode status={410} />,
                  period: delayText(t, AUTO_DISABLE_AFTER_MS),
                  failures: AUTO_DISABLE_MIN_FAILURES,
                  chars: RESPONSE_BODY_LIMIT,
                  days: DELIVERY_RETENTION_DAYS,
                })}
              </p>
              <p>
                {t.rich("pages.developers.retries.test", { b: strong, prefix: <InlineCode>{TEST_EVENT_ID_PREFIX}</InlineCode> })}
              </p>
            </Prose>

            <SubHeading id="events">{t("pages.developers.nav.events")}</SubHeading>
            <WebhookEventList events={WEBHOOK_EVENTS} examples={eventExamples} />
          </Section>
        </div>
      </div>
    </div>
  );
}

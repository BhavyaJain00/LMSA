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
  describeDelay,
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

/**
 * Public developer documentation: REST API v1 and outgoing webhooks.
 * Everything is generated from the same registry the API validates against
 * (`src/lib/api/endpoints.ts`) and from the webhook event catalog, so the
 * reference cannot drift from the running API. The machine-readable form is
 * `/api/v1/openapi.json`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return pageMetadata(
    {
      title: `${settings.brand.name} API reference`,
      description: "REST API and webhooks reference: authentication, scopes, rate limits, every endpoint with examples, and signed webhook events.",
      path: "/developers",
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
  const [settings, viewer] = await Promise.all([getSettings(), getCurrentUser()]);
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
    { href: "#overview", label: "Overview" },
    { href: "#authentication", label: "Authentication" },
    { href: "#scopes", label: "Scopes" },
    { href: "#rate-limits", label: "Rate limits" },
    { href: "#pagination", label: "Pagination & sync" },
    { href: "#errors", label: "Errors" },
    { href: "#endpoints", label: "Endpoints", children: tags.map((tag) => ({ href: `#${tagAnchor(tag)}`, label: tag })) },
    { href: "#objects", label: "Objects" },
    {
      href: "#webhooks",
      label: "Webhooks",
      children: [
        { href: "#webhook-requests", label: "Requests & headers" },
        { href: "#signatures", label: "Verifying signatures" },
        { href: "#retries", label: "Retries & failures" },
        { href: "#events", label: "Event types" },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl animate-fade-in pb-16">
      <HashOpener />
      <header className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
            <Icon.Code className="size-4" /> Developers
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{brand} API</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Connect {brand} to your CRM, data warehouse or automation tools: sync members, enroll learners, read progress and payments over a JSON REST API, and get signed
            webhooks the moment something happens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/openapi.json" className={buttonClasses({ variant: "outline", size: "sm" })} download="openapi.json">
            <Icon.Download className="size-4" />
            OpenAPI 3.1 spec
          </a>
          {admin && (
            <ButtonLink href="/admin/settings/api" size="sm" leftIcon={<Icon.Lock className="size-4" />}>
              Keys & webhooks
            </ButtonLink>
          )}
        </div>
      </header>

      {!settings.api.enabled && (
        <div role="status" className="mb-8 flex items-start gap-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <strong>The API is switched off on this site.</strong> Requests are refused with <InlineCode>403 api_disabled</InlineCode> and no webhooks are sent until an administrator
            turns it on{admin ? " in Admin → Settings → API & webhooks" : ""}.
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
            title="Overview"
            lead={
              <p>
                The API speaks JSON over HTTPS. Every request is authenticated with an API key, every response carries an <InlineCode>X-Request-Id</InlineCode> header to quote
                when you report a problem, and the full contract is published as an OpenAPI 3.1 document you can feed to client generators.
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "base", term: <span className="font-medium text-ink">Base URL</span>, detail: <InlineCode>{apiBase}</InlineCode> },
                {
                  key: "spec",
                  term: <span className="font-medium text-ink">OpenAPI document</span>,
                  detail: (
                    <a href="/api/v1/openapi.json" className="text-accent hover:underline">
                      {apiBase}/openapi.json
                    </a>
                  ),
                },
                { key: "format", term: <span className="font-medium text-ink">Format</span>, detail: "JSON bodies (Content-Type: application/json), UTF-8." },
                { key: "dates", term: <span className="font-medium text-ink">Dates</span>, detail: "ISO 8601 strings in UTC, e.g. 2026-01-15T09:30:00.000Z." },
                { key: "money", term: <span className="font-medium text-ink">Amounts</span>, detail: "Integers in the smallest currency unit (4900 = 49.00 USD), with an ISO 4217 currency." },
                { key: "nulls", term: <span className="font-medium text-ink">Missing values</span>, detail: "Fields are always present; a value that is not set is null." },
              ]}
            />
            <SubHeading>Quick start</SubHeading>
            <ol className="max-w-3xl list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
              <li>
                An administrator creates a key in <strong className="text-ink">Admin → Settings → API & webhooks</strong>, picks its scopes and copies it. The key is shown only once.
              </li>
              <li>
                Store it server-side, for example in an environment variable named <InlineCode>LL_API_KEY</InlineCode>. Never put it in a web page or mobile app.
              </li>
              <li>Check the connection: the call below returns the key&apos;s name, scopes and rate limit.</li>
            </ol>
            <CodeBlock code={curlExample(endpoints.getKeyInfo, baseUrl)} label="curl" />
          </Section>

          <Section
            id="authentication"
            title="Authentication"
            lead={
              <p>
                Send the key in the <InlineCode>Authorization</InlineCode> header of every request. Keys look like <InlineCode>ll_live_&lt;id&gt;_&lt;secret&gt;</InlineCode>; only a
                SHA-256 hash is stored, so a lost key cannot be shown again: create a new one and revoke the old one.
              </p>
            }
          >
            <CodeBlock code={`Authorization: Bearer ll_live_7tq2x9mb4c_…`} label="Header" />
            <Prose>
              <p>
                A missing, malformed, unknown or revoked key is answered with <StatusCode status={401} />. A key stops working when it is revoked or when the administrator who created
                it loses the admin role or is disabled. After {API_AUTH_FAILURE_LIMIT.limit} failed attempts from one address within a minute, further attempts get{" "}
                <StatusCode status={429} />.
              </p>
              <p>Changes made with a key are recorded in the site&apos;s audit log under the key&apos;s creator and tagged with the key.</p>
            </Prose>
          </Section>

          <Section
            id="scopes"
            title="Scopes"
            lead={
              <p>
                Each key carries scopes that decide which endpoints it can reach. A <InlineCode>:write</InlineCode> scope includes the matching <InlineCode>:read</InlineCode> scope.
                Calling an endpoint without its scope returns <StatusCode status={403} /> <InlineCode>insufficient_scope</InlineCode>.
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
            title="Rate limits"
            lead={
              <p>
                Each key may make {perMinute} requests per minute. Every response reports where you stand; when the allowance is used up the API answers{" "}
                <StatusCode status={429} /> with a <InlineCode>Retry-After</InlineCode> header in seconds.
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "limit", term: <InlineCode className="text-xs">X-RateLimit-Limit</InlineCode>, detail: "Requests allowed per window." },
                { key: "remaining", term: <InlineCode className="text-xs">X-RateLimit-Remaining</InlineCode>, detail: "Requests left in the current window." },
                { key: "reset", term: <InlineCode className="text-xs">X-RateLimit-Reset</InlineCode>, detail: "Unix time (seconds) when the window starts over." },
                { key: "retry", term: <InlineCode className="text-xs">Retry-After</InlineCode>, detail: "On 429 only: seconds to wait before the next request." },
              ]}
            />
            <Prose>
              <p>Spread bulk jobs out, or pause when X-RateLimit-Remaining reaches 0, rather than retrying in a tight loop.</p>
            </Prose>
          </Section>

          <Section
            id="pagination"
            title="Pagination & sync"
            lead={
              <p>
                List endpoints return a page of results with <InlineCode>{"{ data: [...], meta: { page, perPage, total, totalPages, hasMore } }"}</InlineCode> and a{" "}
                <InlineCode>Link</InlineCode> header with the <InlineCode>next</InlineCode>, <InlineCode>prev</InlineCode>, <InlineCode>first</InlineCode> and{" "}
                <InlineCode>last</InlineCode> pages.
              </p>
            }
          >
            <Definitions
              rows={[
                { key: "page", term: <InlineCode className="text-xs">page</InlineCode>, detail: "Page number, starting at 1." },
                {
                  key: "perPage",
                  term: <InlineCode className="text-xs">perPage</InlineCode>,
                  detail: `Items per page: default ${DEFAULT_PER_PAGE}, maximum ${MAX_PER_PAGE}. per_page works too.`,
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
                      . A leading minus sorts newest first (the default is -created_at).
                    </>
                  ),
                },
                {
                  key: "updated_since",
                  term: <InlineCode className="text-xs">updated_since</InlineCode>,
                  detail: "Only rows created or changed at or after this ISO 8601 time. A date alone means 00:00 UTC.",
                },
              ]}
            />
            <SubHeading>Keeping another system in sync</SubHeading>
            <Prose>
              <p>
                Remember when your last sync started, then fetch everything changed since with <InlineCode>sort=updated_at</InlineCode>, following pages until{" "}
                <InlineCode>hasMore</InlineCode> is false. Webhooks tell you about changes as they happen; a periodic sync catches anything a receiver missed.
              </p>
            </Prose>
            <CodeBlock code={`curl "${apiBase}/enrollments?sort=updated_at&updated_since=2026-01-15T09:00:00Z&perPage=${MAX_PER_PAGE}" \\\n  -H "Authorization: Bearer $LL_API_KEY"`} label="curl" />
          </Section>

          <Section
            id="errors"
            title="Errors"
            lead={
              <p>
                Failed requests use one envelope: a stable machine-readable <InlineCode>code</InlineCode>, a <InlineCode>message</InlineCode> written for the developer and{" "}
                <InlineCode>details</InlineCode> (null or an object). Validation errors list every invalid field, so a form can show them all at once.
              </p>
            }
          >
            <CodeBlock code={ERROR_EXAMPLE} label="400 response" />
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
            title="Endpoints"
            lead={
              <p>
                Paths are relative to <InlineCode>{apiBase}</InlineCode>. Open an endpoint for its parameters, a request in curl or JavaScript, and an example response.
              </p>
            }
          >
            <EndpointBrowser docs={docs} tags={tags} />
          </Section>

          <Section id="objects" title="Objects" lead={<p>Every field the API returns. Fields marked optional appear only when the key has the scope noted in their description.</p>}>
            <ObjectList />
          </Section>

          <Section
            id="webhooks"
            title="Webhooks"
            lead={
              <p>
                Webhooks push events to your server as they happen: a new enrollment, a payment, a finished course. Add an endpoint in Admin → Settings → API & webhooks, or with{" "}
                <a href="#createWebhook" className="text-accent hover:underline">
                  POST /webhooks
                </a>{" "}
                and a key with the <InlineCode>webhooks:manage</InlineCode> scope, then pick the events it should receive.
              </p>
            }
          >
            <SubHeading id="webhook-requests">Requests & headers</SubHeading>
            <Prose>
              <p>
                Each event is sent as an HTTPS <InlineCode>POST</InlineCode> with a JSON body <InlineCode>{"{ id, type, createdAt, data }"}</InlineCode>. Records the event refers to
                are included next to their ids (a <InlineCode>user</InlineCode> object next to <InlineCode>userId</InlineCode>, and so on), so most receivers need no follow-up call.
              </p>
            </Prose>
            <CodeBlock code={eventExamples[firstEvent.name] ?? "{}"} label={`${firstEvent.name} body`} />
            <Definitions rows={WEBHOOK_HEADERS.map((header) => ({ key: header.name, term: <InlineCode className="text-xs">{header.name}</InlineCode>, detail: <RichText text={header.description} /> }))} />

            <SubHeading id="signatures">Verifying signatures</SubHeading>
            <Prose>
              <p>
                Every request is signed with the endpoint&apos;s secret (<InlineCode>{`${WEBHOOK_SECRET_PREFIX}…`}</InlineCode>, shown when the endpoint is created or its secret
                rolled). Check the signature before trusting the body:
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Read the raw request body as bytes, before any JSON parsing; re-serialized JSON will not match.
                </li>
                <li>
                  Split the <InlineCode>{SIGNATURE_HEADER}</InlineCode> header on commas: <InlineCode>t</InlineCode> is the send time (unix seconds), each{" "}
                  <InlineCode>v1</InlineCode> a signature.
                </li>
                <li>
                  Compute HMAC-SHA256 of <InlineCode>{"<t>.<raw body>"}</InlineCode> with the whole secret as the key, hex-encoded.
                </li>
                <li>Compare it with each v1 value in constant time; accept if one matches.</li>
                <li>Refuse timestamps more than {SIGNATURE_TOLERANCE_SECONDS / 60} minutes away from your clock, so a captured request cannot be replayed later.</li>
              </ol>
            </Prose>
            <CodeTabs samples={VERIFY_SAMPLES} title="Signature check" />

            <SubHeading id="retries">Retries & failures</SubHeading>
            <Prose>
              <p>
                Answer with any 2xx status within {DELIVERY_TIMEOUT_MS / 1000} seconds; do slow work after responding. Redirects are not followed, and only public addresses are
                called: URLs that resolve to private, loopback or link-local networks are refused.
              </p>
              <p>
                Anything else (another status, a timeout, a connection error) is retried, {MAX_DELIVERY_ATTEMPTS} attempts in all, waiting{" "}
                {RETRY_DELAYS_MS.map((delay) => describeDelay(delay)).join(", ")} between them. Delivery is at least once and events can arrive out of order: deduplicate on{" "}
                <InlineCode>id</InlineCode> and use <InlineCode>createdAt</InlineCode> to order them.
              </p>
              <p>
                An endpoint that answers <StatusCode status={410} /> Gone is switched off at once. One whose deliveries keep failing for {describeDelay(AUTO_DISABLE_AFTER_MS)} (at
                least {AUTO_DISABLE_MIN_FAILURES} attempts in a row) is switched off too, and administrators are notified. They can turn it back on and resend what it missed from its
                delivery log, which keeps the response code and the first {RESPONSE_BODY_LIMIT.toLocaleString("en-US")} characters of each answer for {DELIVERY_RETENTION_DAYS} days.
              </p>
              <p>
                <strong className="text-ink">Send test event</strong> delivers the documented example of an event once; its id starts with <InlineCode>{TEST_EVENT_ID_PREFIX}</InlineCode>{" "}
                so your code can tell it apart.
              </p>
            </Prose>

            <SubHeading id="events">Event types</SubHeading>
            <WebhookEventList events={WEBHOOK_EVENTS} examples={eventExamples} />
          </Section>
        </div>
      </div>
    </div>
  );
}

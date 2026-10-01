import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { describeAuditAction } from "@/lib/audit";
import { describeErrorSource, isBrowserError, parseStackLines } from "@/lib/errors/shared";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { cn, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { ErrorDetailActions } from "../_components/error-actions";

export const metadata = { title: "Error details" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function ErrorDetailPage(props: PageProps<"/admin/errors/[id]">) {
  const { id } = await props.params;
  await requireRole(["admin"], `/admin/errors/${id}`);
  const db = await getDb();
  const event = db.errorEvents.find((e) => e.id === id);
  if (!event) notFound();

  const now = new Date();
  const member = event.userId ? db.users.find((u) => u.id === event.userId) : undefined;
  const lines = parseStackLines(event.stack);
  const frames = lines.filter((l) => l.kind !== "message");
  const appFrames = frames.filter((l) => l.kind === "app").length;
  const history = db.auditEvents
    .filter((a) => a.targetType === "error" && a.targetId === event.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  const actorName = (actorId?: string) => (actorId ? (db.users.find((u) => u.id === actorId)?.name ?? "Deleted user") : "System");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={<span className="line-clamp-3 break-words">{event.message}</span>}
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Error log", href: "/admin/errors" }, { label: "Details" }]} />
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={event.resolved ? "success" : "danger"} dot>
              {event.resolved ? "Resolved" : "Open"}
            </Badge>
            <Badge tone={isBrowserError(event) ? "info" : "neutral"}>{describeErrorSource(event)}</Badge>
            <span>
              {formatNumber(event.count || 1)} {event.count === 1 ? "occurrence" : "occurrences"}, last {relativeTime(event.lastSeenAt, now)}
            </span>
          </span>
        }
        actions={<ErrorDetailActions id={event.id} resolved={!!event.resolved} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-w-0">
          <CardHeader
            title="Stack trace"
            description={
              frames.length
                ? `${formatNumber(frames.length)} frames, ${formatNumber(appFrames)} in the app's own code (highlighted).`
                : "No stack trace was captured for this error."
            }
          />
          <CardBody className="p-0">
            {lines.length ? (
              <pre
                tabIndex={0}
                aria-label="Stack trace"
                className="max-h-[32rem] overflow-auto px-5 py-4 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
              >
                {lines.map((line, i) => (
                  <span
                    key={i}
                    className={cn(
                      "block whitespace-pre",
                      line.kind === "message" && "font-semibold text-danger",
                      line.kind === "app" && "pl-4 text-ink",
                      line.kind === "framework" && "pl-4 text-ink-faint",
                    )}
                  >
                    {line.text}
                  </span>
                ))}
              </pre>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-muted">
                {isBrowserError(event)
                  ? "The browser did not send a stack trace. Server errors shown to visitors carry only a reference code; look it up below."
                  : "Errors thrown without a stack (for example a rejected promise with a plain value) have no trace."}
              </p>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="space-y-3">
                <Fact label="Page or route">{event.path ? <code className="font-mono text-xs">{event.path}</code> : "Unknown"}</Fact>
                <Fact label="Source">{describeErrorSource(event)}</Fact>
                <Fact label="First seen">
                  <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </Fact>
                <Fact label="Last seen">
                  <time dateTime={event.lastSeenAt}>{formatDateTime(event.lastSeenAt)}</time>
                </Fact>
                <Fact label="Occurrences">{formatNumber(event.count || 1)}</Fact>
                {event.digest && (
                  <Fact label="Reference (digest)">
                    <code className="font-mono text-xs">{event.digest}</code>
                  </Fact>
                )}
                <Fact label="Last affected member">
                  {member ? (
                    <Link href={`/admin/members/${member.id}`} className="font-medium text-accent hover:underline">
                      {member.name}
                    </Link>
                  ) : event.userId ? (
                    "Deleted user"
                  ) : (
                    "Signed-out visitor"
                  )}
                </Fact>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              {history.length ? (
                <ol className="space-y-2.5 text-sm">
                  {history.map((a) => (
                    <li key={a.id} className="flex flex-col">
                      <span className="text-ink">{describeAuditAction(a.action)}</span>
                      <span className="text-xs text-ink-muted">
                        {actorName(a.actorId)} · <time dateTime={a.createdAt}>{relativeTime(a.createdAt, now)}</time>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-muted">No one has resolved or reopened this error yet.</p>
              )}
              {event.resolved && (
                <p className="mt-3 flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
                  <Icon.Info className="mt-px size-3.5 shrink-0" />
                  If this happens again the group reopens and administrators are notified.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <ButtonLink href="/admin/errors" variant="ghost" leftIcon={<Icon.ArrowLeft className="size-4" />}>
          Back to the error log
        </ButtonLink>
      </div>
    </div>
  );
}

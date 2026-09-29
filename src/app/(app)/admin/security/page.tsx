import Link from "next/link";
import type { LoginEvent, User } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { hasStaffRole, isAccountLocked, isEmailVerified, isTwoFactorActive, lockRemainingMs, formatWait } from "@/lib/auth/account-status";
import { describeLoginReason, isLoginEventReason, LOGIN_EVENT_REASONS, LOGIN_EVENT_REASON_KEYS } from "@/lib/auth/login-reasons";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { AdminAccountActions, type AdminAccountActionKey } from "@/components/security/admin-account-actions";
import { LoginEventsFilters } from "@/components/security/login-events-filters";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Login activity" };

const PAGE_SIZE = 50;
const DAY = 24 * 60 * 60 * 1000;
const PERIODS: Record<string, number | null> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, all: null };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function queryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function accountActions(user: User, viewerId: string): AdminAccountActionKey[] {
  const keys: AdminAccountActionKey[] = [];
  if (isAccountLocked(user) || (user.failedLoginCount ?? 0) > 0) keys.push("unlock");
  if (user.enabled) keys.push("sendReset");
  if (!isEmailVerified(user) || (user.emailVerificationRequired && !user.emailVerifiedAt)) keys.push("verify");
  if (user.id !== viewerId && (user.twoFactorEnabled || user.twoFactorSecretEnc)) keys.push("reset2fa");
  if (user.id !== viewerId) keys.push("signOut");
  return keys;
}

const TONE_TO_BADGE: Record<string, BadgeTone> = { success: "success", info: "info", warning: "warning", danger: "danger" };

interface ActivityFilters {
  q: string;
  outcome: "all" | "success" | "failure";
  reason: string;
  period: string;
  pageRaw: number;
  selectedUserId: string;
}

/** Everything the page shows, computed once per request from the store. */
async function loadActivity({ q, outcome, reason, period, pageRaw, selectedUserId }: ActivityFilters) {
  const db = await getDb();
  const now = Date.now();
  const usersById = new Map(db.users.map((u) => [u.id, u]));
  const selectedUser = selectedUserId ? (usersById.get(selectedUserId) ?? null) : null;

  // Stats for the last 24 hours ("waiting for code" is not a failure).
  const since24h = now - DAY;
  let ok24 = 0;
  let failed24 = 0;
  const failingIps = new Set<string>();
  for (const e of db.loginEvents) {
    if (new Date(e.createdAt).getTime() < since24h) continue;
    if (e.success) ok24++;
    else if (e.reason !== "2fa_challenge") {
      failed24++;
      if (e.ip) failingIps.add(e.ip);
    }
  }
  const lockedUsers = db.users.filter((u) => isAccountLocked(u, now)).sort((a, b) => (b.lockedUntil ?? "").localeCompare(a.lockedUntil ?? ""));
  const staff = db.users.filter((u) => u.enabled && hasStaffRole(u));
  const staffWith2fa = staff.filter((u) => isTwoFactorActive(u)).length;

  const span = PERIODS[period];
  const cutoff = span ? now - span : null;
  const needle = q.toLowerCase();
  const filtered: LoginEvent[] = db.loginEvents
    .filter((e) => {
      if (cutoff !== null && new Date(e.createdAt).getTime() < cutoff) return false;
      if (selectedUser && e.userId !== selectedUser.id) return false;
      if (outcome === "success" && !e.success) return false;
      if (outcome === "failure" && (e.success || e.reason === "2fa_challenge")) return false;
      if (reason !== "all" && e.reason !== reason) return false;
      if (needle) {
        const user = e.userId ? usersById.get(e.userId) : undefined;
        const hay = `${e.email} ${e.ip ?? ""} ${user?.name ?? ""} ${user?.username ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, pageCount) : 1;
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const matchingAccounts = needle && !selectedUser ? db.users.filter((u) => `${u.name} ${u.email} ${u.username}`.toLowerCase().includes(needle)).slice(0, 6) : [];

  return { db, now, usersById, selectedUser, ok24, failed24, failingIps, lockedUsers, staff, staffWith2fa, filtered, pageCount, page, visible, matchingAccounts };
}

export default async function LoginActivityPage(props: PageProps<"/admin/security">) {
  const viewer = await requireRole(["admin"], "/admin/security");
  const sp = await props.searchParams;
  const q = str(sp.q).slice(0, 200);
  const outcome: ActivityFilters["outcome"] = sp.outcome === "success" || sp.outcome === "failure" ? sp.outcome : "all";
  const reason = isLoginEventReason(sp.reason) ? sp.reason : "all";
  const period = typeof sp.period === "string" && sp.period in PERIODS ? sp.period : "30d";
  const pageRaw = Number(str(sp.page) || 1);
  const selectedUserId = str(sp.user);

  const { db, now, usersById, selectedUser, ok24, failed24, failingIps, lockedUsers, staff, staffWith2fa, filtered, pageCount, page, visible, matchingAccounts } =
    await loadActivity({ q, outcome, reason, period, pageRaw, selectedUserId });
  const baseParams = {
    q: q || undefined,
    outcome: outcome !== "all" ? outcome : undefined,
    reason: reason !== "all" ? reason : undefined,
    period: period !== "30d" ? period : undefined,
    user: selectedUser?.id,
  };
  const reasonOptions = LOGIN_EVENT_REASON_KEYS.map((key) => ({ value: key, label: LOGIN_EVENT_REASONS[key].label }));

  return (
    <div>
      <PageHeader
        title="Login activity"
        description="Every sign-in attempt on the platform, locked accounts and per-member account tools."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Login activity" }]} />}
        actions={
          <ButtonLink href="/admin/settings/security" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
            Security settings
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sign-ins (24h)" value={formatNumber(ok24)} icon={<Icon.LogIn className="size-5" />} />
        <StatCard
          label="Failed attempts (24h)"
          value={formatNumber(failed24)}
          hint={failingIps.size ? `From ${formatNumber(failingIps.size)} IP ${failingIps.size === 1 ? "address" : "addresses"}` : "None"}
          icon={<Icon.AlertTriangle className="size-5" />}
        />
        <StatCard label="Locked accounts" value={formatNumber(lockedUsers.length)} icon={<Icon.Lock className="size-5" />} />
        <StatCard label="Staff with 2-step" value={`${formatNumber(staffWith2fa)}/${formatNumber(staff.length)}`} icon={<Icon.ShieldCheck className="size-5" />} />
      </div>

      {selectedUserId && !selectedUser && (
        <div role="alert" className="mb-6 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          That member no longer exists.{" "}
          <Link href={`/admin/security${queryString({ ...baseParams, user: undefined })}`} className="font-medium text-accent hover:underline">
            Show everyone
          </Link>
        </div>
      )}

      {selectedUser && (
        <Card className="mb-6">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Avatar name={selectedUser.name} src={selectedUser.avatarUrl} size="xs" />
                <span className="truncate">{selectedUser.name}</span>
              </span>
            }
            description={selectedUser.email}
            actions={
              <ButtonLink href={`/admin/security${queryString({ ...baseParams, user: undefined })}`} variant="ghost" size="sm" leftIcon={<Icon.X className="size-4" />}>
                Clear
              </ButtonLink>
            }
          />
          <CardBody className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <DetailItem label="Status">
                {!selectedUser.enabled ? (
                  <Badge tone="danger" dot>
                    Disabled
                  </Badge>
                ) : isAccountLocked(selectedUser, now) ? (
                  <Badge tone="danger" dot>
                    Locked · {formatWait(lockRemainingMs(selectedUser, now))}
                  </Badge>
                ) : (
                  <Badge tone="success" dot>
                    Active
                  </Badge>
                )}
              </DetailItem>
              <DetailItem label="Email">
                {isEmailVerified(selectedUser) ? (
                  <Badge tone="success">{selectedUser.emailVerifiedAt ? "Confirmed" : "Admin-created"}</Badge>
                ) : (
                  <Badge tone="warning">Not confirmed</Badge>
                )}
              </DetailItem>
              <DetailItem label="Two-step">
                {isTwoFactorActive(selectedUser) ? (
                  <Badge tone="success">On · {selectedUser.recoveryCodeHashes?.length ?? 0} codes</Badge>
                ) : selectedUser.twoFactorSecretEnc ? (
                  <Badge tone="info">Setup unfinished</Badge>
                ) : (
                  <Badge tone="neutral">Off</Badge>
                )}
              </DetailItem>
              <DetailItem label="Failed attempts">{selectedUser.failedLoginCount ?? 0} in a row</DetailItem>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AdminAccountActions userId={selectedUser.id} name={selectedUser.name} actions={accountActions(selectedUser, viewer.id)} />
              <Link href={`/admin/members/${selectedUser.id}`} className="text-sm font-medium text-accent hover:underline">
                Open member profile →
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {lockedUsers.length > 0 && !selectedUser && (
        <Card className="mb-6">
          <CardHeader title="Locked accounts" description="Sign-in is paused after too many failed attempts. Unlock an account if the member contacted you." />
          <ul className="divide-y divide-border">
            {lockedUsers.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <Link href={`/admin/security${queryString({ user: u.id })}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {u.name}
                    </Link>
                    <p className="truncate text-xs text-ink-muted">
                      {u.email} · unlocks in {formatWait(lockRemainingMs(u, now))}
                    </p>
                  </div>
                </div>
                <AdminAccountActions userId={u.id} name={u.name} actions={["unlock"]} size="xs" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-4">
        <LoginEventsFilters values={{ q, outcome, reason, period }} reasons={reasonOptions} userId={selectedUser?.id} />
        {matchingAccounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted">Account tools:</span>
            {matchingAccounts.map((u) => (
              <Link
                key={u.id}
                href={`/admin/security${queryString({ ...baseParams, q: undefined, user: u.id })}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
              >
                <Avatar name={u.name} src={u.avatarUrl} size="xs" />
                <span className="truncate">{u.name}</span>
                {isAccountLocked(u, now) && <Icon.Lock className="size-3.5 text-danger" aria-label="Locked" />}
              </Link>
            ))}
          </div>
        )}
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Account</TH>
              <TH>Outcome</TH>
              <TH className="hidden md:table-cell">IP address</TH>
              <TH className="hidden lg:table-cell">Device</TH>
            </tr>
          </THead>
          <TBody>
            {visible.length === 0 ? (
              <TableEmpty colSpan={5}>
                {db.loginEvents.length === 0 ? (
                  <EmptyState
                    compact
                    className="border-0"
                    icon={<Icon.Shield />}
                    title="No sign-in activity yet"
                    description="Every sign-in attempt — successful, failed or blocked — will be listed here with its IP address and device."
                  />
                ) : q ? (
                  `No sign-in attempts match “${q}”.`
                ) : (
                  "No sign-in attempts match these filters."
                )}
              </TableEmpty>
            ) : (
              visible.map((e) => {
                const user = e.userId ? usersById.get(e.userId) : undefined;
                const info = describeLoginReason(e.reason, e.success);
                const device = describeUserAgent(e.userAgent);
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                        {relativeTime(e.createdAt)}
                      </time>
                    </TD>
                    <TD>
                      {user ? (
                        <Link href={`/admin/security${queryString({ ...baseParams, user: user.id, page: undefined })}`} className="block min-w-0 hover:underline">
                          <span className="block truncate font-medium">{user.name}</span>
                          <span className="block truncate text-xs text-ink-muted">{e.email}</span>
                        </Link>
                      ) : (
                        <span className="block min-w-0">
                          <span className="block truncate text-ink-muted">{e.email}</span>
                          <span className="block text-xs text-ink-faint">No account</span>
                        </span>
                      )}
                      <span className="mt-1 block font-mono text-xs text-ink-faint md:hidden">{e.ip ?? "—"}</span>
                    </TD>
                    <TD>
                      <Badge tone={TONE_TO_BADGE[info.tone] ?? "neutral"} dot className="whitespace-normal">
                        {info.label}
                      </Badge>
                    </TD>
                    <TD className="hidden whitespace-nowrap font-mono text-xs text-ink-muted md:table-cell">
                      {e.ip ? (
                        <Link
                          href={`/admin/security${queryString({ ...baseParams, q: e.ip, page: undefined })}`}
                          className="hover:text-ink hover:underline"
                          title="Show attempts from this IP"
                        >
                          {e.ip}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="hidden text-ink-muted lg:table-cell">
                      <span title={e.userAgent}>{device.label}</span>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted" aria-label="Pagination">
          <span>
            {filtered.length === 0
              ? "No results"
              : `Showing ${formatNumber((page - 1) * PAGE_SIZE + 1)}–${formatNumber((page - 1) * PAGE_SIZE + visible.length)} of ${formatNumber(filtered.length)}`}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <ButtonLink
                  href={`/admin/security${queryString({ ...baseParams, page: page - 1 })}`}
                  variant="outline"
                  size="sm"
                  leftIcon={<Icon.ChevronLeft className="size-4" />}
                >
                  Newer
                </ButtonLink>
              ) : null}
              <span className="tabular-nums">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <ButtonLink
                  href={`/admin/security${queryString({ ...baseParams, page: page + 1 })}`}
                  variant="outline"
                  size="sm"
                  rightIcon={<Icon.ChevronRight className="size-4" />}
                >
                  Older
                </ButtonLink>
              ) : null}
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}

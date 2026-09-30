"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Role, SegmentFilter } from "@/lib/types";
import { previewSegmentAction } from "@/lib/actions/broadcasts";
import type { SegmentPreview } from "@/lib/comms/audience";
import {
  INACTIVE_DAY_PRESETS,
  MAX_INACTIVE_DAYS,
  SEGMENT_ROLE_OPTIONS,
  describeSegment,
  encodeSegmentParam,
  isEmptySegment,
  normalizeSegmentFilter,
  totalExcluded,
} from "@/lib/comms/segments";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { cn, formatNumber } from "@/lib/utils";
import { CourseMultiSelect, type CourseChoice } from "./course-multi-select";

/** The last answer, for the request `key` (filter + retry count) it belongs to. */
interface PreviewResult {
  key: string;
  data?: SegmentPreview;
  error?: string;
}

const PREVIEW_DELAY_MS = 350;

const EXCLUSION_LABELS: { key: keyof SegmentPreview["excluded"]; label: string }[] = [
  { key: "unsubscribed", label: "unsubscribed or opted out" },
  { key: "unconfirmed", label: "address not confirmed" },
  { key: "disabled", label: "disabled accounts" },
  { key: "invalid", label: "invalid addresses" },
  { key: "duplicate", label: "duplicate addresses" },
];

/**
 * Audience builder for broadcasts: pick members by course enrollment, role,
 * inactivity and purchases — or confirmed leads — and see the live recipient
 * count, who's left out and why, and a sample of the list.
 *
 * In a form, the filter is submitted as JSON in the hidden field `name`.
 * With `syncUrl`, the current filter is kept in `?segment=` so the page can
 * be bookmarked or shared with other staff.
 */
export function SegmentBuilder({
  courses,
  defaultValue,
  name,
  onChange,
  syncUrl,
  exportHref,
  composeHref,
  className,
}: {
  courses: CourseChoice[];
  defaultValue?: SegmentFilter;
  /** Hidden input name for forms. */
  name?: string;
  onChange?: (filter: SegmentFilter) => void;
  syncUrl?: boolean;
  /** CSV export route; `?segment=` is appended. */
  exportHref?: string;
  /** Broadcast composer route; `?segment=` is appended. */
  composeHref?: string;
  className?: string;
}) {
  const id = useId();
  const [filter, setFilter] = useState<SegmentFilter>(() => normalizeSegmentFilter(defaultValue ?? {}));
  const [customDays, setCustomDays] = useState(() => {
    const days = defaultValue?.inactiveDays;
    return !!days && !(INACTIVE_DAY_PRESETS as readonly number[]).includes(days);
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0);

  const audience = filter.leadsOnly ? "leads" : "members";
  const courseTitle = useCallback((courseId: string) => courses.find((c) => c.id === courseId)?.title, [courses]);
  const encoded = encodeSegmentParam(filter);
  const requestKey = `${encoded}:${retryKey}`;
  // Loading until the answer for the current filter arrives (the previous numbers stay visible meanwhile).
  const loading = preview?.key !== requestKey;
  const data = preview?.data;
  const error = !loading ? preview?.error : undefined;

  const commit = (next: SegmentFilter) => {
    setFilter(next);
    onChange?.(next);
  };
  const update = (patch: Partial<SegmentFilter>) => commit(normalizeSegmentFilter({ ...filter, ...patch }));
  // Course interest carries over between the two audiences; member-only conditions don't apply to leads.
  const setAudience = (value: "members" | "leads") =>
    commit(normalizeSegmentFilter(value === "leads" ? { leadsOnly: true, courseIds: filter.courseIds } : { courseIds: filter.courseIds }));

  // Live preview (debounced; only the latest answer is shown) and the optional URL sync.
  useEffect(() => {
    const request = ++requestRef.current;
    const key = requestKey;
    const timer = setTimeout(async () => {
      if (syncUrl) {
        // Native history update (supported by the App Router): no server round trip per change.
        const url = new URL(window.location.href);
        if (isEmptySegment(filter)) url.searchParams.delete("segment");
        else url.searchParams.set("segment", encodeSegmentParam(filter));
        window.history.replaceState(window.history.state, "", url);
      }
      try {
        const result = await previewSegmentAction(filter);
        if (request !== requestRef.current) return;
        setPreview((prev) => (result.ok ? { key, data: result.data } : { key, error: result.error, data: prev?.data }));
      } catch {
        if (request !== requestRef.current) return;
        setPreview((prev) => ({ key, error: "The audience couldn't be counted. Check your connection and try again.", data: prev?.data }));
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // `requestKey` covers `filter` (and retries); `syncUrl` is fixed for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const toggleRole = (role: Role) => {
    const roles = filter.roles ?? [];
    update({ roles: roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role] });
  };

  const inactivityValue = customDays ? "custom" : filter.inactiveDays ? String(filter.inactiveDays) : "";
  const conditions = describeSegment(filter, courseTitle);

  return (
    <div className={cn("grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start", className)}>
      {name && <input type="hidden" name={name} value={JSON.stringify(filter)} />}

      <Card className="min-w-0 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink" id={`${id}-audience`}>
            Who should receive it?
          </h2>
          <SegmentedControl
            size="md"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "members", label: "Members", icon: <Icon.Users className="size-4" /> },
              { value: "leads", label: "Leads", icon: <Icon.Inbox className="size-4" /> },
            ]}
          />
        </div>

        {audience === "members" ? (
          <div className="mt-5 space-y-6">
            <fieldset>
              <legend className="text-sm font-medium text-ink">Roles</legend>
              <p className="mt-0.5 text-xs text-ink-muted">Leave all unchecked to include every role.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SEGMENT_ROLE_OPTIONS.map((role) => (
                  <Checkbox
                    key={role.value}
                    id={`${id}-role-${role.value}`}
                    label={role.label}
                    checked={filter.roles?.includes(role.value) ?? false}
                    onChange={() => toggleRole(role.value)}
                  />
                ))}
              </div>
            </fieldset>

            <CourseMultiSelect
              label="Enrolled in any of"
              description="Members enrolled in at least one of these courses."
              courses={courses}
              value={filter.courseIds ?? []}
              onChange={(ids) => update({ courseIds: ids })}
              disabledIds={filter.notEnrolledCourseIds}
            />

            <CourseMultiSelect
              label="Not enrolled in"
              description="Leave out members enrolled in any of these — handy for promoting a course to people who don't have it yet."
              courses={courses}
              value={filter.notEnrolledCourseIds ?? []}
              onChange={(ids) => update({ notEnrolledCourseIds: ids })}
              disabledIds={filter.courseIds}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-inactive`} className="mb-1.5 block text-sm font-medium text-ink">
                  Activity
                </label>
                <Select
                  id={`${id}-inactive`}
                  value={inactivityValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") {
                      setCustomDays(true);
                      update({ inactiveDays: filter.inactiveDays ?? 45 });
                    } else {
                      setCustomDays(false);
                      update({ inactiveDays: v ? Number(v) : undefined });
                    }
                  }}
                  options={[
                    { value: "", label: "Any activity" },
                    ...INACTIVE_DAY_PRESETS.map((d) => ({ value: String(d), label: `Inactive for ${d}+ days` })),
                    { value: "custom", label: "Inactive for a custom period" },
                  ]}
                />
                {customDays && (
                  <div className="mt-2">
                    <label htmlFor={`${id}-days`} className="sr-only">
                      Days without activity
                    </label>
                    <Input
                      id={`${id}-days`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_INACTIVE_DAYS}
                      value={filter.inactiveDays ?? ""}
                      onChange={(e) => update({ inactiveDays: e.target.value ? Number(e.target.value) : undefined })}
                      rightAddon={<span className="text-xs text-ink-muted">days</span>}
                    />
                  </div>
                )}
                <p className="mt-1.5 text-xs text-ink-muted">Based on sign-ins, lesson progress and other activity.</p>
              </div>
              <div>
                <label htmlFor={`${id}-purchased`} className="mb-1.5 block text-sm font-medium text-ink">
                  Purchases
                </label>
                <Select
                  id={`${id}-purchased`}
                  value={filter.purchased === undefined ? "" : filter.purchased ? "yes" : "no"}
                  onChange={(e) => update({ purchased: e.target.value === "" ? undefined : e.target.value === "yes" })}
                  options={[
                    { value: "", label: "Anyone" },
                    { value: "yes", label: "Has made a purchase" },
                    { value: "no", label: "Never purchased" },
                  ]}
                />
                <p className="mt-1.5 text-xs text-ink-muted">Counts paid orders only; refunded orders don&apos;t count.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <p className="text-sm text-ink-muted">
              Leads are people who left their email address (lead forms, free resources) but have no account. Only leads who gave marketing consent and
              confirmed their address are included.
            </p>
            <CourseMultiSelect
              label="Interested in any of"
              description="Leads who signed up from one of these courses. Leave empty to include every lead."
              courses={courses}
              value={filter.courseIds ?? []}
              onChange={(ids) => update({ courseIds: ids })}
            />
          </div>
        )}

        <p className="mt-6 flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
          <Icon.ShieldCheck className="size-4 shrink-0 text-success" />
          <span>
            People who opted out of announcements or unsubscribed, disabled accounts and unconfirmed addresses are always left out, and each address
            receives one copy.
          </span>
        </p>
      </Card>

      <Card className="min-w-0 p-5 lg:sticky lg:top-20" aria-labelledby={`${id}-preview-title`}>
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${id}-preview-title`} className="text-sm font-medium text-ink-muted">
            Recipients
          </h2>
          {loading && data && <Spinner className="size-4 text-ink-muted" />}
        </div>

        <div aria-live="polite" aria-busy={loading}>
          {data ? (
            <>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{formatNumber(data.count)}</p>
              <p className="text-sm text-ink-muted">
                {data.count === 1 ? "person" : "people"} will receive this
                {audience === "members" ? "" : " (leads)"}
              </p>
            </>
          ) : error ? null : (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          )}

          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <p>{error}</p>
              <Button size="xs" variant="outline" className="mt-2" onClick={() => setRetryKey((k) => k + 1)} leftIcon={<Icon.Refresh className="size-3.5" />}>
                Try again
              </Button>
            </div>
          )}
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Conditions">
          {conditions.map((c) => (
            <li key={c}>
              <Badge tone="neutral" className="whitespace-normal">
                {c}
              </Badge>
            </li>
          ))}
        </ul>

        {data && totalExcluded(data.excluded) > 0 && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-ink">{formatNumber(totalExcluded(data.excluded))} matching people left out</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {EXCLUSION_LABELS.filter((e) => data.excluded[e.key] > 0).map((e) => (
                <li key={e.key}>
                  {formatNumber(data.excluded[e.key])} {e.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Sample</h3>
          {!data ? (
            error ? (
              <p className="mt-2 text-sm text-ink-muted">The sample appears once the audience is counted.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )
          ) : data.sample.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nobody matches these conditions yet. Loosen a condition to reach more people.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {data.sample.map((r) => (
                <li key={`${r.kind}:${r.email}`} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.name || r.email}</p>
                    {r.name && <p className="truncate text-xs text-ink-muted">{r.email}</p>}
                  </div>
                  {r.kind === "lead" && <Badge tone="info">Lead</Badge>}
                </li>
              ))}
              {data.count > data.sample.length && (
                <li className="pt-2 text-xs text-ink-muted">and {formatNumber(data.count - data.sample.length)} more</li>
              )}
            </ul>
          )}
        </div>

        {(exportHref || composeHref) && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            {composeHref && (
              <ButtonLink href={`${composeHref}?segment=${encoded}`} size="sm" leftIcon={<Icon.Send className="size-4" />}>
                Write a broadcast
              </ButtonLink>
            )}
            {exportHref && (
              <a href={`${exportHref}?segment=${encoded}`} download className={buttonClasses({ variant: "outline", size: "sm" })}>
                <Icon.Download className="size-4" />
                Export CSV
              </a>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

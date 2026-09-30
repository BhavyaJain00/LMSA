"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bundlesAction, duplicateBundleAction, saveBundleAction, setBundlesEnabledAction, type BundleBulkOp } from "@/lib/actions/bundles";
import { MAX_BUNDLE_COURSES, MIN_BUNDLE_COURSES, bundlePricing } from "@/lib/commerce/bundles";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon, Spinner } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatDate, formatPrice, slugify } from "@/lib/utils";
import { Pager } from "./pager";

export interface BundleRowData {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Courses of the bundle that still exist, in order. */
  courseIds: string[];
  courseTitles: string[];
  price: number;
  currency: string;
  imageUrl: string;
  published: boolean;
  /** Visible to buyers right now. */
  onSale: boolean;
  unpublishedCourses: number;
  missingCourses: number;
  totalValue: number;
  savingsPercent: number;
  comparable: boolean;
  paidOrders: number;
  openOrders: number;
  revenue: number;
  deletable: boolean;
  updatedAt: string;
}

export interface BundleCourseChoice {
  id: string;
  title: string;
  published: boolean;
  /** List price in the smallest currency unit (0 for free courses). */
  price: number;
  currency: string;
}

export interface BundleFilterValues {
  status: string;
  q: string;
}

/** "Sell bundles" switch: the bundle pages, their menu link and new bundle checkouts. */
export function BundleSalesSwitch({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const res = await setBundlesEnabledAction(next);
      if (res.ok) toast.success(res.message ?? "Saved");
      else {
        setOn(!next);
        toast.error("The setting could not be saved", res.error);
      }
    });
  };
  return (
    <Switch
      id="bundles-enabled"
      checked={on}
      disabled={pending}
      onChange={(e) => change(e.target.checked)}
      label="Sell bundles"
      description={on ? "The bundles page is live and appears in the main menu." : "The bundle pages are hidden and new bundle checkouts are closed. Buyers keep their courses."}
    />
  );
}

function filterQuery(values: BundleFilterValues, page?: number): string {
  const qs = new URLSearchParams({ tab: "bundles" });
  if (values.status && values.status !== "all") qs.set("bstatus", values.status);
  if (values.q.trim()) qs.set("bq", values.q.trim());
  if (page && page > 1) qs.set("bpage", String(page));
  return qs.toString();
}

const STATUS_OPTIONS = [
  { value: "all", label: "All bundles" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
];

function BundleFilters({ values }: { values: BundleFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const apply = (next: Partial<BundleFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    startTransition(() => router.replace(`${pathname}?${filterQuery(merged)}`, { scroll: false }));
  };
  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value }), 300);
  };
  const hasFilters = values.status !== "all" || !!values.q;

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search bundles"
        placeholder="Search by bundle, URL name or course"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select aria-label="Filter by status" value={values.status} onChange={(e) => apply({ status: e.target.value })} options={STATUS_OPTIONS} />
      <Button
        variant="ghost"
        disabled={!hasFilters}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setSearch("");
          apply({ status: "all", q: "" });
        }}
      >
        Clear
      </Button>
    </div>
  );
}

function BundleForm({ bundle, courses, currencies, defaultCurrency, onDone }: { bundle: BundleRowData | null; courses: BundleCourseChoice[]; currencies: string[]; defaultCurrency: string; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(saveBundleAction, { onSuccess: onDone });
  const [title, setTitle] = useState(bundle?.title ?? "");
  const [slug, setSlug] = useState(bundle?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!bundle);
  const [price, setPrice] = useState(bundle ? (bundle.price / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(bundle?.currency ?? defaultCurrency);
  const [imageUrl, setImageUrl] = useState(bundle?.imageUrl ?? "");
  // Ordered: the order here is the order of the courses on the bundle page.
  const [selected, setSelected] = useState<string[]>(bundle?.courseIds ?? []);
  const [courseSearch, setCourseSearch] = useState("");

  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const visibleCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    return q ? courses.filter((c) => c.title.toLowerCase().includes(q)) : courses;
  }, [courses, courseSearch]);
  const chosen = selected.map((id) => byId.get(id)).filter((c): c is BundleCourseChoice => !!c);

  const cents = /^\d{1,7}(\.\d{1,2})?$/.test(price.trim()) ? Math.round(Number(price) * 100) : 0;
  const pricing = bundlePricing(
    { price: cents, currency },
    chosen.map((c) => ({ paidCourse: c.price > 0, price: c.price, currency: c.currency })),
  );

  const toggle = (id: string, checked: boolean) => setSelected((prev) => (checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  const move = (index: number, by: -1 | 1) =>
    setSelected((prev) => {
      const target = index + by;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {bundle && <input type="hidden" name="id" value={bundle.id} />}
      {formError && !Object.keys(errors).length && <FormError message={formError} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="bundle-title" error={errors.title} required>
          <Input
            id="bundle-title"
            name="title"
            value={title}
            maxLength={120}
            invalid={!!errors.title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field
          label="URL name"
          htmlFor="bundle-slug"
          error={errors.slug}
          hint={errors.slug ? undefined : bundle && slug !== bundle.slug ? "The old address keeps working and redirects here." : `Page: /bundles/${slug || "…"}`}
          required
        >
          <Input
            id="bundle-slug"
            name="slug"
            value={slug}
            maxLength={80}
            className="font-mono"
            invalid={!!errors.slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="bundle-description" error={errors.description} hint={errors.description ? undefined : "Shown on the bundle page. Markdown is supported."}>
        <Textarea id="bundle-description" name="description" rows={4} defaultValue={bundle?.description ?? ""} maxLength={8000} invalid={!!errors.description} />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">
          Courses in the bundle <span className="text-danger">*</span>
        </legend>
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <div className="min-w-0 flex-1">
              <Input type="search" aria-label="Search courses" placeholder="Search courses" value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} leftAddon={<Icon.Search className="size-4" />} />
            </div>
            <span className="shrink-0 px-1 text-xs text-ink-muted" aria-live="polite">
              {selected.length} selected
            </span>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto p-2">
            {visibleCourses.length === 0 ? (
              <li className="px-2 py-3 text-sm text-ink-muted">{courses.length ? "No courses match your search." : "There are no courses yet."}</li>
            ) : (
              visibleCourses.map((course) => (
                <li key={course.id} className="rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <Checkbox
                    id={`bundle-course-${course.id}`}
                    checked={selected.includes(course.id)}
                    onChange={(e) => toggle(course.id, e.target.checked)}
                    label={
                      <span className="font-normal">
                        {course.title}
                        <span className="ml-1.5 text-xs text-ink-muted tabular-nums">
                          {formatPrice(course.price, course.currency)}
                          {!course.published && " · unpublished"}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))
            )}
          </ul>
        </div>
        {errors.courseIds ? (
          <p className="mt-1.5 text-xs text-danger">{errors.courseIds}</p>
        ) : (
          <p className="mt-1.5 text-xs text-ink-muted">
            Pick {MIN_BUNDLE_COURSES} to {MAX_BUNDLE_COURSES} courses. Unpublished courses stay hidden until they launch; buyers get them then.
          </p>
        )}

        {chosen.length > 0 && (
          <ol className="mt-3 divide-y divide-border rounded-lg border border-border" aria-label="Order of the courses on the bundle page">
            {chosen.map((course, i) => (
              <li key={course.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                {/* Submitted in this order, including courses a search currently hides. */}
                <input type="hidden" name="courseIds" value={course.id} />
                <span className="w-5 shrink-0 text-xs tabular-nums text-ink-faint">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-ink">{course.title}</span>
                <IconButton label={`Move ${course.title} up`} size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon.ChevronUp className="size-4" />
                </IconButton>
                <IconButton label={`Move ${course.title} down`} size="icon-sm" variant="ghost" disabled={i === chosen.length - 1} onClick={() => move(i, 1)}>
                  <Icon.ChevronDown className="size-4" />
                </IconButton>
                <IconButton label={`Remove ${course.title}`} size="icon-sm" variant="ghost" onClick={() => toggle(course.id, false)}>
                  <Icon.X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ol>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bundle price" htmlFor="bundle-price" error={errors.price} required>
          <Input id="bundle-price" name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="59.00" invalid={!!errors.price} />
        </Field>
        <Field label="Currency" htmlFor="bundle-currency" error={errors.currency} required>
          <Select id="bundle-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} invalid={!!errors.currency} />
        </Field>
      </div>
      {chosen.length > 0 && (
        <p className="-mt-2 text-xs text-ink-muted" aria-live="polite">
          {!pricing.comparable ? (
            `Some of these courses are not priced in ${currency}, so the saving can't be shown to buyers.`
          ) : pricing.totalValue === 0 ? (
            "These courses are free on their own, so the bundle shows no saving."
          ) : cents <= 0 ? (
            <>
              Bought one by one these courses cost <strong className="text-ink">{formatPrice(pricing.totalValue, currency)}</strong>.
            </>
          ) : pricing.savings > 0 ? (
            <>
              Bought one by one these courses cost <strong className="text-ink">{formatPrice(pricing.totalValue, currency)}</strong>. Buyers save{" "}
              <strong className="text-success">
                {formatPrice(pricing.savings, currency)} ({pricing.savingsPercent}%)
              </strong>
              .
            </>
          ) : (
            <>
              Bought one by one these courses cost <strong className="text-ink">{formatPrice(pricing.totalValue, currency)}</strong>, so this price is{" "}
              <strong className="text-warning">not a saving</strong>.
            </>
          )}
        </p>
      )}

      <div>
        <FileUpload name="imageUrl" kind="image" value={imageUrl} onChange={(url) => setImageUrl(url)} label="Cover image" hint="Optional. Without one, the covers of the first courses are shown." />
        {errors.imageUrl && <p className="mt-1.5 text-xs text-danger">{errors.imageUrl}</p>}
      </div>

      <div className="rounded-lg border border-border px-4 py-3">
        <Switch id="bundle-published" name="published" defaultChecked={bundle?.published ?? false} label="Published" description="Show the bundle on the bundles page and accept orders. Unpublishing never affects buyers." />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {bundle ? "Save bundle" : "Create bundle"}
        </Button>
      </div>
    </form>
  );
}

function statusOf(row: BundleRowData, salesEnabled: boolean): { label: string; tone: BadgeTone; note?: string } {
  if (!row.published) return { label: "Draft", tone: "neutral" };
  if (row.onSale) return { label: "On sale", tone: "success" };
  return { label: "Hidden", tone: "warning", note: salesEnabled ? "None of its courses is published" : "Bundle sales are off" };
}

const BULK_CONFIRM: Record<"delete" | "unpublish", { title: (n: number) => string; body: string; confirm: string }> = {
  delete: {
    title: (n) => `Delete ${n} bundle${n === 1 ? "" : "s"}?`,
    body: "Bundles that were ordered, gifted or used in an upsell are kept (unpublish them instead). Deleting a bundle never removes anyone's courses.",
    confirm: "Delete",
  },
  unpublish: {
    title: (n) => `Unpublish ${n} bundle${n === 1 ? "" : "s"}?`,
    body: "They disappear from the bundles page and can no longer be ordered. Buyers keep their courses.",
    confirm: "Unpublish",
  },
};

/** Admin bundles tab: list with search and status filter, create/edit, duplicate, publish, delete and bulk actions. */
export function BundlesManager({
  rows,
  total,
  page,
  pageCount,
  filter,
  courses,
  currencies,
  defaultCurrency,
  salesEnabled,
  bundleCount,
}: {
  rows: BundleRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: BundleFilterValues;
  courses: BundleCourseChoice[];
  currencies: string[];
  defaultCurrency: string;
  salesEnabled: boolean;
  /** Bundles in total, whatever the filters (decides between "no bundles yet" and "no match"). */
  bundleCount: number;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<BundleRowData | "new" | null>(null);
  const [confirming, setConfirming] = useState<{ ids: string[]; op: "delete" | "unpublish" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();

  // Selection only covers rows on the current page.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  const run = (ids: string[], op: BundleBulkOp) =>
    startTransition(async () => {
      const res = await bundlesAction(ids, op);
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setSelected(new Set());
      } else toast.error("The bundles could not be updated", res.error);
      setConfirming(null);
    });

  const duplicate = (row: BundleRowData) =>
    startTransition(async () => {
      const res = await duplicateBundleAction(row.id);
      if (res.ok) toast.success(res.message ?? "Bundle copied");
      else toast.error("The bundle could not be copied", res.error);
    });

  const newButton = (
    <Button size="sm" onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />} disabled={courses.length < MIN_BUNDLE_COURSES}>
      New bundle
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {bundleCount === 0 ? "No bundles yet." : `${total} of ${bundleCount} bundle${bundleCount === 1 ? "" : "s"}`}
          {courses.length < MIN_BUNDLE_COURSES && ` A bundle needs at least ${MIN_BUNDLE_COURSES} courses; create them first.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {salesEnabled && rows.some((r) => r.onSale) && (
            <Link href="/bundles" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2">
              <Icon.Eye className="size-4" aria-hidden="true" />
              View bundles page
            </Link>
          )}
          {newButton}
        </div>
      </div>

      {bundleCount === 0 ? (
        <EmptyState
          icon={<Icon.Gift />}
          title="Create your first bundle"
          description="A bundle sells several courses together for one price. Buyers are enrolled in every course at once and see how much they save."
          action={newButton}
        />
      ) : (
        <>
          <BundleFilters values={filter} />

          {selectedIds.length > 0 && (
            <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-ink">
                {selectedIds.length} selected
                <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
                  Clear
                </button>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" loading={busy} onClick={() => run(selectedIds, "publish")}>
                  Publish
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming({ ids: selectedIds, op: "unpublish" })}>
                  Unpublish
                </Button>
                <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => setConfirming({ ids: selectedIds, op: "delete" })}>
                  Delete
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
              <p className="text-sm font-medium text-ink">No bundles match these filters</p>
              <p className="mt-1 text-sm text-ink-muted">Try another search, or clear the filters to see every bundle.</p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all bundles on this page"
                      className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </TH>
                  <TH>Bundle</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="hidden text-right md:table-cell">Sales</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const status = statusOf(row, salesEnabled);
                  return (
                    <TR key={row.id}>
                      <TD>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                          checked={selected.has(row.id)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(row.id);
                              else next.delete(row.id);
                              return next;
                            })
                          }
                        />
                      </TD>
                      <TD className="max-w-72">
                        <button type="button" onClick={() => setEditing(row)} className="block max-w-full truncate text-left font-medium text-ink hover:text-accent hover:underline">
                          {row.title}
                        </button>
                        <p className="truncate text-xs text-ink-muted" title={row.courseTitles.join(", ")}>
                          {row.courseTitles.length} course{row.courseTitles.length === 1 ? "" : "s"}
                          {row.unpublishedCourses > 0 && ` · ${row.unpublishedCourses} unpublished`}
                          {row.missingCourses > 0 && ` · ${row.missingCourses} deleted`}
                        </p>
                        <p className="truncate font-mono text-[11px] text-ink-faint">/bundles/{row.slug}</p>
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        <span className="font-medium">{formatPrice(row.price, row.currency)}</span>
                        <p className="text-xs text-ink-muted">
                          {!row.comparable ? "Mixed currencies" : row.savingsPercent > 0 ? `Saves ${row.savingsPercent}%` : row.totalValue > 0 ? "No saving" : "Free courses"}
                        </p>
                      </TD>
                      <TD className="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
                        {formatPrice(row.revenue, row.currency, "—")}
                        <p className="text-xs text-ink-muted">
                          {row.paidOrders} paid{row.openOrders > 0 && ` · ${row.openOrders} open`}
                        </p>
                      </TD>
                      <TD>
                        <Badge tone={status.tone} dot>
                          {status.label}
                        </Badge>
                        <p className="mt-1 text-[11px] text-ink-muted">{status.note ?? `Updated ${formatDate(row.updatedAt, { timeZone: "UTC" })}`}</p>
                      </TD>
                      <TD className="text-right">
                        <Dropdown
                          trigger={
                            <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                              <Icon.MoreHorizontal className="size-4" />
                              <span className="sr-only">Actions for {row.title}</span>
                            </span>
                          }
                          items={[
                            { label: "Edit", icon: <Icon.Edit />, onClick: () => setEditing(row) },
                            { label: row.onSale ? "View page" : "Preview page", icon: <Icon.Eye />, href: `/bundles/${row.slug}` },
                            { label: "View orders", icon: <Icon.Receipt />, href: `/admin/settings/transactions?type=bundle&search=${encodeURIComponent(row.title)}` },
                            { label: "Duplicate", icon: <Icon.Copy />, description: "Copy as a draft", onClick: () => duplicate(row), disabled: busy },
                            row.published
                              ? { label: "Unpublish", icon: <Icon.EyeOff />, description: "Stop selling it; buyers keep it", onClick: () => setConfirming({ ids: [row.id], op: "unpublish" }), disabled: busy }
                              : { label: "Publish", icon: <Icon.CheckCircle />, onClick: () => run([row.id], "publish"), disabled: busy },
                            {
                              label: "Delete",
                              icon: <Icon.Trash />,
                              destructive: true,
                              separator: true,
                              disabled: !row.deletable || busy,
                              description: row.deletable ? undefined : "Has orders, gifts or upsells",
                              onClick: () => setConfirming({ ids: [row.id], op: "delete" }),
                            },
                          ]}
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, p)}`} label="Bundle pages" summary={`${total} bundle${total === 1 ? "" : "s"}`} />
        </>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New bundle" : "Edit bundle"} size="lg">
        {editing && (
          <BundleForm key={editing === "new" ? "new" : editing.id} bundle={editing === "new" ? null : editing} courses={courses} currencies={currencies} defaultCurrency={defaultCurrency} onDone={() => setEditing(null)} />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!confirming}
        onClose={() => (busy ? undefined : setConfirming(null))}
        onConfirm={() => {
          if (confirming) run(confirming.ids, confirming.op);
        }}
        loading={busy}
        destructive={confirming?.op === "delete"}
        title={confirming ? BULK_CONFIRM[confirming.op].title(confirming.ids.length) : "Update bundles?"}
        description={confirming ? BULK_CONFIRM[confirming.op].body : undefined}
        confirmLabel={confirming ? BULK_CONFIRM[confirming.op].confirm : "Confirm"}
      />
    </div>
  );
}

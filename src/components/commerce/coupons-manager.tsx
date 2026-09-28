"use client";

import { useMemo, useState, useTransition } from "react";
import type { Coupon } from "@/lib/types";
import { deleteCouponAction, saveCouponAction, setCouponEnabledAction } from "@/lib/actions/coupons";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate, formatPrice } from "@/lib/utils";
import { useFormAction } from "@/components/admin/settings/use-form-action";

export interface CouponRowData extends Coupon {
  items: { type: "course" | "batch"; id: string; title: string }[];
  expired: boolean;
  exhausted: boolean;
}

export interface CouponTarget {
  type: "course" | "batch";
  id: string;
  title: string;
  price: number;
  currency: string;
  published: boolean;
}

function discountLabel(c: Pick<Coupon, "discountType" | "value">, currency: string): string {
  return c.discountType === "percentage" ? `${c.value}% off` : `${formatPrice(c.value, currency, "0")} off`;
}

export function CouponsManager({ coupons, targets, currency, today }: { coupons: CouponRowData[]; targets: CouponTarget[]; currency: string; today: string }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CouponRowData | "new" | null>(null);
  const [toDelete, setToDelete] = useState<CouponRowData | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [deleting, startDelete] = useTransition();
  const [, startToggle] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return q ? coupons.filter((c) => c.code.includes(q)) : coupons;
  }, [coupons, search]);

  const toggle = (coupon: CouponRowData, enabled: boolean) => {
    setOverrides((m) => ({ ...m, [coupon.id]: enabled }));
    startToggle(async () => {
      const res = await setCouponEnabledAction(coupon.id, enabled);
      if (!res.ok) {
        setOverrides((m) => ({ ...m, [coupon.id]: !enabled }));
        toast.error("Error updating coupon", res.error);
      }
    });
  };

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteCouponAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? "Coupon deleted successfully");
        setToDelete(null);
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            type="search"
            aria-label="Search coupons"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftAddon={<Icon.Search className="size-4" />}
          />
        </div>
        <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
          New coupon
        </Button>
      </div>

      {coupons.length === 0 ? (
        <EmptyState
          icon={<Icon.Ticket />}
          title="No Coupons Found"
          description="Add one to get started. Coupons give learners a percentage or fixed discount at checkout."
          action={
            <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
              New coupon
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Discount</TH>
              <TH className="hidden md:table-cell">Expires On</TH>
              <TH className="hidden sm:table-cell">Redeemed</TH>
              <TH className="hidden lg:table-cell">Applies to</TH>
              <TH>Enabled</TH>
              <TH className="w-20 text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TableEmpty colSpan={7}>No coupons match “{search}”.</TableEmpty>
            ) : (
              filtered.map((c) => {
                const enabled = overrides[c.id] ?? c.enabled;
                return (
                  <TR key={c.id}>
                    <TD>
                      <button type="button" onClick={() => setEditing(c)} className="font-mono font-semibold tracking-wide text-ink hover:text-accent hover:underline">
                        {c.code}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.expired && <Badge tone="danger" size="xs">Expired</Badge>}
                        {c.exhausted && <Badge tone="warning" size="xs">Limit reached</Badge>}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">{discountLabel(c, currency)}</TD>
                    <TD className={cn("hidden whitespace-nowrap md:table-cell", c.expired ? "text-danger" : "text-ink-muted")}>{c.expiresOn ? formatDate(c.expiresOn) : "—"}</TD>
                    <TD className="hidden tabular-nums text-ink-muted sm:table-cell">{c.usageLimit > 0 ? `${c.redemptionCount}/${c.usageLimit}` : c.redemptionCount}</TD>
                    <TD className="hidden max-w-56 lg:table-cell">
                      {c.items.length === 0 ? (
                        <span className="text-ink-muted">All courses & batches</span>
                      ) : (
                        <span className="line-clamp-2 text-ink-muted" title={c.items.map((i) => i.title).join(", ")}>
                          {c.items.map((i) => i.title).join(", ")}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Switch id={`coupon-enabled-${c.id}`} aria-label={`Enable ${c.code}`} checked={enabled} onChange={(e) => toggle(c, e.target.checked)} />
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Edit ${c.code}`} size="icon-sm" onClick={() => setEditing(c)}>
                          <Icon.Edit className="size-4" />
                        </IconButton>
                        <IconButton label={`Delete ${c.code}`} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(c)}>
                          <Icon.Trash className="size-4" />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      )}

      {editing && (
        <CouponFormDialog
          key={editing === "new" ? "new" : editing.id}
          coupon={editing === "new" ? null : editing}
          targets={targets}
          currency={currency}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title={`Delete ${toDelete?.code ?? "coupon"}?`}
        description="This will permanently delete the coupon and the code will no longer be valid."
        confirmLabel="Delete"
      />
    </div>
  );
}

function CouponFormDialog({
  coupon,
  targets,
  currency,
  today,
  onClose,
}: {
  coupon: CouponRowData | null;
  targets: CouponTarget[];
  currency: string;
  today: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState(coupon?.code ?? "");
  const [discountType, setDiscountType] = useState<Coupon["discountType"]>(coupon?.discountType ?? "percentage");
  const [selected, setSelected] = useState<string[]>(coupon?.applicableItems.map((a) => `${a.type}:${a.id}`) ?? []);
  const [itemSearch, setItemSearch] = useState("");
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(saveCouponAction, { onSuccess: onClose });
  const formId = coupon ? `coupon-form-${coupon.id}` : "coupon-form-new";

  const byKey = useMemo(() => new Map(targets.map((t) => [`${t.type}:${t.id}`, t])), [targets]);
  const visible = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return q ? targets.filter((t) => t.title.toLowerCase().includes(q)) : targets;
  }, [targets, itemSearch]);

  const toggleItem = (key: string) => {
    setSelected((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
    markDirty();
  };

  const defaultValue = coupon ? (coupon.discountType === "fixed" ? (coupon.value / 100).toFixed(2) : String(coupon.value)) : "";

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      size="lg"
      title={coupon ? coupon.code : "New Coupon"}
      description={coupon ? "Update the discount, limits and where the code can be used." : "Create a discount code for courses and batches."}
      footer={
        <>
          {dirty && (
            <Badge tone="warning" dot className="mr-auto">
              Not saved
            </Badge>
          )}
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!!coupon && !dirty}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-5">
        {coupon && <input type="hidden" name="id" value={coupon.id} />}
        {selected.map((key) => (
          <input key={key} type="hidden" name="items" value={key} />
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Coupon Code" htmlFor={`${formId}-code`} error={errors.code} required>
            <Input
              id={`${formId}-code`}
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
              placeholder="WELCOME10"
              maxLength={32}
              className="font-mono uppercase tracking-wide"
              invalid={!!errors.code}
              autoFocus
            />
          </Field>
          <Field label="Discount Type" htmlFor={`${formId}-type`} error={errors.discountType} required>
            <Select
              id={`${formId}-type`}
              name="discountType"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as Coupon["discountType"])}
              options={[
                { value: "percentage", label: "Percentage" },
                { value: "fixed", label: "Fixed Amount" },
              ]}
            />
          </Field>
          <Field
            label={discountType === "percentage" ? "Discount Percentage" : "Discount Amount"}
            htmlFor={`${formId}-value`}
            error={errors.value}
            hint={discountType === "fixed" ? `In the item's currency (e.g. ${currency}).` : undefined}
            required
          >
            <Input
              key={discountType}
              id={`${formId}-value`}
              name="value"
              type="number"
              min={discountType === "percentage" ? 1 : 0.01}
              max={discountType === "percentage" ? 100 : undefined}
              step={discountType === "percentage" ? 1 : 0.01}
              defaultValue={coupon?.discountType === discountType ? defaultValue : ""}
              placeholder={discountType === "percentage" ? "10" : "500"}
              rightAddon={discountType === "percentage" ? <span className="text-xs">%</span> : undefined}
              invalid={!!errors.value}
            />
          </Field>
          <Field label="Expires On" htmlFor={`${formId}-expires`} error={errors.expiresOn} hint={errors.expiresOn ? undefined : "Leave empty for no expiry."}>
            <Input id={`${formId}-expires`} name="expiresOn" type="date" min={today} defaultValue={coupon?.expiresOn ?? ""} invalid={!!errors.expiresOn} />
          </Field>
          <Field label="Usage Limit" htmlFor={`${formId}-limit`} error={errors.usageLimit} hint={errors.usageLimit ? undefined : "Total redemptions allowed."}>
            <Input
              id={`${formId}-limit`}
              name="usageLimit"
              type="number"
              min={0}
              step={1}
              defaultValue={coupon && coupon.usageLimit > 0 ? coupon.usageLimit : ""}
              placeholder="Unlimited"
              invalid={!!errors.usageLimit}
            />
          </Field>
          <div className="flex items-end pb-1">
            <Switch id={`${formId}-enabled`} name="enabled" defaultChecked={coupon?.enabled ?? true} label="Enabled" description="Disabled codes are rejected at checkout." />
          </div>
        </div>

        {coupon && (
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-ink">Redeemed</span> <span className="text-ink-muted">· How many times this code has been used so far</span>
            </span>
            <span className="font-medium tabular-nums">{coupon.usageLimit > 0 ? `${coupon.redemptionCount} / ${coupon.usageLimit}` : coupon.redemptionCount}</span>
          </div>
        )}

        <div>
          <div className="mb-1.5">
            <p className="text-sm font-medium text-ink">Applicable For</p>
            <p className="text-xs text-ink-muted">The courses and batches this coupon can be redeemed on. Leave empty to allow every course and batch.</p>
          </div>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((key) => {
                const t = byKey.get(key);
                return (
                  <span key={key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent">
                    <span className="truncate">{t ? t.title : "Deleted item"}</span>
                    <button type="button" onClick={() => toggleItem(key)} className="rounded-full p-0.5 hover:bg-accent/20" aria-label={`Remove ${t?.title ?? "item"}`}>
                      <Icon.X className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <Input
            type="search"
            aria-label="Search courses and batches"
            placeholder="Search courses and batches"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            leftAddon={<Icon.Search className="size-4" />}
          />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
            {(["course", "batch"] as const).map((type) => {
              const group = visible.filter((t) => t.type === type);
              if (!group.length) return null;
              return (
                <div key={type}>
                  <p className="sticky top-0 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{type === "course" ? "Courses" : "Batches"}</p>
                  {group.map((t) => {
                    const key = `${t.type}:${t.id}`;
                    const checked = selected.includes(key);
                    return (
                      <label key={key} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleItem(key)} className="size-4 rounded accent-accent" />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {!t.published && <Badge size="xs">Unpublished</Badge>}
                        <span className="shrink-0 text-xs text-ink-muted">{formatPrice(t.price, t.currency)}</span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
            {visible.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-muted">Nothing matches “{itemSearch}”.</p>}
          </div>
          {errors.items && <p className="mt-1 text-xs text-danger">{errors.items}</p>}
        </div>
      </form>
    </Dialog>
  );
}

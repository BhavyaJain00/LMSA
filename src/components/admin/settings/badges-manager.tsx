"use client";

import { useMemo, useState, useTransition } from "react";
import type { Badge as BadgeRecord, BadgeEvent } from "@/lib/types";
import { deleteBadgeAction, saveBadgeAction, setBadgeEnabledAction } from "@/lib/actions/badges";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { BADGE_EVENTS } from "./badge-events";
import { useBadgeEventText } from "./use-badge-event-text";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

export interface BadgeRowData extends BadgeRecord {
  holderCount: number;
}

export function BadgesManager({ badges }: { badges: BadgeRowData[] }) {
  const t = useT("admin");
  const toast = useToast();
  const eventLabel = (event: BadgeEvent) => eventText(event).label;
  const eventText = useBadgeEventText();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BadgeRowData | "new" | null>(null);
  const [toDelete, setToDelete] = useState<BadgeRowData | null>(null);
  const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({});
  const [deleting, startDelete] = useTransition();
  const [, startToggle] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? badges.filter((b) => `${b.title} ${b.description}`.toLowerCase().includes(q)) : badges;
  }, [badges, search]);

  const toggle = (badge: BadgeRowData, enabled: boolean) => {
    setEnabledOverrides((m) => ({ ...m, [badge.id]: enabled }));
    startToggle(async () => {
      const res = await setBadgeEnabledAction(badge.id, enabled);
      if (!res.ok) {
        setEnabledOverrides((m) => ({ ...m, [badge.id]: !enabled }));
        toast.error(t("badges.toast.updateFailed"), res.error);
      }
    });
  };

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteBadgeAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? t("badges.toast.deleted"));
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
            aria-label={t("badges.searchLabel")}
            placeholder={t("shared.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftAddon={<Icon.Search className="size-4" />}
          />
        </div>
        <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
          {t("badges.new")}
        </Button>
      </div>

      {badges.length === 0 ? (
        <EmptyState
          icon={<Icon.Award />}
          title={t("badges.empty.title")}
          description={t("badges.empty.description")}
          action={
            <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
              {t("badges.new")}
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t("badges.columns.badge")}</TH>
              <TH className="hidden md:table-cell">{t("badges.columns.awardedFor")}</TH>
              <TH className="hidden lg:table-cell">{t("badges.columns.holders")}</TH>
              <TH>{t("badges.columns.enabled")}</TH>
              <TH className="w-24 text-end">
                <span className="sr-only">{t("shared.actions")}</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TableEmpty colSpan={5}>{t("badges.noMatch", { query: search })}</TableEmpty>
            ) : (
              filtered.map((b) => {
                const enabled = enabledOverrides[b.id] ?? b.enabled;
                return (
                  <TR key={b.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.imageUrl} alt="" className="size-10 shrink-0 rounded-lg border border-border bg-surface-2 object-contain p-1" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{b.title}</p>
                          <p className="line-clamp-1 text-xs text-ink-muted">{b.description}</p>
                          <p className="mt-0.5 text-xs text-ink-faint md:hidden">{eventLabel(b.event)}</p>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <Badge tone="neutral">{eventLabel(b.event)}</Badge>
                      {b.threshold !== undefined && b.event !== "manual" && <span className="ms-2 text-xs text-ink-muted">≥ {b.threshold}</span>}
                      {!b.grantOnlyOnce && <span className="ms-2 text-xs text-ink-muted">{t("badges.repeatable")}</span>}
                    </TD>
                    <TD className="hidden text-ink-muted lg:table-cell">{t("badges.holders", { count: b.holderCount })}</TD>
                    <TD>
                      <Switch id={`badge-enabled-${b.id}`} aria-label={t("badges.enableNamed", { title: b.title })} checked={enabled} onChange={(e) => toggle(b, e.target.checked)} />
                    </TD>
                    <TD className="text-end">
                      <div className="flex justify-end gap-1">
                        <IconButton label={t("shared.editNamed", { name: b.title })} size="icon-sm" onClick={() => setEditing(b)}>
                          <Icon.Edit className="size-4" />
                        </IconButton>
                        <IconButton label={t("shared.deleteNamed", { name: b.title })} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(b)}>
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

      {editing && <BadgeFormDialog key={editing === "new" ? "new" : editing.id} badge={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title={toDelete ? t("badges.delete.title", { title: toDelete.title }) : ""}
        description={
          toDelete?.holderCount ? t("badges.delete.withHolders", { count: toDelete.holderCount }) : t("badges.delete.noHolders")
        }
        confirmLabel={t("shared.delete")}
      />
    </div>
  );
}

function BadgeFormDialog({ badge, onClose }: { badge: BadgeRowData | null; onClose: () => void }) {
  const t = useT("admin");
  const eventText = useBadgeEventText();
  const [imageUrl, setImageUrl] = useState(badge?.imageUrl ?? "");
  const [event, setEvent] = useState<BadgeEvent>(badge?.event ?? "course_completed");
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(saveBadgeAction, { onSuccess: onClose });
  const eventInfo = BADGE_EVENTS.find((e) => e.value === event);
  const formId = badge ? `badge-form-${badge.id}` : "badge-form-new";

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      size="lg"
      title={badge ? badge.title : t("badges.form.newTitle")}
      description={badge ? t("badges.form.editDescription") : t("badges.form.newDescription")}
      footer={
        <>
          {dirty && (
            <Badge tone="warning" dot className="me-auto">
              {t("shared.notSaved")}
            </Badge>
          )}
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("shared.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!dirty}>
            {t("shared.save")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-4">
        {badge && <input type="hidden" name="id" value={badge.id} />}
        <Field label={t("badges.form.title")} htmlFor={`${formId}-title`} error={errors.title} hint={t("badges.form.titleHint")} required>
          <Input id={`${formId}-title`} name="title" defaultValue={badge?.title} placeholder={t("badges.form.titlePlaceholder")} maxLength={80} invalid={!!errors.title} autoFocus />
        </Field>
        <Field label={t("badges.form.description")} htmlFor={`${formId}-description`} error={errors.description} required>
          <Textarea
            id={`${formId}-description`}
            name="description"
            rows={3}
            defaultValue={badge?.description}
            placeholder={t("badges.form.descriptionPlaceholder")}
            maxLength={300}
            invalid={!!errors.description}
          />
        </Field>
        <div>
          <FileUpload
            label={t("badges.form.image")}
            name="imageUrl"
            kind="image"
            value={imageUrl}
            onChange={(url) => {
              setImageUrl(url);
              markDirty();
            }}
            hint={t("badges.form.imageHint")}
          />
          {errors.imageUrl && <p className="mt-1 text-xs text-danger">{errors.imageUrl}</p>}
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold text-ink">{t("badges.form.rules")}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t("badges.form.event")} htmlFor={`${formId}-event`} error={errors.event} hint={eventInfo ? eventText(eventInfo.value).description : undefined} required>
              <Select
                id={`${formId}-event`}
                name="event"
                value={event}
                onChange={(e) => setEvent(e.target.value as BadgeEvent)}
                options={BADGE_EVENTS.map((e) => ({ value: e.value, label: eventText(e.value).label }))}
              />
            </Field>
            {eventInfo?.threshold ? (
              <Field label={eventText(eventInfo.value).threshold} htmlFor={`${formId}-threshold`} error={errors.threshold} hint={t("badges.form.thresholdHint")}>
                <Input
                  id={`${formId}-threshold`}
                  name="threshold"
                  type="number"
                  min={0}
                  max={event === "quiz_passed" ? 100 : undefined}
                  step={1}
                  defaultValue={badge?.threshold ?? ""}
                  invalid={!!errors.threshold}
                />
              </Field>
            ) : (
              <input type="hidden" name="threshold" value="" />
            )}
          </div>
          <div className="mt-4 space-y-3">
            <Switch
              id={`${formId}-once`}
              name="grantOnlyOnce"
              defaultChecked={badge?.grantOnlyOnce ?? true}
              label={t("badges.form.once")}
              description={t("badges.form.onceDescription")}
            />
            <Switch id={`${formId}-enabled`} name="enabled" defaultChecked={badge?.enabled ?? true} label={t("badges.form.enabled")} description={t("badges.form.enabledDescription")} />
          </div>
        </div>
      </form>
    </Dialog>
  );
}

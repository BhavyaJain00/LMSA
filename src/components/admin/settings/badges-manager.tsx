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
import { pluralize } from "@/lib/utils";
import { BADGE_EVENTS, BADGE_EVENT_LABELS } from "./badge-events";
import { useFormAction } from "./use-form-action";

export interface BadgeRowData extends BadgeRecord {
  holderCount: number;
}

export function BadgesManager({ badges }: { badges: BadgeRowData[] }) {
  const toast = useToast();
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
        toast.error("Error updating badge", res.error);
      }
    });
  };

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteBadgeAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? "Badge deleted successfully");
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
            aria-label="Search badges"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftAddon={<Icon.Search className="size-4" />}
          />
        </div>
        <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
          New badge
        </Button>
      </div>

      {badges.length === 0 ? (
        <EmptyState
          icon={<Icon.Award />}
          title="No Badges Found"
          description="Add one to get started. Badges reward learners for enrolling, finishing courses, passing quizzes and more."
          action={
            <Button leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
              New badge
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Badge</TH>
              <TH className="hidden md:table-cell">Awarded For</TH>
              <TH className="hidden lg:table-cell">Holders</TH>
              <TH>Enabled</TH>
              <TH className="w-24 text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TableEmpty colSpan={5}>No badges match “{search}”.</TableEmpty>
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
                          <p className="mt-0.5 text-xs text-ink-faint md:hidden">{BADGE_EVENT_LABELS[b.event]}</p>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <Badge tone="neutral">{BADGE_EVENT_LABELS[b.event]}</Badge>
                      {b.threshold !== undefined && b.event !== "manual" && <span className="ml-2 text-xs text-ink-muted">≥ {b.threshold}</span>}
                      {!b.grantOnlyOnce && <span className="ml-2 text-xs text-ink-muted">repeatable</span>}
                    </TD>
                    <TD className="hidden text-ink-muted lg:table-cell">{pluralize(b.holderCount, "member")}</TD>
                    <TD>
                      <Switch id={`badge-enabled-${b.id}`} aria-label={`Enable ${b.title}`} checked={enabled} onChange={(e) => toggle(b, e.target.checked)} />
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Edit ${b.title}`} size="icon-sm" onClick={() => setEditing(b)}>
                          <Icon.Edit className="size-4" />
                        </IconButton>
                        <IconButton label={`Delete ${b.title}`} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(b)}>
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
        title={`Delete ${toDelete?.title ?? "badge"}?`}
        description={
          toDelete?.holderCount
            ? `${pluralize(toDelete.holderCount, "member")} will lose this badge. This cannot be undone.`
            : "The badge definition will be removed. This cannot be undone."
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function BadgeFormDialog({ badge, onClose }: { badge: BadgeRowData | null; onClose: () => void }) {
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
      title={badge ? badge.title : "New Badge"}
      description={badge ? "Update how this badge looks and when it is awarded." : "Define a badge and the rule that awards it."}
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
          <Button type="submit" form={formId} loading={pending} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-4">
        {badge && <input type="hidden" name="id" value={badge.id} />}
        <Field label="Title" htmlFor={`${formId}-title`} error={errors.title} hint="The name this badge is awarded and displayed under." required>
          <Input id={`${formId}-title`} name="title" defaultValue={badge?.title} placeholder="e.g. Course Champion" maxLength={80} invalid={!!errors.title} autoFocus />
        </Field>
        <Field label="Description" htmlFor={`${formId}-description`} error={errors.description} required>
          <Textarea
            id={`${formId}-description`}
            name="description"
            rows={3}
            defaultValue={badge?.description}
            placeholder="What is this badge awarded for?"
            maxLength={300}
            invalid={!!errors.description}
          />
        </Field>
        <div>
          <FileUpload
            label="Badge Image"
            name="imageUrl"
            kind="image"
            value={imageUrl}
            onChange={(url) => {
              setImageUrl(url);
              markDirty();
            }}
            hint="Shown wherever this badge is awarded. Square SVG or PNG works best."
          />
          {errors.imageUrl && <p className="mt-1 text-xs text-danger">{errors.imageUrl}</p>}
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold text-ink">Assignment rules</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Event" htmlFor={`${formId}-event`} error={errors.event} hint={eventInfo?.description} required>
              <Select
                id={`${formId}-event`}
                name="event"
                value={event}
                onChange={(e) => setEvent(e.target.value as BadgeEvent)}
                options={BADGE_EVENTS.map((e) => ({ value: e.value, label: e.label }))}
              />
            </Field>
            {eventInfo?.threshold ? (
              <Field label={eventInfo.threshold} htmlFor={`${formId}-threshold`} error={errors.threshold} hint="Leave empty for the default (1, or 0% for quizzes).">
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
              label="Grant Only Once"
              description="Each user can only receive this badge one time."
            />
            <Switch id={`${formId}-enabled`} name="enabled" defaultChecked={badge?.enabled ?? true} label="Enabled" description="Disabled badges are never awarded automatically." />
          </div>
        </div>
      </form>
    </Dialog>
  );
}

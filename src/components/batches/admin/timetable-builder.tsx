"use client";

import { useState } from "react";
import type { TimetableItemType, TimetableLegend } from "@/lib/types";
import { clearTimetableAction, deleteTimetableItemAction, saveTimetableItemAction, saveTimetableLegendsAction } from "@/lib/actions/batches";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useActionForm, useServerAction } from "../hooks";
import { TimetableView, timetableTypeLabel } from "../timetable-view";
import { formatClockRange, formatDayKey } from "../tz";
import type { Option, TimetableEntry } from "../types";
import { GroupedSelect } from "./form-fields";

export type TimetableRefOptions = Record<Exclude<TimetableItemType, "custom">, Option[]>;

const TYPES: TimetableItemType[] = ["live_class", "lesson", "course", "quiz", "assignment", "exercise", "custom"];
const DEFAULT_COLORS = ["#4f46e5", "#0891b2", "#d97706", "#16a34a", "#db2777", "#7c3aed", "#dc2626", "#0d9488"];

function ItemForm({
  batchId,
  item,
  legends,
  refOptions,
  minDate,
  maxDate,
  onDone,
}: {
  batchId: string;
  item: TimetableEntry | null;
  legends: TimetableLegend[];
  refOptions: TimetableRefOptions;
  minDate: string;
  maxDate: string;
  onDone: () => void;
}) {
  const [type, setType] = useState<TimetableItemType>(item?.type ?? "live_class");
  const [refId, setRefId] = useState(item?.refId ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const { onSubmit, pending, error, fieldErrors } = useActionForm(saveTimetableItemAction, { onSuccess: onDone });
  const options = type === "custom" ? [] : refOptions[type];

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="batchId" value={batchId} />
      {item?.itemId && <input type="hidden" name="itemId" value={item.itemId} />}
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="tt-type" required error={fieldErrors.type}>
          <Select
            id="tt-type"
            name="type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as TimetableItemType);
              setRefId("");
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "custom" ? "Custom event" : timetableTypeLabel[t]}
              </option>
            ))}
          </Select>
        </Field>
        {type !== "custom" && (
          <Field label={timetableTypeLabel[type]} htmlFor="tt-ref" required error={fieldErrors.refId}>
            <GroupedSelect
              id="tt-ref"
              name="refId"
              value={refId}
              onChange={(v) => {
                setRefId(v);
                const label = options.find((o) => o.value === v)?.label.replace(/^\d+\.\d+\s/, "");
                if (label && (!title || options.some((o) => o.label.replace(/^\d+\.\d+\s/, "") === title))) setTitle(label);
              }}
              options={options}
              placeholder={options.length ? `Select a ${timetableTypeLabel[type].toLowerCase()}` : "Nothing available"}
              invalid={!!fieldErrors.refId}
              disabled={!options.length}
            />
          </Field>
        )}
        <Field label="Title" htmlFor="tt-title" required error={fieldErrors.title} className="sm:col-span-2" hint={type !== "custom" ? "Defaults to the linked item's title." : undefined}>
          <Input id="tt-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} invalid={!!fieldErrors.title} />
        </Field>
        <Field label="Date" htmlFor="tt-date" required error={fieldErrors.date}>
          <Input id="tt-date" name="date" type="date" min={minDate} max={maxDate} defaultValue={item?.date ?? minDate} required invalid={!!fieldErrors.date} />
        </Field>
        <Field label="Legend" htmlFor="tt-legend" error={fieldErrors.legendId}>
          <Select id="tt-legend" name="legendId" defaultValue={item?.legendId ?? ""}>
            <option value="">No legend</option>
            {legends.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start time" htmlFor="tt-start" error={fieldErrors.startTime}>
          <Input id="tt-start" name="startTime" type="time" defaultValue={item?.startTime} invalid={!!fieldErrors.startTime} />
        </Field>
        <Field label="End time" htmlFor="tt-end" error={fieldErrors.endTime}>
          <Input id="tt-end" name="endTime" type="time" defaultValue={item?.endTime} invalid={!!fieldErrors.endTime} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox name="milestone" defaultChecked={item?.milestone} label="Milestone" description="Highlight this item (e.g. a deadline or demo day) on the calendar." />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {item ? "Save changes" : "Add to timetable"}
        </Button>
      </div>
    </form>
  );
}

function LegendsEditor({ batchId, legends }: { batchId: string; legends: TimetableLegend[] }) {
  const [rows, setRows] = useState<{ id?: string; key: string; label: string; color: string }[]>(() => legends.map((l) => ({ id: l.id, key: l.id, label: l.label, color: l.color })));
  const [counter, setCounter] = useState(0);
  const { pending, run } = useServerAction();
  const original = JSON.stringify(legends.map((l) => ({ id: l.id, label: l.label, color: l.color })));
  const current = JSON.stringify(rows.map((r) => ({ id: r.id, label: r.label, color: r.color })));
  const dirty = original !== current;

  const update = (key: string, patch: Partial<{ label: string; color: string }>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader
        title="Legends"
        description="Color-code the timetable (e.g. Live class, Self-paced, Deadline)."
        actions={
          dirty ? (
            <Badge tone="warning" dot>
              Not Saved
            </Badge>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-ink-muted">No legends yet.</p>}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border-strong" title="Pick a color">
                <span className="absolute inset-1 rounded-md" style={{ backgroundColor: r.color }} aria-hidden="true" />
                <input type="color" value={r.color} onChange={(e) => update(r.key, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Color for ${r.label || "legend"}`} />
              </label>
              <Input value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} placeholder="Label" maxLength={40} aria-label="Legend label" />
              <IconButton label={`Remove ${r.label || "legend"}`} size="icon-sm" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} className="hover:text-danger">
                <Icon.Trash className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Icon.Plus className="size-4" />}
            onClick={() => {
              setRows((list) => [...list, { key: `new-${counter}`, label: "", color: DEFAULT_COLORS[list.length % DEFAULT_COLORS.length]! }]);
              setCounter((c) => c + 1);
            }}
            disabled={rows.length >= 20}
          >
            Add legend
          </Button>
          <Button size="sm" loading={pending} disabled={!dirty} onClick={() => run(() => saveTimetableLegendsAction(batchId, rows.map((r) => ({ id: r.id, label: r.label, color: r.color }))))}>
            Save legends
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Timetable builder: items (add/edit/delete/clear), legend editor and a live preview. */
export function TimetableBuilder({
  batchId,
  items,
  legends,
  refOptions,
  previewEntries,
  startDate,
  endDate,
  lastDay,
  todayKey,
  timezone,
}: {
  batchId: string;
  items: TimetableEntry[];
  legends: TimetableLegend[];
  refOptions: TimetableRefOptions;
  previewEntries: TimetableEntry[];
  startDate: string;
  endDate: string;
  lastDay: string;
  todayKey: string;
  timezone: string;
}) {
  const [editing, setEditing] = useState<TimetableEntry | null | "new">(null);
  const [deleting, setDeleting] = useState<TimetableEntry | null>(null);
  const [clearing, setClearing] = useState(false);
  const { pending, run } = useServerAction();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Timetable</h2>
          <p className="text-sm text-ink-muted">Plan sessions, lessons and deadlines. Learners see this on the batch Timetable tab.</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Button variant="outline" onClick={() => setClearing(true)} leftIcon={<Icon.Trash className="size-4" />}>
              Clear
            </Button>
          )}
          <Button onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
            Add item
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<Icon.Calendar />}
              title="The timetable is empty"
              description="Add live classes, lessons, assessments or custom events with dates so learners know what's next."
              action={
                <Button onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
                  Add item
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Item</TH>
                  <TH>Legend</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.id}>
                    <TD className="whitespace-nowrap">
                      <span className="block font-medium">{formatDayKey(it.date, "weekday")}</span>
                      <span className="text-xs text-ink-muted">{it.startTime ? formatClockRange(it.startTime, it.endTime) : "All day"}</span>
                    </TD>
                    <TD>
                      <span className="flex min-w-48 items-center gap-2">
                        <span className="truncate font-medium">{it.title}</span>
                        {it.milestone && (
                          <Badge tone="warning" size="xs">
                            Milestone
                          </Badge>
                        )}
                      </span>
                      <span className={cn("text-xs", it.href || it.type === "custom" ? "text-ink-muted" : "text-danger")}>
                        {timetableTypeLabel[it.type]}
                        {!it.href && it.type !== "custom" && " · linked item missing"}
                      </span>
                    </TD>
                    <TD>
                      {it.legendLabel ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: it.color ?? undefined }} aria-hidden="true" />
                          {it.legendLabel}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <span className="inline-flex gap-0.5">
                        <IconButton label={`Edit ${it.title}`} size="icon-sm" onClick={() => setEditing(it)}>
                          <Icon.Edit className="size-4" />
                        </IconButton>
                        <IconButton label={`Delete ${it.title}`} size="icon-sm" onClick={() => setDeleting(it)} className="hover:text-danger">
                          <Icon.Trash className="size-4" />
                        </IconButton>
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        <LegendsEditor key={JSON.stringify(legends)} batchId={batchId} legends={legends} />
      </div>

      {previewEntries.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Preview</h3>
          <TimetableView entries={previewEntries} legends={legends} startDate={startDate} endDate={endDate} todayKey={todayKey} timezone={timezone} />
        </section>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add to timetable" : "Edit timetable item"} size="md">
        {editing !== null && (
          <ItemForm
            batchId={batchId}
            item={editing === "new" ? null : editing}
            legends={legends}
            refOptions={refOptions}
            minDate={startDate}
            maxDate={lastDay}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const itemId = deleting?.itemId;
          if (itemId) run(() => deleteTimetableItemAction(batchId, itemId), { onSuccess: () => setDeleting(null) });
        }}
        loading={pending}
        destructive
        title={`Delete "${deleting?.title ?? "item"}" from the timetable?`}
        description="The linked lesson, class or assessment itself is not affected."
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        onConfirm={() => run(() => clearTimetableAction(batchId), { onSuccess: () => setClearing(false) })}
        loading={pending}
        destructive
        title="Clear the whole timetable?"
        description={`All ${items.length} items will be removed. Legends, live classes and assessments are kept.`}
        confirmLabel="Clear timetable"
      />
    </div>
  );
}

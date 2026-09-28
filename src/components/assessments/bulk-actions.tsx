"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Row selection state that ignores ids no longer present in the list. */
export function useSelection(allIds: string[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const present = new Set(allIds);
  const selected = Array.from(picked).filter((id) => present.has(id));
  const selectedSet = new Set(selected);
  const allSelected = allIds.length > 0 && selected.length === allIds.length;
  return {
    selected,
    isSelected: (id: string) => selectedSet.has(id),
    toggle: (id: string) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () => setPicked(allSelected ? new Set() : new Set(allIds)),
    clear: () => setPicked(new Set()),
    allSelected,
    someSelected: selected.length > 0 && !allSelected,
  };
}

/** Header checkbox with an indeterminate state. */
export function SelectAllCheckbox({ checked, indeterminate, onChange, label = "Select all rows" }: { checked: boolean; indeterminate: boolean; onChange: () => void; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      className="size-4 cursor-pointer rounded border-border-strong accent-accent"
    />
  );
}

export function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="size-4 cursor-pointer rounded border-border-strong accent-accent"
    />
  );
}

/**
 * Selection bar with a confirmed bulk "Delete". Calls `action(ids)` and
 * reports the result as a toast.
 */
export function BulkDeleteBar({
  selected,
  onClear,
  action,
  noun,
  confirmTitle = "Confirm Your Action",
  confirmDescription,
}: {
  selected: string[];
  onClear: () => void;
  action: (ids: string[]) => Promise<ActionResult<{ count: number }>>;
  noun: string;
  confirmTitle?: string;
  confirmDescription: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  if (!selected.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 animate-fade-in" role="region" aria-label="Selection actions">
      <p className="text-sm font-medium text-ink">
        {selected.length} {noun}
        {selected.length === 1 ? "" : "s"} selected
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setOpen(true)} leftIcon={<Icon.Trash className="size-4" />}>
          Delete
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await action(selected);
            if (res.ok) {
              toast({ title: res.message ?? "Deleted", tone: "success" });
              onClear();
              setOpen(false);
            } else {
              toast({ title: res.error, tone: "error" });
            }
          })
        }
      />
    </div>
  );
}

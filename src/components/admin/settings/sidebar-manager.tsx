"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { SidebarItem } from "@/lib/types";
import { deleteSidebarItemAction, moveSidebarItemAction, saveSidebarItemAction } from "@/lib/actions/settings";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useFormAction } from "./use-form-action";

export interface BuiltInItem {
  label: string;
  href: string;
  icon: IconName;
  visible: boolean;
  note: string;
}

const ICON_NAMES = (Object.keys(Icon) as IconName[]).filter((n) => n !== "Loader" && n !== "Dot");

function linkType(href: string): string {
  if (href.startsWith("/")) return "Link within this site";
  if (href.startsWith("mailto:")) return "Email link";
  return "External link";
}

function IconGlyph({ name, className }: { name: string | undefined; className?: string }) {
  const key = (name && name in Icon ? name : "ExternalLink") as IconName;
  const Glyph = Icon[key];
  return <Glyph className={className} />;
}

export function SidebarManager({ items, builtIns }: { items: SidebarItem[]; builtIns: BuiltInItem[] }) {
  const toast = useToast();
  const [editing, setEditing] = useState<SidebarItem | "new" | null>(null);
  const [toDelete, setToDelete] = useState<SidebarItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [, startMove] = useTransition();

  const move = (item: SidebarItem, direction: "up" | "down") => {
    setBusyId(item.id);
    startMove(async () => {
      const res = await moveSidebarItemAction(item.id, direction);
      if (!res.ok) toast.error("Error saving sidebar", res.error);
      setBusyId(null);
    });
  };

  const confirmDelete = () => {
    const target = toDelete;
    if (!target) return;
    startDelete(async () => {
      const res = await deleteSidebarItemAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? "Sidebar link removed");
        setToDelete(null);
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="text-base font-semibold text-ink">Custom links</h3>
            <p className="text-sm text-ink-muted">Shown under “Links” in the sidebar, in this order.</p>
          </div>
          <Button size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setEditing("new")}>
            New
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-ink">No custom links yet</p>
            <p className="mt-1 text-sm text-ink-muted">Add links to your blog, community forum, help center or any page on this site.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item, i) => (
              <li key={item.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", busyId === item.id && "opacity-60")}>
                <div className="flex flex-col">
                  <IconButton label={`Move ${item.label} up`} size="icon-sm" disabled={i === 0 || !!busyId} onClick={() => move(item, "up")}>
                    <Icon.ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton label={`Move ${item.label} down`} size="icon-sm" disabled={i === items.length - 1 || !!busyId} onClick={() => move(item, "down")}>
                    <Icon.ChevronDown className="size-4" />
                  </IconButton>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
                  <IconGlyph name={item.icon} className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                  <p className="truncate text-xs text-ink-muted">
                    <span className="hidden sm:inline">{linkType(item.href)} · </span>
                    <span className="font-mono">{item.href}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton label={`Edit ${item.label}`} size="icon-sm" onClick={() => setEditing(item)}>
                    <Icon.Edit className="size-4" />
                  </IconButton>
                  <IconButton label={`Delete ${item.label}`} size="icon-sm" className="hover:text-danger" onClick={() => setToDelete(item)}>
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <h3 className="text-base font-semibold text-ink">Built-in items</h3>
          <p className="text-sm text-ink-muted">
            These follow your{" "}
            <Link href="/admin/settings/features" className="font-medium text-accent hover:underline">
              Features
            </Link>{" "}
            and{" "}
            <Link href="/admin/settings/general" className="font-medium text-accent hover:underline">
              contact
            </Link>{" "}
            settings and each member&apos;s role.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {builtIns.map((b) => (
            <li key={b.label} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
                <IconGlyph name={b.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{b.label}</p>
                <p className="truncate text-xs text-ink-muted">{b.note}</p>
              </div>
              {b.visible ? (
                <Badge tone="success" dot>
                  Visible
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  Hidden
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </div>

      {editing && <SidebarLinkDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title={`Remove “${toDelete?.label ?? "link"}” from the sidebar?`}
        description="Members will no longer see this link. You can add it again at any time."
        confirmLabel="Remove"
      />
    </div>
  );
}

function SidebarLinkDialog({ item, onClose }: { item: SidebarItem | null; onClose: () => void }) {
  const [icon, setIcon] = useState<string>(item?.icon ?? "ExternalLink");
  const [label, setLabel] = useState(item?.label ?? "");
  const [iconSearch, setIconSearch] = useState("");
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(saveSidebarItemAction, { onSuccess: onClose });
  const formId = item ? `sidebar-form-${item.id}` : "sidebar-form-new";

  const icons = useMemo(() => {
    const q = iconSearch.trim().toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : ICON_NAMES;
  }, [iconSearch]);

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      size="lg"
      title={item ? "Edit sidebar link" : "Add link to sidebar"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!!item && !dirty}>
            {item ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-4">
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="icon" value={icon} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" htmlFor={`${formId}-label`} error={errors.label} required>
            <Input id={`${formId}-label`} name="label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Community forum" invalid={!!errors.label} autoFocus />
          </Field>
          <Field label="Link" htmlFor={`${formId}-href`} error={errors.href} hint={errors.href ? undefined : "A route like /programs or a full https:// URL."} required>
            <Input id={`${formId}-href`} name="href" defaultValue={item?.href} placeholder="https://forum.example.com" invalid={!!errors.href} spellCheck={false} />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink">
              Icon<span className="ml-0.5 text-danger">*</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              Preview
              <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1 text-sm text-ink">
                <IconGlyph name={icon} className="size-4" />
                {label || "Link"}
              </span>
            </span>
          </div>
          <Input
            type="search"
            aria-label="Search icons"
            placeholder="Search icons"
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
            leftAddon={<Icon.Search className="size-4" />}
          />
          <div role="radiogroup" aria-label="Icon" className="mt-2 grid max-h-56 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-border p-1.5 sm:grid-cols-9">
            {icons.map((name) => {
              const selected = icon === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => {
                    setIcon(name);
                    markDirty();
                  }}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md transition-colors",
                    selected ? "bg-accent text-accent-fg" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <IconGlyph name={name} className="size-4.5" />
                </button>
              );
            })}
            {icons.length === 0 && <p className="col-span-full px-2 py-4 text-center text-sm text-ink-muted">No icons match “{iconSearch}”.</p>}
          </div>
          {errors.icon && <p className="mt-1 text-xs text-danger">{errors.icon}</p>}
        </div>
      </form>
    </Dialog>
  );
}

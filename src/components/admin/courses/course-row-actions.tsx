"use client";

import { useState, useTransition } from "react";
import { approveCourseAction, setCoursePublishedAction } from "@/lib/actions/courses";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { WorkflowFlags } from "./types";

/** Row menu on the course list: edit, view, export and quick publishing actions. */
export function CourseRowActions({ id, slug, title, workflow }: { id: string; slug: string; title: string; workflow: WorkflowFlags }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message ?? "Saved");
      else toast.error(res.error ?? "Could not update publish status");
      setConfirm(null);
    });

  const items: DropdownItem[] = [];
  if (workflow.canEdit) {
    items.push(
      { label: "Edit details", icon: <Icon.Edit />, href: `/admin/courses/${id}` },
      { label: "Outline", icon: <Icon.Layers />, href: `/admin/courses/${id}?tab=outline` },
      { label: "Dashboard", icon: <Icon.BarChart />, href: `/admin/courses/${id}?tab=dashboard` },
      { label: "Settings", icon: <Icon.Settings />, href: `/admin/courses/${id}?tab=settings` },
    );
  }
  items.push({ label: "View course", icon: <Icon.Eye />, href: `/courses/${slug}`, separator: workflow.canEdit });
  if (workflow.canEdit) {
    items.push({
      label: "Export JSON",
      icon: <Icon.Download />,
      onClick: () => {
        // Trigger the JSON download without leaving the page.
        const a = document.createElement("a");
        a.href = `/admin/courses/${id}/export`;
        a.download = `${slug}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    });
  }
  if (workflow.canApprove) items.push({ label: "Approve", icon: <Icon.ShieldCheck />, separator: true, onClick: () => run(() => approveCourseAction(id)) });
  if (workflow.canPublish) items.push({ label: "Publish", icon: <Icon.Globe />, separator: !workflow.canApprove, onClick: () => setConfirm("publish") });
  if (workflow.canUnpublish) items.push({ label: "Unpublish", icon: <Icon.EyeOff />, destructive: true, separator: true, onClick: () => setConfirm("unpublish") });

  return (
    <>
      <Dropdown
        trigger={
          <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
            {pending ? <Spinner className="size-4" /> : <Icon.MoreHorizontal className="size-4" />}
            <span className="sr-only">Actions for {title}</span>
          </span>
        }
        items={items}
      />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => !pending && setConfirm(null)}
        loading={pending}
        onConfirm={() => run(() => setCoursePublishedAction(id, confirm === "publish"))}
        title={confirm === "publish" ? `Publish “${title}”?` : `Unpublish “${title}”?`}
        description={
          confirm === "publish"
            ? "The course will appear in the catalog and learners can enroll right away."
            : "It will be hidden from the catalog and new learners can't enroll. Enrolled learners keep their progress."
        }
        confirmLabel={confirm === "publish" ? "Publish" : "Unpublish"}
        destructive={confirm === "unpublish"}
      />
    </>
  );
}

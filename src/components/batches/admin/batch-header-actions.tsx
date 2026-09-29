"use client";

import { useState } from "react";
import { deleteBatchAction, setBatchPublishedAction } from "@/lib/actions/batches";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useServerAction } from "../hooks";

/** Publish / Unpublish, view page and the batch options menu (certificates, delete). */
export function BatchHeaderActions({
  batchId,
  slug,
  published,
  certification,
}: {
  batchId: string;
  slug: string;
  published: boolean;
  certification: boolean;
}) {
  const publish = useServerAction();
  const remove = useServerAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const items: DropdownItem[] = [
    { label: "View batch page", icon: <Icon.ExternalLink />, href: `/batches/${slug}` },
    { label: published ? "Unpublish batch" : "Publish batch", icon: <Icon.Globe />, onClick: () => publish.run(() => setBatchPublishedAction(batchId, !published)) },
  ];
  if (certification) items.push({ label: "Generate Certificates", icon: <Icon.Award />, href: `/admin/certificates/bulk?batch=${batchId}` });
  items.push({ label: "Delete batch", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setConfirmDelete(true) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={`/batches/${slug}`} variant="outline" className="hidden sm:inline-flex" leftIcon={<Icon.Eye className="size-4" />}>
        View
      </ButtonLink>
      <Button
        variant={published ? "subtle" : "secondary"}
        className={published ? "hidden text-danger sm:inline-flex" : "hidden sm:inline-flex"}
        loading={publish.pending}
        onClick={() => publish.run(() => setBatchPublishedAction(batchId, !published))}
        leftIcon={<Icon.Globe className="size-4" />}
      >
        {published ? "Unpublish" : "Publish"}
      </Button>
      <Dropdown
        trigger={
          <span className="inline-flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-1 text-ink hover:bg-surface-2">
            <Icon.MoreHorizontal className="size-5" />
            <span className="sr-only">Batch options</span>
          </span>
        }
        items={items}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.run(() => deleteBatchAction(batchId))}
        loading={remove.pending}
        destructive
        title="Confirm your action to delete"
        description="Deleting this batch will also delete all its data including enrolled students, linked courses, assessments, feedback and discussions. Are you sure you want to continue?"
        confirmLabel="Delete"
      />
    </div>
  );
}

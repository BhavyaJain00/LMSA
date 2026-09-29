"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteJobAction, setJobStatusAction, withdrawApplicationAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

/**
 * Row menu on the jobs management lists: view, edit, applications,
 * close/reopen, delete. `area` picks the admin routes (/admin/jobs/…) or the
 * poster's own routes (/jobs/[slug]/edit, /jobs/[slug]/applications).
 */
export function JobRowActions({
  job,
  area = "admin",
}: {
  job: { id: string; slug: string; title: string; status: "open" | "closed"; applicantCount: number };
  area?: "admin" | "member";
}) {
  const editHref = area === "admin" ? `/admin/jobs/${job.id}` : `/jobs/${job.slug}/edit`;
  const applicationsHref = area === "admin" ? `/admin/jobs/${job.id}/applications` : `/jobs/${job.slug}/applications`;
  const toast = useToast();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, startTransition] = useTransition();

  const toggleStatus = () => {
    startTransition(async () => {
      const res = await setJobStatusAction(job.id, job.status === "open" ? "closed" : "open");
      if (res.ok) toast.success(res.message ?? "Job updated");
      else toast.error(res.error);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteJobAction(job.id);
      if (res.ok) {
        toast.success(res.message ?? "Job opening deleted");
        setConfirmDelete(false);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <>
      <Dropdown
        trigger={
          <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Icon.MoreHorizontal className="size-4" />
            <span className="sr-only">Actions for {job.title}</span>
          </span>
        }
        items={[
          { label: "View job", icon: <Icon.Eye />, href: `/jobs/${job.slug}` },
          { label: "Edit", icon: <Icon.Edit />, href: editHref },
          { label: `Applications (${job.applicantCount})`, icon: <Icon.Users />, href: applicationsHref },
          {
            label: job.status === "open" ? "Close job" : "Reopen job",
            icon: job.status === "open" ? <Icon.Lock /> : <Icon.Unlock />,
            onClick: toggleStatus,
            disabled: busy,
            separator: true,
          },
          { label: "Delete", icon: <Icon.Trash />, onClick: () => setConfirmDelete(true), destructive: true, disabled: busy },
        ]}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        loading={busy}
        destructive
        title={`Delete “${job.title}”?`}
        description={job.applicantCount ? `The job and its ${job.applicantCount} application(s) will be permanently deleted.` : "The job opening will be permanently deleted."}
        confirmLabel="Delete"
      />
    </>
  );
}

/** Close / reopen button on the job page for its manager. */
export function JobStatusButton({ jobId, status }: { jobId: string; status: "open" | "closed" }) {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  return (
    <Button
      variant="subtle"
      loading={busy}
      leftIcon={status === "open" ? <Icon.Lock className="size-4" /> : <Icon.Unlock className="size-4" />}
      onClick={() =>
        startTransition(async () => {
          const res = await setJobStatusAction(jobId, status === "open" ? "closed" : "open");
          if (res.ok) toast.success(res.message ?? "Job updated");
          else toast.error(res.error);
        })
      }
    >
      {status === "open" ? "Close job" : "Reopen job"}
    </Button>
  );
}

/** Withdraw your own job application (with confirmation). */
export function WithdrawApplicationButton({ applicationId, jobTitle }: { applicationId: string; jobTitle: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        onConfirm={() =>
          startTransition(async () => {
            const res = await withdrawApplicationAction(applicationId);
            if (res.ok) {
              toast.success(res.message ?? "Application withdrawn");
              setOpen(false);
            } else toast.error(res.error);
          })
        }
        loading={busy}
        destructive
        title="Withdraw your application?"
        description={`Your application for “${jobTitle}” will be removed and the poster will no longer see it.`}
        confirmLabel="Withdraw"
      />
    </>
  );
}

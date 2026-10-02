"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteJobAction, setJobStatusAction, withdrawApplicationAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/* Rendered through `./job-actions.tsx`, which provides the `jobs.` messages on the admin pages too. */

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
  const t = useT("public");
  const common = useT("common");
  const toast = useToast();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, startTransition] = useTransition();

  const toggleStatus = () => {
    startTransition(async () => {
      const res = await setJobStatusAction(job.id, job.status === "open" ? "closed" : "open");
      if (res.ok) toast.success(res.message ?? t("jobs.actions.updated"));
      else toast.error(res.error);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteJobAction(job.id);
      if (res.ok) {
        toast.success(res.message ?? t("jobs.actions.deleted"));
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
            <span className="sr-only">{t("jobs.actions.for", { title: job.title })}</span>
          </span>
        }
        items={[
          { label: t("jobs.actions.view"), icon: <Icon.Eye />, href: `/jobs/${job.slug}` },
          { label: common("actions.edit"), icon: <Icon.Edit />, href: editHref },
          { label: t("jobs.actions.applications", { count: job.applicantCount }), icon: <Icon.Users />, href: applicationsHref },
          {
            label: job.status === "open" ? t("jobs.actions.close") : t("jobs.actions.reopen"),
            icon: job.status === "open" ? <Icon.Lock /> : <Icon.Unlock />,
            onClick: toggleStatus,
            disabled: busy,
            separator: true,
          },
          { label: common("actions.delete"), icon: <Icon.Trash />, onClick: () => setConfirmDelete(true), destructive: true, disabled: busy },
        ]}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        loading={busy}
        destructive
        title={t("jobs.actions.deleteTitle", { title: job.title })}
        description={job.applicantCount ? t("jobs.actions.deleteWithApplications", { count: job.applicantCount }) : t("jobs.actions.deleteDescription")}
        confirmLabel={common("actions.delete")}
      />
    </>
  );
}

/** Close / reopen button on the job page for its manager. */
export function JobStatusButton({ jobId, status }: { jobId: string; status: "open" | "closed" }) {
  const t = useT("public");
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
          if (res.ok) toast.success(res.message ?? t("jobs.actions.updated"));
          else toast.error(res.error);
        })
      }
    >
      {status === "open" ? t("jobs.actions.close") : t("jobs.actions.reopen")}
    </Button>
  );
}

/** Withdraw your own job application (with confirmation). */
export function WithdrawApplicationButton({ applicationId, jobTitle }: { applicationId: string; jobTitle: string }) {
  const t = useT("public");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setOpen(true)}>
        {t("jobs.withdraw.button")}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        onConfirm={() =>
          startTransition(async () => {
            const res = await withdrawApplicationAction(applicationId);
            if (res.ok) {
              toast.success(res.message ?? t("jobs.withdraw.done"));
              setOpen(false);
            } else toast.error(res.error);
          })
        }
        loading={busy}
        destructive
        title={t("jobs.withdraw.title")}
        description={t("jobs.withdraw.description", { title: jobTitle })}
        confirmLabel={t("jobs.withdraw.button")}
      />
    </>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CertificateRow } from "@/lib/data/certificates";
import { revokeCertificateAction, setCertificatePublishedAction } from "@/lib/actions/certificates";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatShortDate } from "./time";

/** `baseUrl` is the public origin (APP_URL when configured) used for copied verification links. */
export function CertificatesTable({ rows, baseUrl }: { rows: CertificateRow[]; baseUrl: string }) {
  const { toast } = useToast();
  const [revoking, setRevoking] = useState<CertificateRow | null>(null);
  const [pending, startTransition] = useTransition();

  const togglePublished = (row: CertificateRow) =>
    startTransition(async () => {
      const res = await setCertificatePublishedAction(row.id, !row.published);
      toast({ title: res.ok ? (res.message ?? "Saved") : res.error, tone: res.ok ? "success" : "error" });
    });

  const copyLink = async (row: CertificateRow) => {
    const url = `${baseUrl || window.location.origin}/certificates/${encodeURIComponent(row.code)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url, tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", description: url, tone: "error" });
    }
  };

  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Learner</TH>
            <TH className="hidden md:table-cell">Course / Batch</TH>
            <TH className="hidden sm:table-cell">Certificate ID</TH>
            <TH className="hidden lg:table-cell">Issued</TH>
            <TH>Status</TH>
            <TH className="w-12">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD>
                <div className="flex items-center gap-2.5">
                  <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    {row.user.username ? (
                      <Link href={`/user/${row.user.username}`} className="block truncate font-medium text-ink hover:underline">
                        {row.user.name}
                      </Link>
                    ) : (
                      <p className="truncate font-medium text-ink">{row.user.name}</p>
                    )}
                    <p className="truncate text-xs text-ink-muted">{row.user.email}</p>
                    <p className="truncate text-xs text-ink-muted md:hidden">{row.courseTitle ?? row.batchTitle}</p>
                  </div>
                </div>
              </TD>
              <TD className="hidden md:table-cell">
                <p className="text-ink">{row.courseTitle ?? row.batchTitle}</p>
                <p className="text-xs text-ink-muted">
                  {row.courseTitle ? (row.batchTitle ? `Course · via ${row.batchTitle}` : "Course") : "Batch"}
                  {row.evaluatorName ? ` · evaluated by ${row.evaluatorName}` : ""}
                </p>
              </TD>
              <TD className="hidden sm:table-cell">
                <a href={`/certificates/${row.code}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent hover:underline">
                  {row.code}
                  <Icon.ExternalLink className="size-3" />
                </a>
              </TD>
              <TD className="hidden whitespace-nowrap text-sm text-ink-muted lg:table-cell">
                {formatShortDate(row.issueDate)}
                {row.expiryDate && <p className="text-xs text-ink-faint">Expires {formatShortDate(row.expiryDate)}</p>}
              </TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  {row.published ? (
                    <Badge tone="success" dot>
                      Published
                    </Badge>
                  ) : (
                    <Badge tone="neutral" dot>
                      Unpublished
                    </Badge>
                  )}
                  {row.expired && <Badge tone="warning">Expired</Badge>}
                </div>
              </TD>
              <TD className="w-12 text-right">
                <Dropdown
                  trigger={
                    <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2">
                      <Icon.MoreVertical className="size-4" />
                      <span className="sr-only">Actions for {row.code}</span>
                    </span>
                  }
                  items={[
                    { label: "View certificate", icon: <Icon.ExternalLink />, href: `/certificates/${row.code}` },
                    { label: "Copy link", icon: <Icon.Link />, onClick: () => void copyLink(row) },
                    {
                      label: row.published ? "Unpublish" : "Publish",
                      icon: row.published ? <Icon.EyeOff /> : <Icon.Eye />,
                      description: row.published ? "Hide from the certified members page" : "Show on the certified members page",
                      onClick: () => togglePublished(row),
                      disabled: pending,
                    },
                    { label: "Revoke", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setRevoking(row) },
                  ]}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this certificate?"
        description={
          revoking
            ? `The certificate ${revoking.code} issued to ${revoking.user.name} will be deleted and its verification link will stop working. This cannot be undone.`
            : undefined
        }
        confirmLabel="Revoke"
        destructive
        loading={pending}
        onConfirm={() => {
          const target = revoking;
          if (!target) return;
          startTransition(async () => {
            const res = await revokeCertificateAction(target.id);
            toast({ title: res.ok ? (res.message ?? "Certificate revoked") : res.error, tone: res.ok ? "success" : "error" });
            if (res.ok) setRevoking(null);
          });
        }}
      />
    </>
  );
}

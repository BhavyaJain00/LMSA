"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { assignBadgeAction, revokeBadgeAssignmentAction } from "@/lib/actions/badges";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { MemberPicker, type PickerMember } from "./member-picker";
import { useFormAction } from "./use-form-action";
import { useFormatter, useT } from "@/i18n/client";

export interface AssignmentRowData {
  id: string;
  issuedOn: string;
  badge: { id: string; title: string; imageUrl: string } | null;
  member: { id: string; name: string; username: string; avatarUrl?: string } | null;
}

export interface AssignableBadge {
  id: string;
  title: string;
  enabled: boolean;
  grantOnlyOnce: boolean;
}

export function BadgeAssignments({
  assignments,
  members,
  badges,
  today,
}: {
  assignments: AssignmentRowData[];
  members: PickerMember[];
  badges: AssignableBadge[];
  today: string;
}) {
  const t = useT("admin");
  const f = useFormatter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [toRevoke, setToRevoke] = useState<AssignmentRowData | null>(null);
  const [revoking, startRevoke] = useTransition();
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, errors } = useFormAction(assignBadgeAction, { onSuccess: () => setFormKey((k) => k + 1) });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) => `${a.member?.name ?? ""} ${a.member?.username ?? ""} ${a.badge?.title ?? ""}`.toLowerCase().includes(q));
  }, [assignments, search]);

  const confirmRevoke = () => {
    const target = toRevoke;
    if (!target) return;
    startRevoke(async () => {
      const res = await revokeBadgeAssignmentAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? t("badges.assign.revoked"));
        setToRevoke(null);
      } else toast.error(res.error);
    });
  };

  return (
    <div className="space-y-5">
      <form key={formKey} onSubmit={onSubmit} noValidate className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-ink">{t("badges.assign.title")}</h3>
          <p className="text-sm text-ink-muted">{t("badges.assign.description")}</p>
        </div>
        {badges.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("badges.assign.noBadges")}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_10rem_auto] md:items-start">
            <Field label={t("badges.assign.member")} htmlFor="assign-member" error={errors.userId} hint={errors.userId ? undefined : t("badges.assign.memberHint")} required>
              <MemberPicker id="assign-member" name="userId" members={members} invalid={!!errors.userId} />
            </Field>
            <Field label={t("badges.assign.badge")} htmlFor="assign-badge" error={errors.badgeId} hint={errors.badgeId ? undefined : t("badges.assign.badgeHint")} required>
              <Select
                id="assign-badge"
                name="badgeId"
                defaultValue=""
                placeholder={t("badges.assign.badgePlaceholder")}
                required
                invalid={!!errors.badgeId}
                options={badges.map((b) => ({ value: b.id, label: b.enabled ? b.title : t("badges.assign.disabledOption", { title: b.title }) }))}
              />
            </Field>
            <Field label={t("badges.assign.issuedOn")} htmlFor="assign-issued" error={errors.issuedOn} required>
              <Input id="assign-issued" name="issuedOn" type="date" defaultValue={today} max={today} invalid={!!errors.issuedOn} />
            </Field>
            <div className="md:pt-6">
              <Button type="submit" loading={pending} leftIcon={<Icon.Award className="size-4" />} className="w-full md:w-auto">
                {t("badges.assign.submit")}
              </Button>
            </div>
          </div>
        )}
      </form>

      {assignments.length === 0 ? (
        <EmptyState icon={<Icon.Award />} title={t("badges.assign.emptyTitle")} description={t("badges.assign.emptyDescription")} />
      ) : (
        <>
          <div className="w-full sm:max-w-xs">
            <Input
              type="search"
              aria-label={t("badges.assign.searchLabel")}
              placeholder={t("shared.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftAddon={<Icon.Search className="size-4" />}
            />
          </div>
          <Table>
            <THead>
              <tr>
                <TH>{t("badges.assign.member")}</TH>
                <TH>{t("badges.assign.badge")}</TH>
                <TH className="hidden sm:table-cell">{t("badges.assign.issuedOn")}</TH>
                <TH className="w-16 text-end">
                  <span className="sr-only">{t("shared.actions")}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {filtered.length === 0 ? (
                <TableEmpty colSpan={4}>{t("badges.assign.noMatch", { query: search })}</TableEmpty>
              ) : (
                filtered.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      {a.member ? (
                        <Link href={`/user/${a.member.username}`} className="flex items-center gap-2.5 hover:underline">
                          <Avatar name={a.member.name} src={a.member.avatarUrl} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{a.member.name}</span>
                            <span className="block truncate text-xs text-ink-muted">@{a.member.username}</span>
                          </span>
                        </Link>
                      ) : (
                        <span className="text-ink-faint">{t("shared.deletedMember")}</span>
                      )}
                    </TD>
                    <TD>
                      {a.badge ? (
                        <span className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.badge.imageUrl} alt="" className="size-7 shrink-0 rounded-md bg-surface-2 object-contain p-0.5" />
                          <span className="truncate">{a.badge.title}</span>
                        </span>
                      ) : (
                        <span className="text-ink-faint">{t("badges.assign.deletedBadge")}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-ink-muted sm:hidden">{f.date(a.issuedOn)}</span>
                    </TD>
                    <TD className="hidden text-ink-muted sm:table-cell">{f.date(a.issuedOn)}</TD>
                    <TD className="text-end">
                      <IconButton label={t("badges.assign.revoke")} size="icon-sm" className="hover:text-danger" onClick={() => setToRevoke(a)}>
                        <Icon.Trash className="size-4" />
                      </IconButton>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}

      <ConfirmDialog
        open={!!toRevoke}
        onClose={() => (revoking ? undefined : setToRevoke(null))}
        onConfirm={confirmRevoke}
        loading={revoking}
        destructive
        title={t("badges.assign.revokeTitle")}
        description={toRevoke ? t("badges.assign.revokeDescription", { name: toRevoke.member?.name ?? t("badges.assign.theMember"), badge: toRevoke.badge?.title ?? t("badges.assign.thisBadge") }) : undefined}
        confirmLabel={t("badges.assign.revokeConfirm")}
      />
    </div>
  );
}

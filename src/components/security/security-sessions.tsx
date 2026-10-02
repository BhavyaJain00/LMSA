"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutOtherSessionsAction, revokeSessionAction } from "@/lib/actions/profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

export interface SecuritySessionRow {
  id: string;
  device: string;
  kind: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  signedInLabel: string;
  signedInTitle: string;
  expiresLabel: string;
  current: boolean;
}

/** Signed-in devices with per-device sign out and "sign out other devices". */
export function SecuritySessions({ sessions }: { sessions: SecuritySessionRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const t = useT("account");
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<SecuritySessionRow | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const others = sessions.filter((s) => !s.current).length;

  const revoke = (row: SecuritySessionRow) =>
    startTransition(async () => {
      const result = await revokeSessionAction(row.id);
      setTarget(null);
      if (result.ok) toast.success(result.message ?? t("security.devices.signedOut"));
      else toast.error(result.error);
      router.refresh();
    });

  const revokeOthers = () =>
    startTransition(async () => {
      const result = await logoutOtherSessionsAction();
      setConfirmOthers(false);
      if (result.ok) toast.success(result.message ?? t("security.devices.othersSignedOut"));
      else toast.error(result.error);
      router.refresh();
    });

  return (
    <div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
              {s.kind === "mobile" || s.kind === "tablet" ? <Icon.Smartphone className="size-4.5" /> : <Icon.Monitor className="size-4.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                <span className="truncate">{s.device}</span>
                {s.current && (
                  <Badge tone="success" size="xs" dot>
                    {t("security.devices.thisDevice")}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-ink-muted">
                <span title={s.signedInTitle}>{t("security.devices.signedIn", { when: s.signedInLabel })}</span> · {t("security.devices.expires", { date: s.expiresLabel })}
              </p>
            </div>
            {!s.current && (
              <Button variant="ghost" size="xs" onClick={() => setTarget(s)} disabled={pending} aria-label={t("security.devices.signOutLabel", { device: s.device })}>
                {t("security.devices.signOut")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button variant="outline" size="sm" disabled={others === 0 || pending} onClick={() => setConfirmOthers(true)} leftIcon={<Icon.LogOut className="size-4" />}>
          {t("security.devices.signOutOthers")}
        </Button>
      </div>

      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          if (target) revoke(target);
        }}
        loading={pending}
        title={t("security.devices.confirmTitle")}
        description={target ? t("security.devices.confirmBody", { device: target.device, when: target.signedInLabel }) : undefined}
        confirmLabel={t("security.devices.signOut")}
      />
      <ConfirmDialog
        open={confirmOthers}
        onClose={() => setConfirmOthers(false)}
        onConfirm={revokeOthers}
        loading={pending}
        title={t("security.devices.othersTitle")}
        description={t("security.devices.othersBody", { count: others })}
        confirmLabel={t("security.devices.othersConfirm")}
      />
    </div>
  );
}

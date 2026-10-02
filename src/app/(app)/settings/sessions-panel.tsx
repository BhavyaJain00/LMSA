"use client";

import { useState, useTransition } from "react";
import { logoutEverywhereAction, logoutOtherSessionsAction, revokeSessionAction } from "@/lib/actions/profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

export interface SessionRow {
  id: string;
  device: string;
  kind: "desktop" | "mobile";
  createdLabel: string;
  expiresLabel: string;
  current: boolean;
}

/** Active sessions with per-device log out, "Log out other sessions" and "Log out everywhere". */
export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const toast = useToast();
  const t = useT("account");
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"others" | "everywhere" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const revoking = sessions.find((x) => x.id === revokeId);
  const others = sessions.filter((s) => !s.current).length;

  const revoke = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res = await revokeSessionAction(id);
      setBusyId(null);
      setRevokeId(null);
      if (res.ok) toast.success(res.message ?? t("settings.sessions.loggedOut"));
      else toast.error(res.error);
    });
  };

  const logoutOthers = () => {
    startTransition(async () => {
      const res = await logoutOtherSessionsAction();
      setConfirm(null);
      if (res.ok) toast.success(res.message ?? t("settings.sessions.othersLoggedOut"));
      else toast.error(res.error);
    });
  };

  const logoutEverywhere = () => {
    startTransition(async () => {
      await logoutEverywhereAction();
    });
  };

  return (
    <div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
              {s.kind === "mobile" ? <Icon.Smartphone className="size-4.5" /> : <Icon.Monitor className="size-4.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                <span className="truncate">{s.device}</span>
                {s.current && (
                  <Badge tone="success" size="xs" dot>
                    {t("settings.sessions.thisDevice")}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-ink-muted">
                {t("settings.sessions.signedIn", { when: s.createdLabel, date: s.expiresLabel })}
              </p>
            </div>
            {!s.current && (
              <Button variant="ghost" size="xs" onClick={() => setRevokeId(s.id)} loading={busyId === s.id} disabled={pending && busyId !== s.id}>
                {t("settings.sessions.logOut")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={others === 0 || pending} onClick={() => setConfirm("others")}>
          {t("settings.sessions.logOutOthers")}
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirm("everywhere")} leftIcon={<Icon.LogOut className="size-4" />}>
          {t("settings.sessions.logOutEverywhere")}
        </Button>
      </div>

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={() => revoking && revoke(revoking.id)}
        loading={pending}
        title={t("settings.sessions.revokeTitle")}
        description={revoking ? t("settings.sessions.revokeBody", { device: revoking.device, when: revoking.createdLabel }) : undefined}
        confirmLabel={t("settings.sessions.revokeConfirm")}
      />
      <ConfirmDialog
        open={confirm === "others"}
        onClose={() => setConfirm(null)}
        onConfirm={logoutOthers}
        loading={pending}
        title={t("settings.sessions.othersTitle")}
        description={t("settings.sessions.othersBody", { count: others })}
        confirmLabel={t("settings.sessions.othersConfirm")}
      />
      <ConfirmDialog
        open={confirm === "everywhere"}
        onClose={() => setConfirm(null)}
        onConfirm={logoutEverywhere}
        loading={pending}
        destructive
        title={t("settings.sessions.everywhereTitle")}
        description={t("settings.sessions.everywhereBody")}
        confirmLabel={t("settings.sessions.logOutEverywhere")}
      />
    </div>
  );
}

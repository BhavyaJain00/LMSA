"use client";

import { useState, useTransition } from "react";
import { logoutEverywhereAction, logoutOtherSessionsAction, revokeSessionAction } from "@/lib/actions/profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

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
      if (res.ok) toast.success(res.message ?? "Session logged out.");
      else toast.error(res.error);
    });
  };

  const logoutOthers = () => {
    startTransition(async () => {
      const res = await logoutOtherSessionsAction();
      setConfirm(null);
      if (res.ok) toast.success(res.message ?? "Other sessions logged out.");
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
                    This device
                  </Badge>
                )}
              </p>
              <p className="text-xs text-ink-muted">
                Signed in {s.createdLabel} · expires {s.expiresLabel}
              </p>
            </div>
            {!s.current && (
              <Button variant="ghost" size="xs" onClick={() => setRevokeId(s.id)} loading={busyId === s.id} disabled={pending && busyId !== s.id}>
                Log out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={others === 0 || pending} onClick={() => setConfirm("others")}>
          Log out other sessions
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirm("everywhere")} leftIcon={<Icon.LogOut className="size-4" />}>
          Log out everywhere
        </Button>
      </div>

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevokeId(null)}
        onConfirm={() => revoking && revoke(revoking.id)}
        loading={pending}
        title="Log out this session?"
        description={revoking ? `${revoking.device} (signed in ${revoking.createdLabel}) will need to log in again.` : undefined}
        confirmLabel="Log out session"
      />
      <ConfirmDialog
        open={confirm === "others"}
        onClose={() => setConfirm(null)}
        onConfirm={logoutOthers}
        loading={pending}
        title="Log out other sessions?"
        description={`This signs you out on ${others} other ${others === 1 ? "device" : "devices"}. You stay logged in here.`}
        confirmLabel="Log out others"
      />
      <ConfirmDialog
        open={confirm === "everywhere"}
        onClose={() => setConfirm(null)}
        onConfirm={logoutEverywhere}
        loading={pending}
        destructive
        title="Log out everywhere?"
        description="This signs you out on every device, including this one. You'll need to log in again."
        confirmLabel="Log out everywhere"
      />
    </div>
  );
}

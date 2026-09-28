"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/types";
import { setUserRoleAction } from "@/lib/actions/profile";
import { Switch } from "@/components/ui/input";
import { Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface RoleOption {
  role: Role;
  label: string;
  description: string;
  /** Disabled with an explanation (e.g. only admins can grant Admin). */
  lockedReason?: string;
}

/**
 * Role switches (moderators only). Each toggle saves immediately; the UI
 * updates optimistically and rolls back if the server refuses.
 */
export function RolesForm({ userId, initialRoles, options }: { userId: string; initialRoles: Role[]; options: RoleOption[] }) {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [busy, setBusy] = useState<Role | null>(null);
  const [, startTransition] = useTransition();
  const toast = useToast();

  const toggle = (role: Role, enabled: boolean) => {
    const previous = roles;
    setRoles(enabled ? [...roles, role] : roles.filter((r) => r !== role));
    setBusy(role);
    startTransition(async () => {
      const res = await setUserRoleAction(userId, role, enabled);
      setBusy(null);
      if (res.ok) {
        setRoles(res.data.roles);
        toast.success(res.message ?? "Role updated successfully");
      } else {
        setRoles(previous);
        toast.error(res.error);
      }
    });
  };

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {options.map((o) => {
        const checked = roles.includes(o.role);
        const id = `role-${o.role}`;
        return (
          <li key={o.role} className={cn("rounded-xl border border-border bg-surface-1 p-4", checked && "border-accent/40 bg-accent/5")}>
            <div className="flex items-start gap-3">
              <Switch
                id={id}
                name={o.role}
                checked={checked}
                disabled={!!o.lockedReason || busy !== null}
                onChange={(e) => toggle(o.role, e.target.checked)}
                label={o.label}
                description={o.description}
                className="flex-1"
              />
              {busy === o.role && <Spinner className="mt-0.5 size-4 text-ink-muted" />}
            </div>
            {o.lockedReason && <p className="mt-2 text-xs text-ink-faint">{o.lockedReason}</p>}
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import type { Role } from "@/lib/types";
import { Switch } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ROLE_OPTIONS } from "./roles";

/**
 * Grid of role switches (Frappe's RoleSwitches). Each checked switch submits
 * `roles=<role>` with the surrounding form.
 */
export function RoleSwitches({
  defaultRoles,
  canGrantAdmin,
  disabled,
  lockedRoles = [],
  idPrefix = "role",
  className,
}: {
  defaultRoles: Role[];
  canGrantAdmin: boolean;
  disabled?: boolean;
  /** Roles shown checked and not toggleable (e.g. your own admin role). */
  lockedRoles?: Role[];
  idPrefix?: string;
  className?: string;
}) {
  const options = ROLE_OPTIONS.filter((r) => !r.adminOnly || canGrantAdmin || defaultRoles.includes(r.value));
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {options.map((r) => {
        const locked = lockedRoles.includes(r.value) || (r.adminOnly && !canGrantAdmin);
        return (
          <div key={r.value} className="rounded-xl border border-border p-3">
            {locked && defaultRoles.includes(r.value) && <input type="hidden" name="roles" value={r.value} />}
            <Switch
              id={`${idPrefix}-${r.value}`}
              name={locked ? undefined : "roles"}
              value={r.value}
              defaultChecked={defaultRoles.includes(r.value)}
              disabled={disabled || locked}
              label={r.label}
              description={r.description}
            />
          </div>
        );
      })}
    </div>
  );
}

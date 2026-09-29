"use client";

import { useState } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

/** Password input with a show/hide toggle and a lock icon. */
export function PasswordField({ showIcon = true, ...props }: Omit<InputProps, "type" | "leftAddon" | "rightAddon"> & { showIcon?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      leftAddon={showIcon ? <Icon.Lock className="size-4" /> : undefined}
      rightAddon={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="pointer-events-auto rounded text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {visible ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
        </button>
      }
    />
  );
}

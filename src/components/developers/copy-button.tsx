"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/**
 * Copies `value` to the clipboard and confirms it for two seconds.
 * `iconOnly` renders a compact icon button (code blocks); `label` is then
 * its accessible name.
 */
export function CopyButton({
  value,
  label,
  iconOnly,
  variant = "outline",
  size = "sm",
  className,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const toast = useToast();
  const t = useT("admin");
  const tc = useT("common");
  const name = label ?? tc("actions.copy");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("global.copyButton.blocked"));
    }
  };
  const icon = copied ? <Icon.Check className="size-4" /> : <Icon.Copy className="size-4" />;

  if (iconOnly) {
    return (
      <IconButton label={copied ? tc("actions.copied") : name} size="icon-sm" onClick={copy} className={className}>
        {icon}
      </IconButton>
    );
  }
  return (
    <Button variant={variant} size={size} leftIcon={icon} onClick={copy} className={className}>
      <span aria-live="polite">{copied ? tc("actions.copied") : name}</span>
    </Button>
  );
}

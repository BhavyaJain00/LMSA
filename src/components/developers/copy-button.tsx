"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/**
 * Copies `value` to the clipboard and confirms it for two seconds.
 * `iconOnly` renders a compact icon button (code blocks); `label` is then
 * its accessible name.
 */
export function CopyButton({
  value,
  label = "Copy",
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
      toast.error("Copying isn't allowed in this browser. Select the text and copy it instead.");
    }
  };
  const icon = copied ? <Icon.Check className="size-4" /> : <Icon.Copy className="size-4" />;

  if (iconOnly) {
    return (
      <IconButton label={copied ? "Copied" : label} size="icon-sm" onClick={copy} className={className}>
        {icon}
      </IconButton>
    );
  }
  return (
    <Button variant={variant} size={size} leftIcon={icon} onClick={copy} className={className}>
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

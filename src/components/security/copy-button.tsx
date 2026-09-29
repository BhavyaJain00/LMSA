"use client";

import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Copies `value` to the clipboard and briefly confirms. */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", ...props }: { value: string; label?: string; copiedLabel?: string } & Omit<ButtonProps, "onClick" | "children">) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  };

  return (
    <Button variant="outline" size="sm" leftIcon={copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Copy className="size-4" />} onClick={() => void copy()} {...props}>
      <span aria-live="polite">{copied ? copiedLabel : failed ? "Copy failed — select and copy manually" : label}</span>
    </Button>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** "Print / Save as PDF" and "Share" (copy link, native share sheet when available). */
export function CertificateActions({ url, title, className }: { url: string; title: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied", description: "Anyone with the link can verify this certificate.", tone: "success" });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Couldn't copy the link", description: url, tone: "error" });
    }
  };

  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    await copy();
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()} leftIcon={<Icon.Download className="size-4" />}>
          Print / Save as PDF
        </Button>
        <Button variant="outline" onClick={() => void share()} leftIcon={copied ? <Icon.Check className="size-4 text-success" /> : <Icon.Link className="size-4" />}>
          {copied ? "Copied" : "Share"}
        </Button>
      </div>
    </div>
  );
}

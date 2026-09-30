"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { shareUrl, type ShareTargetGroup } from "@/lib/growth/affiliates-shared";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

const CUSTOM = "__custom__";

const subscribeNever = () => () => {};

/**
 * Build a referral link for any page: pick a course, bundle or page (or
 * paste a link from this site), then copy or share it.
 */
export function ShareLinkBuilder({ origin, code, groups }: { origin: string; code: string; groups: ShareTargetGroup[] }) {
  const toast = useToast();
  const id = useId();
  const [target, setTarget] = useState(groups[0]?.items[0]?.path ?? "/");
  const [custom, setCustom] = useState("");

  const customPath = useMemo(() => {
    if (target !== CUSTOM) return null;
    const raw = custom.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw, origin);
      if (url.origin !== new URL(origin).origin) return null;
      url.searchParams.delete("ref");
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }, [target, custom, origin]);

  const link = target === CUSTOM ? (customPath ? shareUrl(origin, customPath, code) : "") : shareUrl(origin, target, code);
  const customInvalid = target === CUSTOM && custom.trim() !== "" && !customPath;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied", "Share it anywhere: purchases through it earn you a commission.");
    } catch {
      toast.error("Couldn't copy the link", "Select the link and copy it manually.");
    }
  }

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ url: link });
    } catch {
      // The visitor closed the share sheet.
    }
  }

  // The Web Share API only exists in the browser (and not in every browser).
  const canShare = useSyncExternalStore(subscribeNever, () => typeof navigator.share === "function", () => false);

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-target`} className="mb-1.5 block text-sm font-medium text-ink">
          Page to share
        </label>
        <Select id={`${id}-target`} value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM}>Another page on this site…</option>
        </Select>
      </div>
      {target === CUSTOM && (
        <div>
          <label htmlFor={`${id}-custom`} className="mb-1.5 block text-sm font-medium text-ink">
            Page link
          </label>
          <Input
            id={`${id}-custom`}
            value={custom}
            onChange={(e) => setCustom(e.currentTarget.value)}
            placeholder={`${origin}/courses/…`}
            invalid={customInvalid}
            aria-describedby={`${id}-custom-hint`}
            inputMode="url"
          />
          <p id={`${id}-custom-hint`} className={customInvalid ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-muted"}>
            {customInvalid ? `Paste a link that starts with ${origin}.` : "Paste the address of any page on this site."}
          </p>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-link`} className="mb-1.5 block text-sm font-medium text-ink">
          Your referral link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`${id}-link`} value={link} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" placeholder="Choose a page above" />
          <div className="flex gap-2">
            <Button type="button" onClick={copy} disabled={!link} leftIcon={<Icon.Copy className="size-4" />} className="flex-1 sm:flex-none">
              Copy
            </Button>
            {canShare && (
              <Button type="button" variant="outline" onClick={share} disabled={!link} leftIcon={<Icon.Send className="size-4" />} className="flex-1 sm:flex-none">
                Share
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

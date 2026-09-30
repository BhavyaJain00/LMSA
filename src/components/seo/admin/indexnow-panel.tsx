"use client";

import { useState, useTransition } from "react";
import { saveIndexNowKeyAction, submitSitemapToIndexNowAction, syncContentNowAction } from "@/lib/actions/seo-settings";
import { SettingsRow, SettingsSection } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface IndexNowPanelProps {
  /** The configured key, or "" when none has been generated yet. */
  indexNowKey: string;
  keyFileUrl: string;
  /** False while the site is hidden from search engines or runs on a local address. */
  active: boolean;
  lastSubmission: { ok: boolean; text: string; when: string } | null;
}

/**
 * IndexNow controls: the key (generated on first use, replaceable), a manual
 * "send everything" for launches and migrations, and an immediate check for
 * renamed or newly published pages.
 */
export function IndexNowPanel({ indexNowKey, keyFileUrl, active, lastSubmission }: IndexNowPanelProps) {
  const toast = useToast();
  const [typedKey, setTypedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"submit" | "sync" | null>(null);
  const [, startTransition] = useTransition();
  const keyForm = useFormAction(saveIndexNowKeyAction, { onSuccess: () => setTypedKey("") });

  const run = (kind: "submit" | "sync") => {
    setBusy(kind);
    startTransition(async () => {
      const result = kind === "submit" ? await submitSitemapToIndexNowAction() : await syncContentNowAction();
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
      setBusy(null);
    });
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(indexNowKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copying is blocked by the browser. Select the key and copy it by hand.");
    }
  };

  return (
    <SettingsSection
      title="Instant indexing (IndexNow)"
      description="Bing, Yandex, Seznam, Naver and other engines are told the moment a course, batch or article is published, updated, renamed or removed. Google does not take part; it reads the sitemap."
    >
      <SettingsRow
        label="Status"
        description="Submissions happen on their own after content changes. The last one made by this server is shown here."
        stacked
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 font-medium", active ? "text-success" : "text-ink-muted")}>
            {active ? <Icon.CheckCircle className="size-4" aria-hidden="true" /> : <Icon.Pause className="size-4" aria-hidden="true" />}
            {active ? "Active" : "Paused"}
          </span>
          {lastSubmission ? (
            <span className={lastSubmission.ok ? "text-ink-muted" : "text-danger"}>
              {lastSubmission.text} · {lastSubmission.when}
            </span>
          ) : (
            <span className="text-ink-muted">No submission since the server started.</span>
          )}
        </p>
      </SettingsRow>

      <SettingsRow
        label="Key"
        description="Proves that submissions come from this site. One is generated automatically the first time something is published."
        stacked
      >
        {indexNowKey ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink">{indexNowKey}</code>
            <Button type="button" size="sm" variant="outline" onClick={copyKey} leftIcon={copied ? <Icon.Check className="size-3.5" /> : <Icon.Copy className="size-3.5" />}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <a href={keyFileUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Key file
              <Icon.ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No key yet.</p>
        )}
        <form onSubmit={keyForm.onSubmit} noValidate className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <label htmlFor="indexNowKey" className="sr-only">
              Existing IndexNow key (optional)
            </label>
            <Input
              id="indexNowKey"
              name="indexNowKey"
              value={typedKey}
              onChange={(e) => setTypedKey(e.target.value.trim())}
              placeholder="Paste an existing key, or leave empty for a new one"
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              className="font-mono"
              invalid={!!keyForm.errors.indexNowKey}
              aria-describedby={keyForm.errors.indexNowKey ? "indexNowKey-error" : undefined}
            />
            {keyForm.errors.indexNowKey && (
              <p id="indexNowKey-error" className="mt-1 text-xs text-danger" role="alert">
                {keyForm.errors.indexNowKey}
              </p>
            )}
          </div>
          <Button type="submit" variant="outline" loading={keyForm.pending} className="shrink-0">
            {typedKey ? "Use this key" : indexNowKey ? "Generate a new key" : "Generate key"}
          </Button>
        </form>
      </SettingsRow>

      <SettingsRow
        label="Send all pages"
        description="Submits every address of the sitemap. Useful after launch, a domain change or a large import; day-to-day changes are sent automatically."
      >
        <Button type="button" onClick={() => run("submit")} loading={busy === "submit"} disabled={!active || busy !== null} leftIcon={<Icon.Send className="size-4" />} className="w-full sm:w-auto">
          Send all pages
        </Button>
        {!active && <p className="mt-1.5 text-xs text-ink-muted">Available once the site is public.</p>}
      </SettingsRow>

      <SettingsRow
        label="Check for changes now"
        description="Looks for renamed and newly published pages right away: renamed pages get a permanent redirect, new and updated ones are submitted."
      >
        <Button type="button" variant="outline" onClick={() => run("sync")} loading={busy === "sync"} disabled={busy !== null} leftIcon={<Icon.Refresh className="size-4" />} className="w-full sm:w-auto">
          Check now
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

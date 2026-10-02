"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { CopyButton } from "./copy-button";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/catalog";
import type { Translator } from "@/i18n/translate";

function codesFileText(codes: string[], brand: string, email: string, t: Translator<MessageKey<"account">>, tag: string): string {
  const generated = new Date().toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
  return [
    t("security.codes.fileTitle", { brand }),
    t("security.codes.fileAccount", { email }),
    t("security.codes.fileGenerated", { date: generated }),
    "",
    t("security.codes.fileUse"),
    t("security.codes.fileKeep"),
    "",
    ...codes,
    "",
  ].join("\r\n");
}

/**
 * Shows freshly generated recovery codes exactly once, with copy and .txt
 * download. `onDone` runs when the dialog is dismissed (the caller refreshes
 * the page so the codes disappear from memory).
 */
export function RecoveryCodesDialog({
  codes,
  brand,
  email,
  title,
  onDone,
}: {
  codes: string[] | null;
  brand: string;
  email: string;
  title?: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const t = useT("account");
  const tag = intlLocale(useLocale());
  const checkboxId = useId();
  const open = !!codes && codes.length > 0;
  const text = codes ? codesFileText(codes, brand, email, t, tag) : "";

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      brand
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "account"
    }-recovery-codes.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };

  const close = () => {
    setSaved(false);
    onDone();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title ?? t("security.codes.title")}
      description={t("security.codes.description")}
      footer={
        <Button onClick={close} disabled={!saved} leftIcon={<Icon.Check className="size-4" />}>
          {t("security.codes.done")}
        </Button>
      }
    >
      {codes && (
        <div className="space-y-4">
          <ol className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm sm:text-base" aria-label={t("security.codes.listLabel")} dir="ltr">
            {codes.map((code) => (
              <li key={code} className="rounded-md bg-surface-1 px-2 py-1.5 text-center tracking-wider text-ink select-all">
                {code}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" leftIcon={<Icon.Download className="size-4" />} onClick={download}>
              {t("security.codes.download")}
            </Button>
            <CopyButton value={codes.join("\n")} label={t("security.codes.copyAll")} />
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
            <p className="flex items-start gap-2">
              <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              {t("security.codes.warning")}
            </p>
          </div>
          <Checkbox id={checkboxId} checked={saved} onChange={(e) => setSaved(e.target.checked)} label={t("security.codes.saved")} />
        </div>
      )}
    </Dialog>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateCoverImageAction } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/**
 * "Edit cover" control on the profile cover. Opens a small popover to upload
 * a JPG/PNG image or remove the current cover (falls back to the gradient).
 */
export function CoverEditor({ userId, hasCover, className }: { userId: string; hasCover: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const t = useT("account");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = (url: string) => {
    startTransition(async () => {
      const res = await updateCoverImageAction(userId, url);
      if (res.ok) {
        toast.success(res.message ?? t("profile.cover.updated"));
        setOpen(false);
        setConfirmRemove(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        leftIcon={<Icon.Camera className="size-4" />}
        className="bg-surface-1/90 backdrop-blur"
      >
        {t("profile.cover.edit")}
      </Button>
      {open && (
        <div role="dialog" aria-label={t("profile.cover.change")} className="absolute end-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface-1 p-3 shadow-pop animate-scale-in">
          <p className="mb-2 text-sm font-medium text-ink">{t("profile.cover.title")}</p>
          <FileUpload
            kind="image"
            accept="image/png,image/jpeg"
            preview={false}
            hint={t("profile.cover.hint")}
            disabled={pending}
            onChange={(url) => {
              if (url) save(url);
            }}
          />
          {hasCover && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-danger hover:bg-danger/10"
              onClick={() => setConfirmRemove(true)}
              loading={pending}
              leftIcon={<Icon.Trash className="size-4" />}
            >
              {t("profile.cover.remove")}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => save("")}
        loading={pending}
        destructive
        title={t("profile.cover.removeTitle")}
        description={t("profile.cover.removeBody")}
        confirmLabel={t("profile.cover.removeConfirm")}
      />
    </div>
  );
}

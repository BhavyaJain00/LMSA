"use client";

import { useState } from "react";
import { createLegalPageAction } from "@/lib/legal/actions";
import { LEGAL_SLUG_MAX, LEGAL_TITLE_MAX } from "@/lib/legal/pages-shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { slugify } from "@/lib/utils";

/** "New page" button + dialog for custom legal pages (imprint, acceptable use, accessibility…). */
export function NewLegalPageDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const { onSubmit, pending, errors, formError } = useFormAction(createLegalPageAction, { toastSuccess: false, toastError: false });

  const close = () => {
    if (pending) return;
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setOpen(true)}>
        New page
      </Button>
      <Dialog open={open} onClose={close} title="New legal page" description="For example an imprint, acceptable use policy or accessibility statement.">
        <form id="new-legal-page" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={formError && !Object.keys(errors).length ? formError : null} />
          <Field label="Title" htmlFor="legal-title" required error={errors.title}>
            <Input
              id="legal-title"
              name="title"
              value={title}
              maxLength={LEGAL_TITLE_MAX}
              placeholder="Acceptable Use Policy"
              invalid={!!errors.title}
              autoFocus
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value).slice(0, LEGAL_SLUG_MAX));
              }}
            />
          </Field>
          <Field label="Address" htmlFor="legal-slug" required error={errors.slug} hint="Lower-case letters, numbers and hyphens.">
            <Input
              id="legal-slug"
              name="slug"
              value={slug}
              maxLength={LEGAL_SLUG_MAX}
              placeholder="acceptable-use"
              leftAddon={<span className="text-xs text-ink-muted">/legal/</span>}
              invalid={!!errors.slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </Field>
        </form>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="new-legal-page" loading={pending}>
            Create page
          </Button>
        </div>
      </Dialog>
    </>
  );
}

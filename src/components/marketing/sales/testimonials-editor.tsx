"use client";

import { useId } from "react";
import type { SalesTestimonial } from "@/lib/types";
import { SALES_LIMITS, moveItem } from "@/lib/seo/sales-page";
import { Button, IconButton } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import { Icon } from "@/components/ui/icons";
import { Input, Select, Textarea } from "@/components/ui/input";

/**
 * Learner quotes of a sales page: add, edit, reorder and remove. Each quote
 * has a name, an optional role ("Data analyst at Acme"), an optional photo
 * and an optional 1–5 star rating. The parent owns the list.
 */
export function TestimonialsEditor({ items, onChange, error }: { items: SalesTestimonial[]; onChange: (items: SalesTestimonial[]) => void; error?: string }) {
  const id = useId();
  const update = (index: number, patch: Partial<SalesTestimonial>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-ink-muted">Quotes from real learners are the strongest proof a course works. Ask for permission before you publish one.</p>}
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface-2/40 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-xs font-semibold tabular-nums text-ink-muted" aria-hidden="true">
                {i + 1}.
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`${id}-name-${i}`} className="sr-only">
                      Name of learner {i + 1}
                    </label>
                    <Input id={`${id}-name-${i}`} value={item.name} maxLength={80} placeholder="Name" onChange={(e) => update(i, { name: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`${id}-role-${i}`} className="sr-only">
                      Role of learner {i + 1}
                    </label>
                    <Input id={`${id}-role-${i}`} value={item.role ?? ""} maxLength={100} placeholder="Role (optional), e.g. Data analyst" onChange={(e) => update(i, { role: e.target.value })} />
                  </div>
                </div>
                <label htmlFor={`${id}-quote-${i}`} className="sr-only">
                  Quote {i + 1}
                </label>
                <Textarea id={`${id}-quote-${i}`} value={item.quote} rows={3} maxLength={SALES_LIMITS.quote} placeholder="What they said about the course" onChange={(e) => update(i, { quote: e.target.value })} />
                <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start">
                  <div>
                    <label htmlFor={`${id}-rating-${i}`} className="sr-only">
                      Rating given by learner {i + 1}
                    </label>
                    <Select id={`${id}-rating-${i}`} value={item.rating ? String(item.rating) : ""} onChange={(e) => update(i, { rating: e.target.value ? Number(e.target.value) : undefined })}>
                      <option value="">No rating</option>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? "star" : "stars"}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <FileUpload kind="image" label={`Photo of learner ${i + 1}`} value={item.avatarUrl ?? ""} onChange={(url) => update(i, { avatarUrl: url || undefined })} hint="Optional square photo." />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <IconButton label={`Move quote ${i + 1} up`} size="icon-sm" disabled={i === 0} onClick={() => onChange(moveItem(items, i, -1))}>
                  <Icon.ChevronUp className="size-4" />
                </IconButton>
                <IconButton label={`Move quote ${i + 1} down`} size="icon-sm" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, 1))}>
                  <Icon.ChevronDown className="size-4" />
                </IconButton>
                <IconButton label={`Remove quote ${i + 1}`} size="icon-sm" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Icon.Trash className="size-4 text-danger" />
                </IconButton>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={items.length >= SALES_LIMITS.testimonials}
        onClick={() => onChange([...items, { name: "", quote: "" }])}
        leftIcon={<Icon.Plus className="size-4" />}
      >
        Add a testimonial
      </Button>
    </div>
  );
}

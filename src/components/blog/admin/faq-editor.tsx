"use client";

import { useId } from "react";
import type { FaqItem } from "@/lib/types";
import { POST_LIMITS } from "@/lib/seo/blog";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/input";
import { useT } from "@/i18n/client";

/**
 * Question/answer list of an article: add, edit, reorder and remove. The
 * parent owns the list and sends it as JSON. The questions are shown under
 * the article and marked up as FAQPage structured data.
 */
export function FaqEditor({ items, onChange, error }: { items: FaqItem[]; onChange: (items: FaqItem[]) => void; error?: string }) {
  // `global.` keys: the editor is also used in the course sales page builder (admin).
  const t = useT("public");
  const id = useId();
  const update = (index: number, patch: Partial<FaqItem>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-ink-muted">{t("global.faqEditor.empty")}</p>}
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface-2/40 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-xs font-semibold tabular-nums text-ink-muted" aria-hidden="true">
                {i + 1}.
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <label htmlFor={`${id}-q-${i}`} className="sr-only">
                  {t("global.faqEditor.questionLabel", { n: i + 1 })}
                </label>
                <Input id={`${id}-q-${i}`} value={item.question} maxLength={POST_LIMITS.faqQuestion} placeholder={t("global.faqEditor.questionPlaceholder")} onChange={(e) => update(i, { question: e.target.value })} />
                <label htmlFor={`${id}-a-${i}`} className="sr-only">
                  {t("global.faqEditor.answerLabel", { n: i + 1 })}
                </label>
                <Textarea id={`${id}-a-${i}`} value={item.answer} rows={3} maxLength={POST_LIMITS.faqAnswer} placeholder={t("global.faqEditor.answerPlaceholder")} onChange={(e) => update(i, { answer: e.target.value })} />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <IconButton label={t("global.faqEditor.moveUp", { n: i + 1 })} size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon.ChevronUp className="size-4" />
                </IconButton>
                <IconButton label={t("global.faqEditor.moveDown", { n: i + 1 })} size="icon-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <Icon.ChevronDown className="size-4" />
                </IconButton>
                <IconButton label={t("global.faqEditor.remove", { n: i + 1 })} size="icon-sm" className="hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Icon.Trash className="size-4" />
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
        type="button"
        size="sm"
        variant="outline"
        disabled={items.length >= POST_LIMITS.faq}
        onClick={() => onChange([...items, { question: "", answer: "" }])}
        leftIcon={<Icon.Plus className="size-3.5" />}
      >
        {t("global.faqEditor.add")}
      </Button>
    </div>
  );
}

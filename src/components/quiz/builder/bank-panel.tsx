"use client";

import { useEffect, useRef, useState } from "react";
import { searchQuestionBankAction } from "@/lib/actions/questions";
import { Button, IconButton } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, stripMarkdown, truncate } from "@/lib/utils";
import { MarksBadge, QuestionTypeBadge } from "../shared";
import { toUiType, uiTypeLabels, type QuestionBankItem, type UiQuestionType } from "../types";

export type BankScope = "any" | "open_ended" | "closed";

interface BankResult {
  key: string;
  items: QuestionBankItem[];
  error?: string;
}

/**
 * The builder's question bank panel: search (debounced), type filter,
 * multi-select and "Add questions". Questions already in the quiz and types
 * the quiz can't take are not listed.
 */
export function BankPanel({ exclude, scope, onAdd, onClose }: { exclude: string[]; scope: BankScope; onAdd: (items: QuestionBankItem[]) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<UiQuestionType | "">(scope === "open_ended" ? "open_ended" : "");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<BankResult | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const excludeKey = exclude.join(",");
  const queryKey = JSON.stringify([debounced, type, scope, excludeKey]);
  const loading = result?.key !== queryKey;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    let cancelled = false;
    const [q, t, sc, ex] = JSON.parse(queryKey) as [string, UiQuestionType | "", BankScope, string];
    searchQuestionBankAction({ search: q, type: t, scope: sc, exclude: ex ? ex.split(",") : [] })
      .then((res) => {
        if (cancelled) return;
        setResult({ key: queryKey, items: res.ok ? res.data : [], error: res.ok ? undefined : res.error });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: queryKey, items: [], error: "Could not load the question bank." });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const items = result?.items ?? [];
  const typeOptions: UiQuestionType[] = scope === "open_ended" ? ["open_ended"] : scope === "closed" ? ["single", "multiple", "user_input"] : ["single", "multiple", "user_input", "open_ended"];
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-ink">Question bank</h2>
        <IconButton label="Close question bank" size="icon-sm" onClick={onClose}>
          <Icon.X className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-2 py-3">
        <Input
          type="search"
          value={search}
          placeholder="Search"
          aria-label="Search the question bank"
          leftAddon={<Icon.Search className="size-4" />}
          rightAddon={loading ? <Spinner className="size-4" /> : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setSearch(next);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              setDebounced(next.trim());
              setSelected([]);
            }, 300);
          }}
        />
        <Select
          aria-label="Filter by type"
          value={type}
          disabled={scope === "open_ended"}
          onChange={(e) => {
            setType(e.target.value as UiQuestionType | "");
            setSelected([]);
          }}
        >
          {scope !== "open_ended" && <option value="">{scope === "closed" ? "All types (except open ended)" : "All types"}</option>}
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {uiTypeLabels[t]}
            </option>
          ))}
        </Select>
        {scope !== "any" && (
          <p className="text-xs text-ink-muted">
            {scope === "open_ended"
              ? "This quiz has open-ended questions, so only open-ended questions can be added."
              : "Open-ended questions can't be mixed with other types in this quiz."}
          </p>
        )}
      </div>

      <div className="scrollbar-thin -mx-1 min-h-40 flex-1 overflow-y-auto px-1" aria-busy={loading}>
        {loading && !result ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : result?.error ? (
          <p className="py-8 text-center text-sm text-danger">{result.error}</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">No questions found.</p>
        ) : (
          <ul className={cn("space-y-2", loading && "opacity-60")}>
            {items.map((item) => {
              const q = item.question;
              const checked = selected.includes(q.id);
              const plain = stripMarkdown(q.text) || "Untitled question";
              return (
                <li key={q.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      checked ? "border-accent bg-accent/6" : "border-border hover:bg-surface-2",
                    )}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(q.id)} className="mt-0.5 size-4 shrink-0 accent-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink" title={plain}>
                        {truncate(plain, 110)}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <QuestionTypeBadge type={toUiType(q.type, q.multiple)} />
                        <MarksBadge marks={q.marks > 0 ? q.marks : 1} />
                        {item.usedIn > 0 && <span className="text-[11px] text-ink-faint">in {item.usedIn === 1 ? "1 quiz" : `${item.usedIn} quizzes`}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-ink-muted">{selected.length ? `${selected.length} selected` : items.length ? `${items.length} available` : ""}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selected.length}
            onClick={() => onAdd(items.filter((i) => selected.includes(i.question.id)))}
            leftIcon={<Icon.Plus className="size-4" />}
          >
            Add questions
          </Button>
        </div>
      </div>
    </div>
  );
}

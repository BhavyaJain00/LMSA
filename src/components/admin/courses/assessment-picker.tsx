"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import type { AssessmentKind, AssessmentOption } from "./types";

export const ASSESSMENT_COPY: Record<AssessmentKind, { noun: string; title: string; search: string; empty: string; createHref: string; editHref: (id: string) => string; filterLabel: string }> = {
  quiz: {
    noun: "quiz",
    title: "Add a quiz to your lesson",
    search: "Select a quiz",
    empty: "No quizzes found",
    createHref: "/admin/quizzes/new",
    editHref: (id) => `/admin/quizzes/${id}`,
    filterLabel: "Only show quizzes from the current course",
  },
  assignment: {
    noun: "assignment",
    title: "Add an assignment to your lesson",
    search: "Select an Assignment",
    empty: "No assignments found",
    createHref: "/admin/assignments/new",
    editHref: (id) => `/admin/assignments/${id}`,
    filterLabel: "Limit the list to this course's assignments",
  },
  exercise: {
    noun: "programming exercise",
    title: "Attach a coding exercise to this lesson",
    search: "Select a programming exercise",
    empty: "No programming exercises found",
    createHref: "/admin/exercises/new",
    editHref: (id) => `/admin/exercises/${id}`,
    filterLabel: "Only show exercises from the current course",
  },
};

/**
 * Searchable picker for quizzes / assignments / exercises. Mount with a
 * `key` per opening so the search and selection start fresh.
 */
export function AssessmentPickerDialog({
  open,
  kind,
  options,
  courseId,
  value,
  onClose,
  onSelect,
  onRefresh,
  refreshing,
}: {
  open: boolean;
  kind: AssessmentKind;
  options: AssessmentOption[];
  courseId: string;
  value: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const copy = ASSESSMENT_COPY[kind];
  const listId = useId();
  const [query, setQuery] = useState("");
  const hasCourseItems = options.some((o) => o.courseId === courseId);
  const [onlyCourse, setOnlyCourse] = useState(hasCourseItems);
  const [selected, setSelected] = useState(value);

  const q = query.trim().toLowerCase();
  const filtered = options.filter(
    (o) => (!onlyCourse || o.courseId === courseId) && (!q || o.title.toLowerCase().includes(q) || o.courseTitle?.toLowerCase().includes(q) || o.meta?.toLowerCase().includes(q)),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      size="lg"
      footer={
        <>
          <a href={copy.createHref} target="_blank" rel="noopener" className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            <Icon.Plus className="size-4" />
            Create new
            <Icon.ExternalLink className="size-3.5" />
          </a>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => selected && onSelect(selected)} disabled={!selected}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.search}
          aria-label={copy.search}
          aria-controls={listId}
          leftAddon={<Icon.Search className="size-4" />}
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <Switch
            id={`${listId}-filter`}
            checked={onlyCourse}
            onChange={(e) => setOnlyCourse(e.target.checked)}
            label="Filter by course"
            description={copy.filterLabel}
            className="flex-1 justify-start"
          />
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh} loading={refreshing} leftIcon={<Icon.Refresh className="size-4" />}>
              Refresh list
            </Button>
          )}
        </div>
        <div id={listId} role="radiogroup" aria-label={copy.search} className="scrollbar-thin max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center">
              <p className="text-sm font-medium text-ink">{copy.empty}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {onlyCourse ? "Turn off the course filter to see everything, or " : "Try another search, or "}
                <a href={copy.createHref} target="_blank" rel="noopener" className="font-medium text-accent hover:underline">
                  create a new {copy.noun}
                </a>
                .
              </p>
            </div>
          ) : (
            filtered.map((o) => {
              const checked = o.id === selected;
              return (
                <label
                  key={o.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    checked ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border hover:bg-surface-2",
                  )}
                  onDoubleClick={() => onSelect(o.id)}
                >
                  <input type="radio" name={`${listId}-choice`} value={o.id} checked={checked} onChange={() => setSelected(o.id)} className="mt-1 accent-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{o.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {[o.meta, o.courseTitle ?? "Not linked to a course"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}

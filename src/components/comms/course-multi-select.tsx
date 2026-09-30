"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface CourseChoice {
  id: string;
  title: string;
  published: boolean;
}

/**
 * Pick any number of courses: the chosen ones show as removable chips, and
 * "Choose courses" opens a searchable checkbox list (Escape closes it).
 */
export function CourseMultiSelect({
  label,
  description,
  courses,
  value,
  onChange,
  disabledIds,
}: {
  label: string;
  description?: string;
  courses: CourseChoice[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Courses that can't be picked here (e.g. already used by the opposite condition). */
  disabledIds?: string[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c] as const)), [courses]);
  const disabled = useMemo(() => new Set(disabledIds ?? []), [disabledIds]);
  const q = query.trim().toLowerCase();
  const matches = q ? courses.filter((c) => c.title.toLowerCase().includes(q)) : courses;

  const toggle = (courseId: string) => {
    onChange(value.includes(courseId) ? value.filter((v) => v !== courseId) : [...value, courseId]);
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    }
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}

      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label}: selected courses`}>
          {value.map((courseId) => {
            const course = byId.get(courseId);
            const title = course?.title ?? "Deleted course";
            return (
              <li key={courseId} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs text-ink">
                <span className="truncate">{title}</span>
                <button
                  type="button"
                  onClick={() => toggle(courseId)}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={`Remove ${title}`}
                >
                  <Icon.X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon.Plus className="size-4" />
        {value.length ? "Change courses" : "Choose courses"}
        <Icon.ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id={`${id}-panel`} onKeyDown={onPanelKeyDown} className="mt-2 rounded-lg border border-border bg-surface-1 p-2 shadow-pop">
          {courses.length === 0 ? (
            <p className="px-2 py-3 text-sm text-ink-muted">There are no courses yet.</p>
          ) : (
            <>
              <Input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses"
                aria-label="Search courses"
                leftAddon={<Icon.Search className="size-4" />}
              />
              <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Courses">
                {matches.length === 0 ? (
                  <li className="px-2 py-3 text-sm text-ink-muted">No courses match “{query.trim()}”.</li>
                ) : (
                  matches.map((course) => {
                    const checked = value.includes(course.id);
                    const blocked = !checked && disabled.has(course.id);
                    const inputId = `${id}-${course.id}`;
                    return (
                      <li key={course.id}>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm",
                            blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-2",
                          )}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={checked}
                            disabled={blocked}
                            onChange={() => toggle(course.id)}
                            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{course.title}</span>
                            {(!course.published || blocked) && (
                              <span className="block text-xs text-ink-muted">
                                {blocked ? "Used by the other course condition" : "Not published"}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border px-1 pt-2 text-xs text-ink-muted">
                <span>{value.length ? `${value.length} selected` : "None selected"}</span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    toggleRef.current?.focus();
                  }}
                  className="rounded px-2 py-1 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}

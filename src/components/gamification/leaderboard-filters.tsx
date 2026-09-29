"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/icons";

/**
 * Course filter for the leaderboard; keeps the selected period in the URL.
 * Uncontrolled so the choice shows immediately; the page keys it by the
 * current course so it resets when the URL changes elsewhere.
 */
export function LeaderboardCourseFilter({ courses, value }: { courses: { id: string; title: string; hasPoints: boolean }[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams(search.toString());
    if (next) params.set("course", next);
    else params.delete("course");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const withPoints = courses.filter((c) => c.hasPoints);
  const others = courses.filter((c) => !c.hasPoints);

  return (
    <div className="flex w-full items-center gap-2 sm:w-72">
      <label htmlFor="leaderboard-course" className="sr-only">
        Course
      </label>
      <div className="min-w-0 flex-1">
        <Select id="leaderboard-course" defaultValue={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-busy={pending || undefined}>
          <option value="">All courses</option>
          {withPoints.length > 0 && (
            <optgroup label="Courses with points">
              {withPoints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={withPoints.length ? "Other courses" : "Courses"}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      {pending && <Spinner className="size-4 shrink-0 text-ink-faint" />}
    </div>
  );
}

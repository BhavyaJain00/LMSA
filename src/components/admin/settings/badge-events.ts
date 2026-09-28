import type { BadgeEvent } from "@/lib/types";

/** Human labels + rule descriptions for badge events (shared by forms and server validation). */
export const BADGE_EVENTS: { value: BadgeEvent; label: string; description: string; threshold?: string }[] = [
  { value: "course_enrolled", label: "Course enrollment", description: "Awarded when a learner has enrolled in at least N courses.", threshold: "Number of enrollments" },
  { value: "course_completed", label: "Course completion", description: "Awarded when a learner has completed at least N courses.", threshold: "Number of completed courses" },
  { value: "quiz_passed", label: "Quiz passed", description: "Awarded when a learner passes a quiz with a score of at least N%.", threshold: "Minimum score (%)" },
  { value: "assignment_passed", label: "Assignment passed", description: "Awarded when a learner has at least N passing assignment submissions.", threshold: "Number of passed assignments" },
  { value: "certificate_issued", label: "Certificate issued", description: "Awarded when a learner receives a certificate." },
  { value: "streak_7", label: "7-day streak", description: "Awarded after learning seven days in a row." },
  { value: "streak_30", label: "30-day streak", description: "Awarded after learning thirty days in a row." },
  { value: "manual", label: "Manual assignment", description: "Never awarded automatically — assign it from the Assignments tab." },
];

export const BADGE_EVENT_LABELS = Object.fromEntries(BADGE_EVENTS.map((e) => [e.value, e.label])) as Record<BadgeEvent, string>;

export function isBadgeEvent(value: string): value is BadgeEvent {
  return BADGE_EVENTS.some((e) => e.value === value);
}

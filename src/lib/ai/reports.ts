/**
 * Why a learner can report an AI tutor answer (client-safe; shared by the
 * report dialog, the server action and the review queue).
 */

export const REPORT_REASONS = {
  incorrect: "The answer is wrong",
  unhelpful: "It didn't answer my question",
  answers: "It gave away quiz or assignment answers",
  inappropriate: "Inappropriate or unsafe content",
  other: "Something else",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && Object.hasOwn(REPORT_REASONS, value);
}

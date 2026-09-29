import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export type GradedOutcome = "passed" | "failed" | "graded" | "feedback";

export interface GradedEmailData {
  name: string;
  kind: "quiz" | "assignment";
  title: string;
  outcome: GradedOutcome;
  /** e.g. "8 / 10" */
  score?: string;
  /** 0–100 */
  percentage?: number;
  passingPercentage?: number;
  /** Evaluator feedback as markdown. */
  feedbackMarkdown?: string;
  graderName?: string;
  courseTitle?: string;
  /** Link to the submission. */
  url: string;
  /** Override the subject (e.g. with the in-app notification subject). */
  subject?: string;
  footer?: EmailFooter;
}

/** Quiz or assignment graded / new feedback. */
export function gradedEmail(brand: EmailBrand, data: GradedEmailData): RenderedEmail {
  const noun = data.kind === "quiz" ? "quiz" : "assignment";
  const subject =
    data.subject ??
    (data.outcome === "feedback"
      ? `New feedback on your ${noun} ${data.title}`
      : data.kind === "quiz"
        ? `Your ${data.title} submission has been graded`
        : `Your assignment ${data.title} was graded`);
  const blocks: EmailBlock[] = [];
  if (data.outcome === "passed") {
    blocks.push({ type: "callout", tone: "success", title: "Passed", text: `Well done — you passed the ${noun} ${data.title}.` });
  } else if (data.outcome === "failed") {
    blocks.push({
      type: "callout",
      tone: "warning",
      title: "Not passed yet",
      text: `Your ${noun} ${data.title} didn't meet the passing mark this time. Review the feedback and try again.`,
    });
  } else if (data.outcome === "graded") {
    blocks.push({ type: "paragraph", text: `Your ${noun} ${data.title} has been graded.` });
  } else {
    blocks.push({ type: "paragraph", text: `${data.graderName ?? "Your instructor"} left feedback on your ${noun} ${data.title}.` });
  }
  const rows = [
    { label: data.kind === "quiz" ? "Quiz" : "Assignment", value: data.title },
    { label: "Course", value: data.courseTitle ?? "" },
    { label: "Score", value: data.score ?? "" },
    { label: "Percentage", value: data.percentage !== undefined ? `${Math.round(data.percentage)}%` : "" },
    { label: "Passing mark", value: data.passingPercentage !== undefined ? `${data.passingPercentage}%` : "" },
    { label: "Graded by", value: data.outcome !== "feedback" ? (data.graderName ?? "") : "" },
  ];
  if (rows.some((r, i) => i > 0 && r.value)) blocks.push({ type: "details", rows });
  if (data.feedbackMarkdown?.trim()) {
    blocks.push({ type: "paragraph", text: data.graderName ? `Feedback from ${data.graderName}:` : "Feedback:" });
    blocks.push({ type: "markdown", markdown: data.feedbackMarkdown.length > 4000 ? `${data.feedbackMarkdown.slice(0, 4000)}…` : data.feedbackMarkdown });
  }
  blocks.push({ type: "button", label: data.kind === "quiz" ? "Review your submission" : "View your assignment", url: data.url });
  return renderEmail(brand, subject, {
    preheader: data.score ? `${data.title}: ${data.score}` : subject,
    eyebrow: data.kind === "quiz" ? "Quiz result" : "Assignment feedback",
    heading: subject,
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    footer: data.footer,
  });
}

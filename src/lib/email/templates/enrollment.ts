import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export type EnrollmentKind = "course" | "batch" | "program";

export interface EnrollmentEmailData {
  name: string;
  kind: EnrollmentKind;
  title: string;
  /** Link to the course/batch/program page. */
  url: string;
  /** Short description of the item. */
  summary?: string;
  /** Schedule, instructors, medium… */
  details?: { label: string; value: string }[];
  /** e.g. "Maya Patel added you to the course." */
  addedBy?: string;
  /** Override the subject (e.g. with the in-app notification subject). */
  subject?: string;
  footer?: EmailFooter;
}

const KIND_LABEL: Record<EnrollmentKind, string> = { course: "Course", batch: "Batch", program: "Program" };

/** Enrollment confirmation for a course, batch (cohort) or program. */
export function enrollmentConfirmationEmail(brand: EmailBrand, data: EnrollmentEmailData): RenderedEmail {
  const subject =
    data.subject ??
    (data.kind === "batch" ? `Your seat in ${data.title} is confirmed` : data.kind === "program" ? `You've joined the ${data.title} program` : `You're enrolled in ${data.title}`);
  const intro =
    data.kind === "batch"
      ? `You're enrolled in the batch ${data.title}. Everything you need — courses, schedule, live classes and announcements — is on the batch page.`
      : data.kind === "program"
        ? `You've joined the program ${data.title}. Work through its courses to complete it.`
        : `You're enrolled in ${data.title}. Pick up where you left off at any time — your progress is saved automatically.`;
  const blocks: EmailBlock[] = [];
  if (data.addedBy) blocks.push({ type: "paragraph", text: data.addedBy });
  blocks.push({ type: "paragraph", text: intro });
  if (data.summary) blocks.push({ type: "quote", text: data.summary });
  if (data.details?.length) blocks.push({ type: "details", rows: data.details });
  blocks.push({
    type: "button",
    label: data.kind === "batch" ? "Open the batch" : data.kind === "program" ? "View the program" : "Start the course",
    url: data.url,
  });
  return renderEmail(brand, subject, {
    preheader: data.kind === "batch" ? `Your seat in ${data.title} is confirmed.` : `You now have access to ${data.title}.`,
    eyebrow: `${KIND_LABEL[data.kind]} enrollment`,
    heading: subject,
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    signoff: ["See you inside,", `The ${brand.name} team`],
    footer: data.footer,
  });
}

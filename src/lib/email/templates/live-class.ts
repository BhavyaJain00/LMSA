import { type EmailBrand, type EmailBlock, type EmailFooter, type RenderedEmail, firstName, renderEmail } from "./layout";

export type LiveClassEmailVariant = "scheduled" | "rescheduled" | "reminder" | "recording" | "update";

export interface LiveClassEmailData {
  name: string;
  variant: LiveClassEmailVariant;
  /** Subject line, e.g. "Live class today: Intro to React". */
  subject: string;
  classTitle: string;
  batchTitle: string;
  description?: string;
  /** e.g. "Tuesday, 6 October 2026" */
  dateLabel: string;
  /** e.g. "6:00 PM – 7:00 PM" */
  timeLabel: string;
  /** e.g. "Asia/Kolkata (GMT+5:30)" */
  timezoneLabel: string;
  durationLabel?: string;
  hostName?: string;
  providerLabel?: string;
  /** Meeting link (only for learners who may join). */
  joinUrl?: string;
  /** Batch page anchored at the class. */
  detailsUrl: string;
  recordingUrl?: string;
  footer?: EmailFooter;
}

const INTRO: Record<LiveClassEmailVariant, (d: LiveClassEmailData) => string> = {
  scheduled: (d) => `A new live class has been scheduled for ${d.batchTitle}. Add it to your calendar so you don't miss it.`,
  rescheduled: (d) => `The live class "${d.classTitle}" in ${d.batchTitle} has moved. Here are the new details.`,
  reminder: (d) => `This is a reminder that "${d.classTitle}" from ${d.batchTitle} is happening today.`,
  recording: (d) => `The recording of "${d.classTitle}" from ${d.batchTitle} is ready to watch.`,
  update: (d) => `There's an update about the live class "${d.classTitle}" in ${d.batchTitle}.`,
};

/** Live class scheduled / rescheduled / same-day reminder / recording available. */
export function liveClassEmail(brand: EmailBrand, data: LiveClassEmailData): RenderedEmail {
  const blocks: EmailBlock[] = [{ type: "paragraph", text: INTRO[data.variant](data) }];
  if (data.variant !== "recording") {
    blocks.push({
      type: "details",
      rows: [
        { label: "Class", value: data.classTitle },
        { label: "Date", value: data.dateLabel },
        { label: "Time", value: data.timeLabel },
        { label: "Timezone", value: data.timezoneLabel },
        { label: "Duration", value: data.durationLabel ?? "" },
        { label: "Host", value: data.hostName ?? "" },
        { label: "Where", value: data.providerLabel ?? "" },
      ],
    });
  }
  if (data.description) blocks.push({ type: "quote", text: data.description });
  if (data.variant === "recording") {
    blocks.push({ type: "button", label: "Watch the recording", url: data.recordingUrl ?? data.detailsUrl });
  } else if (data.joinUrl && data.variant === "reminder") {
    blocks.push({ type: "button", label: "Join the class", url: data.joinUrl });
    blocks.push({ type: "muted", text: "The join link opens a few minutes before the class starts. You can also join from the batch page." });
  } else {
    blocks.push({ type: "button", label: "View class details", url: data.detailsUrl });
  }
  return renderEmail(brand, data.subject, {
    preheader: data.variant === "recording" ? `Recording ready: ${data.classTitle}` : `${data.classTitle} · ${data.dateLabel}, ${data.timeLabel}`,
    eyebrow: `Live class · ${data.batchTitle}`,
    heading: data.subject,
    greeting: `Hi ${firstName(data.name)},`,
    blocks,
    footer: data.footer,
  });
}

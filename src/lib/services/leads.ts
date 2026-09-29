import "server-only";
import type { Lead } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { emit } from "@/lib/events";
import { isValidEmail, uid } from "@/lib/utils";

/**
 * Store a marketing lead (round 3), deduplicated by email address, and
 * publish `lead.created` for addresses seen for the first time. Every lead
 * capture path (lead forms, waitlists, free lessons) should go through this
 * so email sequences, webhooks and analytics hear about new leads.
 *
 * A repeat sign-up keeps the original row: it fills in a missing name or
 * course, records consent when given now, and re-subscribes an address that
 * had unsubscribed only when consent is given again.
 */
export interface RecordLeadInput {
  email: string;
  name?: string;
  /** Where the lead was captured, e.g. "blog", "course:crs_js", "footer". */
  source: string;
  courseId?: string;
  /** Explicit marketing consent given with this sign-up. */
  consent: boolean;
}

export type RecordLeadResult = { ok: true; lead: Lead; created: boolean } | { ok: false; error: string };

export async function recordLead(input: RecordLeadInput): Promise<RecordLeadResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email) || email.length > 254) return { ok: false, error: "Please enter a valid email address." };
  const name = input.name?.trim().slice(0, 120) || undefined;
  const source = input.source.trim().slice(0, 80) || "website";
  const courseId = input.courseId?.trim() || undefined;

  const result = await mutate((d) => {
    const existing = d.leads.find((l) => l.email === email);
    if (existing) {
      if (name && !existing.name) existing.name = name;
      if (courseId && !existing.courseId) existing.courseId = courseId;
      if (input.consent) {
        existing.consent = true;
        existing.unsubscribedAt = undefined;
      }
      return { lead: { ...existing }, created: false };
    }
    const lead: Lead = { id: uid("lead"), email, name, source, courseId, consent: input.consent, createdAt: new Date().toISOString() };
    d.leads.push(lead);
    return { lead: { ...lead }, created: true };
  });

  if (result.created) {
    const { lead } = result;
    emit("lead.created", { leadId: lead.id, email: lead.email, name: lead.name, source: lead.source, courseId: lead.courseId, consent: lead.consent });
  }
  return { ok: true, ...result };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, User } from "@/lib/types";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { fd, fdBool } from "@/lib/utils";
import { courseValuesFor, describeTestSend, sendCampaignTest } from "@/lib/comms/preview";
import { runComms } from "@/lib/comms/runner";
import { deleteSequence, duplicateSequence, getSequence, saveSequence, setSequenceActive, stopActiveEnrollments, stopEnrollment } from "@/lib/comms/sequences";

/**
 * Email sequence administration (moderators and admins). Every action
 * re-checks the caller's role.
 */

const STAFF_ONLY = "Only moderators and administrators can manage email sequences.";

async function sequenceStaff(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isModerator(user) ? user : null;
}

function parseSteps(raw: string): unknown {
  if (!raw || raw.length > 2_000_000) return [];
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
}

/** Create or update a sequence, then open its page. */
export async function saveSequenceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const id = fd(formData, "id") || undefined;
  const result = await saveSequence(user, {
    id,
    name: fd(formData, "name"),
    description: fd(formData, "description"),
    trigger: fd(formData, "trigger"),
    courseId: fd(formData, "courseId"),
    inactiveDays: fd(formData, "inactiveDays"),
    goal: fd(formData, "goal"),
    steps: parseSteps(String(formData.get("steps") ?? "")),
  });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  const { sequence } = result;
  await audit(user, id ? "sequence.update" : "sequence.create", { type: "sequence", id: sequence.id }, { name: sequence.name, trigger: sequence.trigger, steps: sequence.steps.length });

  let flash = id ? "Sequence saved" : "Sequence created. Switch it on when you're ready.";
  if (!id && fdBool(formData, "activate")) {
    const activated = await setSequenceActive(sequence.id, true);
    if (activated.ok) {
      await audit(user, "sequence.activate", { type: "sequence", id: sequence.id }, { name: sequence.name });
      flash = "Sequence created and switched on";
    } else {
      flash = `Sequence created, but it couldn't be switched on: ${activated.error}`;
    }
  }
  revalidatePath("/admin/sequences", "layout");
  await setFlash(flash);
  redirect(`/admin/sequences/${sequence.id}`);
}

export async function setSequenceActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await setSequenceActive(String(id), active === true);
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, active ? "sequence.activate" : "sequence.pause", { type: "sequence", id: result.sequence.id }, { name: result.sequence.name });
  if (active) {
    // Overdue steps of people who were part-way through go out now.
    try {
      await runComms({ wait: true });
    } catch (error) {
      console.error("[sequences] run failed:", error instanceof Error ? error.message : String(error));
    }
  }
  revalidatePath("/admin/sequences", "layout");
  return { ok: true, data: undefined, message: active ? "Sequence switched on" : "Sequence paused" };
}

/** Copy a sequence (switched off, no history) and open the copy in the editor. */
export async function duplicateSequenceAction(id: string): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await duplicateSequence(user, String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "sequence.create", { type: "sequence", id: result.sequence.id }, { name: result.sequence.name, copiedFrom: String(id) });
  revalidatePath("/admin/sequences", "layout");
  await setFlash("Sequence copied. The copy is switched off.");
  redirect(`/admin/sequences/${result.sequence.id}/edit`);
}

export async function deleteSequenceAction(id: string): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await deleteSequence(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "sequence.delete", { type: "sequence", id: result.sequence.id }, { name: result.sequence.name });
  revalidatePath("/admin/sequences", "layout");
  await setFlash("Sequence deleted");
  redirect("/admin/sequences");
}

/** Send one email of a saved sequence to the staff member as a test. */
export async function sendSequenceTestAction(id: string, stepId: string, to: string): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const sequence = await getSequence(String(id));
  const step = sequence?.steps.find((s) => s.id === stepId);
  if (!sequence || !step) return { ok: false, error: "This email no longer exists. Reload the page." };
  const result = await sendCampaignTest(user, step, typeof to === "string" ? to.slice(0, 1_000) : "", await courseValuesFor(sequence.courseId));
  if (!result.ok) return result;
  return { ok: true, data: undefined, message: describeTestSend(result) };
}

export async function stopSequenceEnrollmentAction(enrollmentId: string): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await stopEnrollment(String(enrollmentId));
  if (!result.ok) return result;
  await audit(user, "sequence.stop_enrollment", { type: "sequence", id: result.sequenceId }, { enrollmentId: String(enrollmentId) });
  revalidatePath(`/admin/sequences/${result.sequenceId}`);
  return { ok: true, data: undefined, message: "Removed from the sequence" };
}

/** Stop everyone who is part-way through a sequence. */
export async function stopAllSequenceEnrollmentsAction(sequenceId: string): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const sequence = await getSequence(String(sequenceId));
  if (!sequence) return { ok: false, error: "This sequence no longer exists." };
  const stopped = await stopActiveEnrollments(sequence.id);
  await audit(user, "sequence.stop_all", { type: "sequence", id: sequence.id }, { name: sequence.name, stopped });
  revalidatePath(`/admin/sequences/${sequence.id}`);
  return { ok: true, data: undefined, message: stopped ? `Stopped ${stopped} ${stopped === 1 ? "person" : "people"}` : "Nobody was part-way through" };
}

/** Run the comms work that is due right now (sends, enrollments) and report what happened. */
export async function runCommsNowAction(): Promise<ActionResult> {
  const user = await sequenceStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const run = await runComms({ wait: true });
  revalidatePath("/admin/sequences", "layout");
  revalidatePath("/admin/broadcasts", "layout");
  if (run.error) return { ok: false, error: "The run finished with errors. Check the error log for details." };
  if (run.sequences.emailDisabled || run.broadcasts.emailDisabled) return { ok: false, error: "Email is turned off, so nothing was sent. Switch it on in Settings → Email." };
  const sent = run.sequences.sent + run.broadcasts.queued;
  const parts = [`${sent} ${sent === 1 ? "email" : "emails"} queued`];
  if (run.sequences.enrolled) parts.push(`${run.sequences.enrolled} newly enrolled`);
  if (run.sequences.stopped) parts.push(`${run.sequences.stopped} stopped`);
  return { ok: true, data: undefined, message: parts.join(", ") };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { update } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { setFlash } from "@/lib/flash";
import { fd } from "@/lib/utils";

const STATIC_DESTINATIONS = new Set(["/dashboard", "/courses", "/batches", "/programs"]);
const MAX_LEN = 80;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}

/**
 * Save the onboarding persona (role, industry, goals, referrer) and mark it
 * captured. `intent=skip` stores whatever was answered and goes to the
 * dashboard; `intent=save` requires the questionnaire and follows the chosen
 * starting point.
 */
export async function savePersonaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please log in again." };

  const intent = fd(formData, "intent") === "skip" ? "skip" : "save";
  const referrer = clean(fd(formData, "referrer"));
  const role = clean(fd(formData, "role"));
  const industry = clean(fd(formData, "industry"));
  const goals = Array.from(
    new Set(
      formData
        .getAll("goals")
        .filter((g): g is string => typeof g === "string")
        .map(clean)
        .filter(Boolean),
    ),
  ).slice(0, 10);

  if (intent === "save") {
    const fieldErrors: Record<string, string> = {};
    if (!referrer) fieldErrors.referrer = "Tell us how you heard about us.";
    if (!role) fieldErrors.role = "Choose what best describes you.";
    if (!industry) fieldErrors.industry = "Choose your industry.";
    if (!goals.length) fieldErrors.goals = "Pick at least one goal.";
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Please answer every question, or skip for now.", fieldErrors };
  }

  const destinationRaw = fd(formData, "destination");
  const destination =
    intent === "skip"
      ? "/dashboard"
      : STATIC_DESTINATIONS.has(destinationRaw) || destinationRaw === `/user/${user.username}/edit`
        ? destinationRaw
        : "/dashboard";

  const persona = {
    ...(user.persona ?? {}),
    ...(referrer ? { referrer } : {}),
    ...(role ? { role } : {}),
    ...(industry ? { industry } : {}),
    ...(goals.length ? { goals } : {}),
  };

  await update("users", user.id, { persona, personaCaptured: true });
  revalidatePath("/", "layout");
  if (intent === "save") await setFlash("Thanks! Your learning space is ready.");
  redirect(destination);
}

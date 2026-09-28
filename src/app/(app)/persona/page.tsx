import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { PersonaForm } from "./persona-form";

export const metadata = { title: "Welcome" };

/**
 * One-time onboarding questionnaire. New members land here after signing up
 * (the register action redirects to /persona); it can be revisited later to
 * update learning goals.
 */
export default async function PersonaPage() {
  const user = await requireUser("/persona");
  const settings = await getSettings();
  return (
    <div className="min-h-[70vh]">
      <p className="sr-only">Welcome to {settings.brand.name}, {user.name}.</p>
      <PersonaForm
        brandName={settings.brand.name}
        username={user.username}
        initial={{
          referrer: user.persona?.referrer,
          role: user.persona?.role,
          industry: user.persona?.industry,
          goals: user.persona?.goals,
        }}
      />
    </div>
  );
}

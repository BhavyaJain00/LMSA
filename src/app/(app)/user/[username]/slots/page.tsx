import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/data/users";
import { canViewEvaluatorTabs, getEvaluatorSchedule, getEvaluatorSlots, isEvaluatorRole, platformTimeZone } from "@/lib/data/certificates";
import { Icon } from "@/components/ui/icons";
import { SlotsEditor } from "@/components/certificates/slots-editor";
import { timeZoneLabel } from "@/components/certificates/time";

export async function generateMetadata(props: PageProps<"/user/[username]/slots">): Promise<Metadata> {
  const { username } = await props.params;
  const profile = await getUserByUsername(username);
  return { title: profile ? `${profile.name} · Slots` : "Slots" };
}

export default async function EvaluatorSlotsPage(props: PageProps<"/user/[username]/slots">) {
  const { username } = await props.params;
  const viewer = await requireUser(`/user/${username}/slots`);
  const profile = await getUserByUsername(username);
  if (!profile) notFound();
  const owner = viewer.id === profile.id;
  // Visible to evaluators/moderators looking at an evaluator's profile, or to the evaluator themselves.
  if (!isEvaluatorRole(profile) || (!owner && !canViewEvaluatorTabs(viewer, profile))) redirect(`/user/${profile.username}`);

  const [slots, schedule] = await Promise.all([getEvaluatorSlots(profile.id), getEvaluatorSchedule(profile.id)]);
  const upcoming = schedule.filter((e) => e.status === "upcoming" && !e.awaitingResult).length;

  return (
    <div className="space-y-6">
      <SlotsEditor
        evaluatorId={profile.id}
        slots={slots}
        editable={owner}
        timeZoneLabel={timeZoneLabel(platformTimeZone())}
        heading={owner ? "My availability" : `${profile.name}'s availability`}
      />
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 p-4 text-sm shadow-card sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-ink-muted">
          <Icon.Info className="mt-0.5 size-4 shrink-0" />
          Learners book 30-minute evaluations inside these windows, up to 14 days ahead. Slots already booked are never offered twice.
        </p>
        <Link href={`/user/${profile.username}/schedule`} className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline">
          {upcoming} upcoming evaluation{upcoming === 1 ? "" : "s"} <Icon.ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

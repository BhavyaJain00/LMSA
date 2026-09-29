import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isModerator, requireUser } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/data/users";
import { canViewEvaluatorTabs, getEvaluatorSchedule, getEvaluatorUnavailability, isEvaluatorRole, platformNow } from "@/lib/data/certificates";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EvaluatorSchedule } from "@/components/certificates/evaluator-schedule";

export async function generateMetadata(props: PageProps<"/user/[username]/schedule">): Promise<Metadata> {
  const { username } = await props.params;
  const profile = await getUserByUsername(username);
  return { title: profile ? `${profile.name} · Schedule` : "Schedule" };
}

export default async function EvaluatorSchedulePage(props: PageProps<"/user/[username]/schedule">) {
  const { username } = await props.params;
  const viewer = await requireUser(`/user/${username}/schedule`);
  const profile = await getUserByUsername(username);
  if (!profile) notFound();
  const owner = viewer.id === profile.id;
  if (!isEvaluatorRole(profile) || (!owner && !canViewEvaluatorTabs(viewer, profile))) redirect(`/user/${profile.username}`);

  const [events, unavailable] = await Promise.all([getEvaluatorSchedule(profile.id), getEvaluatorUnavailability(profile.id)]);
  const { dateKey: today } = platformNow();
  const upcoming = events.filter((e) => e.status === "upcoming" && !e.awaitingResult).length;
  const awaiting = events.filter((e) => e.awaitingResult && !e.evaluation).length;
  const passed = events.filter((e) => e.evaluation?.status === "pass").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{owner ? "My evaluation schedule" : `${profile.name}'s evaluation schedule`}</h2>
          <p className="text-sm text-ink-muted">Click an evaluation to record the result and issue the certificate.</p>
        </div>
        <ButtonLink href={`/user/${profile.username}/slots`} variant="outline" size="sm" leftIcon={<Icon.Clock className="size-4" />}>
          Edit availability
        </ButtonLink>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Upcoming" value={upcoming} icon={<Icon.Calendar className="size-5" />} />
        <StatCard label="Awaiting result" value={awaiting} icon={<Icon.Timer className="size-5" />} />
        <StatCard label="Passed" value={passed} icon={<Icon.Award className="size-5" />} />
      </div>
      <EvaluatorSchedule
        events={events}
        today={today}
        unavailable={unavailable}
        viewer={{ id: viewer.id, moderator: isModerator(viewer) }}
        emptyAction={
          owner ? (
            <ButtonLink href={`/user/${profile.username}/slots`} size="sm" leftIcon={<Icon.Plus className="size-4" />}>
              Add availability
            </ButtonLink>
          ) : undefined
        }
      />
    </div>
  );
}

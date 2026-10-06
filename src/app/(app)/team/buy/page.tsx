import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser, isAdmin, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { param } from "@/lib/growth/affiliates-shared";
import { seatsCheckoutReady } from "@/lib/growth/team-checkout";
import { getManagedTeams, getTeamOverview, listSeatCourses } from "@/lib/growth/teams";
import { MAX_SEATS_PER_ORDER, orgRole, parseSeatCount } from "@/lib/growth/teams-shared";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { SeatMeter } from "@/components/growth/team-badges";
import { TeamBuyForm } from "@/components/growth/team-buy-form";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = {
  title: "For teams",
  description: "Buy seats for your company or team, invite people by email and follow their progress in one place.",
  alternates: { canonical: "/team/buy" },
};

const STEPS = [
  { icon: Icon.ListChecks, title: "Choose courses and seats", text: "Pick the courses every team member gets and how many people you are buying for." },
  { icon: Icon.Send, title: "Invite your people", text: "Paste their email addresses or load a CSV file. Everyone gets a personal link to accept their seat." },
  { icon: Icon.BarChart, title: "Follow their progress", text: "See who started and who finished each course, and export the numbers whenever you need them." },
];

const GUEST_COURSE_LIMIT = 8;

export default async function TeamBuyPage(props: PageProps<"/team/buy">) {
  const sp = await props.searchParams;
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const orgRef = param(sp, "org");
  const seats = parseSeatCount(param(sp, "seats")) ?? undefined;

  if (!settings.growth.teamsEnabled) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="For teams" />
        <EmptyState
          icon={<Icon.Building />}
          title="Team purchases are paused"
          description="We aren't selling team seats right now. Teams that already have seats keep working as usual."
          action={
            <ButtonLink href={user ? "/team" : "/courses"} variant="outline">
              {user ? "Go to my team" : "Browse courses"}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const checkoutReady = seatsCheckoutReady();

  /* More seats for a team the viewer already manages (also finishes an unpaid first order). */
  if (orgRef) {
    const viewer = user ?? (await requireUser(`/team/buy?org=${encodeURIComponent(orgRef)}`));
    const overview = await getTeamOverview(orgRef);
    const allowed = overview && (isAdmin(viewer) || !!orgRole(overview.org, viewer.id));
    if (!overview || !allowed) {
      return (
        <div className="animate-fade-in">
          <PageHeader title="Buy seats" />
          <EmptyState
            icon={<Icon.Building />}
            title="Team not found"
            description="This team doesn't exist, or you don't manage it. Only a team's owner and managers can buy seats for it."
            action={
              <ButtonLink href="/team/buy" variant="outline">
                Start a new team
              </ButtonLink>
            }
          />
        </div>
      );
    }
    const { org, usage } = overview;
    const teamHref = `/team?org=${encodeURIComponent(org.slug)}`;
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={overview.draft ? `Finish your order for ${org.name}` : `More seats for ${org.name}`}
          description={
            overview.seatPrice
              ? `Each seat costs ${money(overview.seatPrice.amount, overview.seatPrice.currency)} and unlocks the team's ${pluralize(overview.courses.length, "course")}.`
              : undefined
          }
          breadcrumbs={<Breadcrumbs items={[{ label: "My team", href: teamHref }, { label: "Buy seats" }]} />}
        />
        {!overview.seatPrice ? (
          <EmptyState
            icon={<Icon.AlertTriangle />}
            title="These seats can't be bought online"
            description="The team's courses are free, no longer on sale, or priced in different currencies. Contact us and we'll add the seats for you."
            action={
              <ButtonLink href={teamHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                Back to the team
              </ButtonLink>
            }
          />
        ) : (
          <div className="space-y-6">
            {!overview.draft && (
              <Card className="p-5">
                <p className="text-sm font-medium text-ink">
                  {usage.used} of {pluralize(usage.total, "seat")} in use today
                </p>
                <SeatMeter usage={usage} className="mt-3" />
              </Card>
            )}
            <TeamBuyForm
              team={{ id: org.id, name: org.name }}
              courses={overview.courses.filter((c) => c.price > 0).map((c) => ({ id: c.id, title: c.title, price: c.price, currency: c.currency }))}
              checkoutReady={checkoutReady}
              defaultSeats={seats ?? (usage.over > 0 ? usage.over : undefined)}
            />
          </div>
        )}
      </div>
    );
  }

  /* A new team. */
  const [courses, managed] = await Promise.all([listSeatCourses(), user ? getManagedTeams(user.id) : Promise.resolve([])]);
  const courseRef = param(sp, "course");
  const picked = courseRef ? courses.find((c) => c.id === courseRef || c.slug === courseRef) : undefined;
  // An order the buyer started earlier and never paid for: pick up where they left off.
  const draft = managed.find((t) => t.draft && t.role === "owner");
  const teams = managed.filter((t) => !t.draft);
  const next = `/team/buy${picked ? `?course=${encodeURIComponent(picked.slug)}` : ""}`;

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader
        className="mb-0"
        title="Train your whole team"
        description="Buy seats for the courses your people need, invite them by email and follow their progress in one place. Seats never expire and can be reassigned."
      />

      <section aria-label="How team seats work">
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="flex h-full gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <step.icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-medium text-ink">
                    <span className="text-ink-muted">{i + 1}. </span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">{step.text}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {teams.length > 0 && (
        <div role="status" className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink">
            You already manage {teams.length === 1 ? <span className="font-medium">{teams[0].org.name}</span> : `${teams.length} teams`}. Need more seats for the same courses? Add them to your team
            instead of starting a new one.
          </p>
          <ButtonLink href={teams.length === 1 ? `/team/buy?org=${encodeURIComponent(teams[0].org.slug)}` : "/team"} size="sm" variant="outline" className="shrink-0">
            {teams.length === 1 ? "Add seats" : "Choose a team"}
          </ButtonLink>
        </div>
      )}

      {courses.length === 0 ? (
        <EmptyState
          icon={<Icon.BookOpen />}
          title="No courses on sale for teams yet"
          description="Team seats can be bought for paid, published courses. Check back soon."
          action={
            <ButtonLink href="/courses" variant="outline">
              Browse courses
            </ButtonLink>
          }
        />
      ) : user ? (
        <TeamBuyForm
          courses={courses.map((c) => ({ id: c.id, title: c.title, price: c.price, currency: c.currency }))}
          checkoutReady={checkoutReady}
          defaultName={draft?.org.name}
          defaultSeats={seats}
          preselected={picked ? [picked.id] : (draft?.org.courseIds ?? [])}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Card>
            <CardHeader title="Courses you can buy seats for" description={`One seat covers one person. Buy up to ${MAX_SEATS_PER_ORDER} seats per order, for one course or several.`} />
            <CardBody className="p-0">
              <ul className="divide-y divide-border">
                {courses.slice(0, GUEST_COURSE_LIMIT).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/courses/${c.slug}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                      {c.title}
                    </Link>
                    <span className="shrink-0 tabular-nums text-ink-muted">{money(c.price, c.currency)} per seat</span>
                  </li>
                ))}
              </ul>
              {courses.length > GUEST_COURSE_LIMIT && (
                <p className="border-t border-border px-5 py-3 text-sm text-ink-muted">
                  and {courses.length - GUEST_COURSE_LIMIT} more.{" "}
                  <Link href="/courses" className="font-medium text-accent hover:underline">
                    See every course
                  </Link>
                </p>
              )}
            </CardBody>
          </Card>
          <Card className="lg:sticky lg:top-20">
            <CardHeader title="Get started" description="Sign in to choose your courses and seats. You manage the team from your own account." />
            <CardBody className="space-y-2">
              <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} className="w-full" leftIcon={<Icon.LogIn className="size-4" />}>
                Sign in to buy seats
              </ButtonLink>
              <ButtonLink href={`/register?next=${encodeURIComponent(next)}`} variant="outline" className="w-full">
                Create an account
              </ButtonLink>
              <p className="pt-2 text-xs text-ink-muted">Paying by purchase order or bank transfer? You can ask for an invoice at the last step.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

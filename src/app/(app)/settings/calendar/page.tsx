import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { getPublicBaseUrl } from "@/lib/data/certificates";
import { feedPathFor } from "@/lib/calendar/token";
import { icsPathFor, upcomingUserEvents } from "@/lib/calendar/events";
import { isPubliclyReachable } from "@/lib/calendar/links";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { PwaIcon } from "@/components/pwa/icons";
import { FeedPanel } from "./feed-panel";
import { UpcomingEvents, type UpcomingEventView } from "./upcoming-events";

export const metadata = { title: "Calendar" };

const INCLUDED: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Icon.Video />, title: "Live classes", text: "With the join link and a reminder 15 minutes before." },
  { icon: <Icon.Calendar />, title: "Batch timetable", text: "Sessions, lessons, deadlines and milestones." },
  { icon: <Icon.GraduationCap />, title: "Evaluations", text: "Ones you booked, and ones you run as an evaluator." },
  { icon: <Icon.Users />, title: "Batch dates", text: "When each of your batches starts and ends." },
];

const HOW_TO: { app: string; steps: string[] }[] = [
  {
    app: "Google Calendar",
    steps: ["Choose “Google Calendar” below, or open Google Calendar on the web.", "Next to “Other calendars”, pick “From URL” and paste your link.", "Google refreshes subscribed calendars every few hours."],
  },
  {
    app: "Apple Calendar",
    steps: ["On iPhone, iPad or Mac, choose “Calendar app”.", "Confirm the subscription. Set Auto-refresh to “Every hour” on a Mac.", "On iPhone you can also go to Settings → Calendar → Accounts → Add Subscribed Calendar."],
  },
  {
    app: "Outlook",
    steps: ["Choose “Outlook.com” or “Microsoft 365”, or in Outlook pick Add calendar → Subscribe from web.", "Paste your link and give the calendar a name.", "Outlook usually syncs subscribed calendars within a few hours."],
  },
];

export default async function CalendarSettingsPage() {
  const user = await requireUser("/settings/calendar");
  const [db, settings, baseUrl] = await Promise.all([getDb(), getSettings(), getPublicBaseUrl()]);

  let feedUrl: string | null = null;
  let feedError = false;
  try {
    const path = feedPathFor(user);
    feedUrl = path ? `${baseUrl}${path}` : null;
  } catch (err) {
    // The feed link depends on APP_SECRET; without it we fail closed.
    console.error("[calendar] cannot build feed link:", err instanceof Error ? err.message : err);
    feedError = true;
  }

  const events: UpcomingEventView[] = upcomingUserEvents(db, user, settings, 10).map((ev) => ({
    uid: ev.uid,
    kind: ev.kind,
    title: ev.title,
    description: ev.description,
    location: ev.location,
    timezone: ev.timezone,
    allDay: ev.allDay,
    start: ev.start,
    end: ev.end,
    startDate: ev.startDate,
    endDate: ev.endDate,
    path: ev.path,
    label: ev.kind === "timetable" ? (ev.categories[0] ?? "Event") : undefined,
    batchTitle: ev.batchTitle,
    milestone: ev.milestone,
    icsHref: icsPathFor(ev),
  }));

  const brand = settings.brand.name || "LearnLoop";
  const reachable = isPubliclyReachable(baseUrl);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title="Calendar"
        description={`Keep your ${brand} classes, schedule and evaluations in the calendar app you already use.`}
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex items-center gap-1 text-sm text-ink-muted">
              <li>
                <Link href="/settings" className="hover:text-ink hover:underline">
                  Account settings
                </Link>
              </li>
              <li aria-hidden="true">
                <Icon.ChevronRight className="size-3.5 text-ink-faint" />
              </li>
              <li className="font-medium text-ink" aria-current="page">
                Calendar
              </li>
            </ol>
          </nav>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Subscribe to your schedule"
            description="Your personal calendar link stays up to date on its own: new classes, changes and cancellations appear in your calendar automatically."
          />
          <CardBody className="space-y-6">
            <ul className="grid gap-3 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item.title} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-4">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{item.title}</span>
                    <span className="block text-xs text-ink-muted">{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            {feedError ? (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink">
                <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                <p>Calendar links are unavailable because the server is missing its secret key (APP_SECRET). Ask an administrator to configure it.</p>
              </div>
            ) : (
              <FeedPanel initialFeedUrl={feedUrl} calendarName={brand} publiclyReachable={reachable} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Coming up" description="The next events in your calendar, shown in your local time." />
          <CardBody>
            {events.length ? (
              <UpcomingEvents events={events} />
            ) : (
              <EmptyState
                compact
                icon={<PwaIcon.CalendarPlus />}
                title="Nothing scheduled yet"
                description="When you join a batch, get a live class or book an evaluation, it shows up here and in your subscribed calendar."
                action={
                  settings.features.batches ? (
                    <ButtonLink href="/batches" variant="outline" size="sm" leftIcon={<Icon.Users className="size-4" />}>
                      Browse batches
                    </ButtonLink>
                  ) : undefined
                }
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="How to subscribe" description="A subscription keeps syncing; importing a downloaded file only copies today's events." />
          <CardBody>
            <div className="grid gap-5 md:grid-cols-3">
              {HOW_TO.map((section) => (
                <section key={section.app} aria-labelledby={`howto-${section.app}`}>
                  <h3 id={`howto-${section.app}`} className="text-sm font-semibold text-ink">
                    {section.app}
                  </h3>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-ink-muted marker:text-ink-faint">
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
              <Icon.Lock className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
              Your link is private: anyone who has it can see your schedule, including meeting links. If you shared it by mistake, create a new link
              and the old one stops working right away.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

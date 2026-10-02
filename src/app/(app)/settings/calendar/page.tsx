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
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/catalog";
import { FeedPanel } from "./feed-panel";
import { UpcomingEvents, type UpcomingEventView } from "./upcoming-events";

export async function generateMetadata() {
  return { title: (await getT("account"))("settings.calendar.metaTitle") };
}

type AccountKey = MessageKey<"account">;

const INCLUDED: { icon: ReactNode; title: AccountKey; text: AccountKey }[] = [
  { icon: <Icon.Video />, title: "settings.calendar.included.liveClasses", text: "settings.calendar.included.liveClassesBody" },
  { icon: <Icon.Calendar />, title: "settings.calendar.included.timetable", text: "settings.calendar.included.timetableBody" },
  { icon: <Icon.GraduationCap />, title: "settings.calendar.included.evaluations", text: "settings.calendar.included.evaluationsBody" },
  { icon: <Icon.Users />, title: "settings.calendar.included.batchDates", text: "settings.calendar.included.batchDatesBody" },
];

/** App names are product names and stay as they are; the steps are translated. */
const HOW_TO: { id: string; app: string; steps: AccountKey[] }[] = [
  {
    id: "google",
    app: "Google Calendar",
    steps: ["settings.calendar.howto.google.step1", "settings.calendar.howto.google.step2", "settings.calendar.howto.google.step3"],
  },
  {
    id: "apple",
    app: "Apple Calendar",
    steps: ["settings.calendar.howto.apple.step1", "settings.calendar.howto.apple.step2", "settings.calendar.howto.apple.step3"],
  },
  {
    id: "outlook",
    app: "Outlook",
    steps: ["settings.calendar.howto.outlook.step1", "settings.calendar.howto.outlook.step2", "settings.calendar.howto.outlook.step3"],
  },
];

export default async function CalendarSettingsPage() {
  const user = await requireUser("/settings/calendar");
  const [db, settings, baseUrl, t] = await Promise.all([getDb(), getSettings(), getPublicBaseUrl(), getT("account")]);

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
    label: ev.kind === "timetable" ? (ev.categories[0] ?? t("settings.calendar.event")) : undefined,
    batchTitle: ev.batchTitle,
    milestone: ev.milestone,
    icsHref: icsPathFor(ev),
  }));

  const brand = settings.brand.name || "LearnLoop";
  const reachable = isPubliclyReachable(baseUrl);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title={t("settings.calendar.metaTitle")}
        description={t("settings.calendar.description", { brand })}
        breadcrumbs={
          <nav aria-label={t("settings.breadcrumb")} className="mb-2">
            <ol className="flex items-center gap-1 text-sm text-ink-muted">
              <li>
                <Link href="/settings" className="hover:text-ink hover:underline">
                  {t("settings.metaTitle")}
                </Link>
              </li>
              <li aria-hidden="true">
                <Icon.ChevronRight className="size-3.5 text-ink-faint rtl:rotate-180" />
              </li>
              <li className="font-medium text-ink" aria-current="page">
                {t("settings.calendar.metaTitle")}
              </li>
            </ol>
          </nav>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t("settings.calendar.subscribe.title")}
            description={t("settings.calendar.subscribe.description")}
          />
          <CardBody className="space-y-6">
            <ul className="grid gap-3 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item.title} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-4">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{t(item.title)}</span>
                    <span className="block text-xs text-ink-muted">{t(item.text)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {feedError ? (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink">
                <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                <p>{t("settings.calendar.feedError")}</p>
              </div>
            ) : (
              <FeedPanel initialFeedUrl={feedUrl} calendarName={brand} publiclyReachable={reachable} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.calendar.comingUp.title")} description={t("settings.calendar.comingUp.description")} />
          <CardBody>
            {events.length ? (
              <UpcomingEvents events={events} />
            ) : (
              <EmptyState
                compact
                icon={<PwaIcon.CalendarPlus />}
                title={t("settings.calendar.empty.title")}
                description={t("settings.calendar.empty.body")}
                action={
                  settings.features.batches ? (
                    <ButtonLink href="/batches" variant="outline" size="sm" leftIcon={<Icon.Users className="size-4" />}>
                      {t("settings.calendar.empty.browseBatches")}
                    </ButtonLink>
                  ) : undefined
                }
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.calendar.howto.title")} description={t("settings.calendar.howto.description")} />
          <CardBody>
            <div className="grid gap-5 md:grid-cols-3">
              {HOW_TO.map((section) => (
                <section key={section.id} aria-labelledby={`howto-${section.id}`}>
                  <h3 id={`howto-${section.id}`} className="text-sm font-semibold text-ink">
                    {section.app}
                  </h3>
                  <ol className="mt-2 list-decimal space-y-1.5 ps-4 text-sm text-ink-muted marker:text-ink-faint">
                    {section.steps.map((step) => (
                      <li key={step}>{t(step)}</li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
              <Icon.Lock className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
              {t("settings.calendar.howto.privateNote")}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

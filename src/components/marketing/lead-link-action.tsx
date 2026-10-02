"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmLeadAction, unsubscribeLeadAction } from "@/lib/actions/leads";
import { track } from "@/components/seo/tracking-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

type Outcome = { ok: true; message: string; course?: { slug: string; title: string } } | { ok: false; message: string };

/**
 * The button behind an emailed lead link (confirm the subscription, or
 * unsubscribe). Links are acted on only after a click, so mail scanners that
 * open every link cannot confirm or unsubscribe anyone by accident.
 */
export function LeadLinkAction({ kind, fields }: { kind: "confirm" | "unsubscribe"; fields: Record<string, string> }) {
  // `global.` keys: rendered on the /free confirmation pages, outside the public group's layouts.
  const t = useT("public");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    startTransition(async () => {
      if (kind === "confirm") {
        const result = await confirmLeadAction(formData);
        if (result.ok) {
          track("sign_up", { method: "lead_confirm" });
          setOutcome({
            ok: true,
            message: result.message ?? t("global.leadLink.confirmed"),
            course: result.data.courseSlug && result.data.courseTitle ? { slug: result.data.courseSlug, title: result.data.courseTitle } : undefined,
          });
        } else setOutcome({ ok: false, message: result.error });
      } else {
        const result = await unsubscribeLeadAction(formData);
        setOutcome(result.ok ? { ok: true, message: result.message ?? t("global.leadLink.unsubscribed") } : { ok: false, message: result.error });
      }
    });
  };

  if (outcome?.ok) {
    return (
      <div role="status" className="space-y-4">
        <p className="flex items-center justify-center gap-2 text-lg font-semibold text-ink">
          <Icon.CheckCircleFilled className="size-5 text-success" aria-hidden="true" />
          {outcome.message}
        </p>
        {kind === "confirm" ? (
          <>
            <p className="text-sm text-ink-muted">
              {outcome.course ? t("global.leadLink.syllabusOnItsWay", { title: outcome.course.title }) : t("global.leadLink.welcomeOnItsWay")}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {outcome.course ? (
                <ButtonLink href={`/courses/${outcome.course.slug}`} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                  {t("global.leadLink.backToCourse")}
                </ButtonLink>
              ) : (
                <ButtonLink href="/free" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                  {t("global.leadLink.freeLessons")}
                </ButtonLink>
              )}
              <ButtonLink href="/courses" variant="outline">
                {t("global.leadLink.browseCourses")}
              </ButtonLink>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            {t.rich("global.leadLink.unsubscribedBody", {
              link: (chunks) => (
                <Link href="/free" className="font-medium text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button size="lg" variant={kind === "unsubscribe" ? "danger" : "primary"} loading={pending} onClick={run}>
        {kind === "confirm" ? t("global.leadLink.confirm") : t("global.leadLink.unsubscribe")}
      </Button>
      {outcome && !outcome.ok && (
        <p role="alert" className="text-sm text-danger">
          {outcome.message}
        </p>
      )}
    </div>
  );
}

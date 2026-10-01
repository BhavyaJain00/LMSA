"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmLeadAction, unsubscribeLeadAction } from "@/lib/actions/leads";
import { track } from "@/components/seo/tracking-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

type Outcome = { ok: true; message: string; course?: { slug: string; title: string } } | { ok: false; message: string };

/**
 * The button behind an emailed lead link (confirm the subscription, or
 * unsubscribe). Links are acted on only after a click, so mail scanners that
 * open every link cannot confirm or unsubscribe anyone by accident.
 */
export function LeadLinkAction({ kind, fields }: { kind: "confirm" | "unsubscribe"; fields: Record<string, string> }) {
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
            message: result.message ?? "Your email is confirmed",
            course: result.data.courseSlug && result.data.courseTitle ? { slug: result.data.courseSlug, title: result.data.courseTitle } : undefined,
          });
        } else setOutcome({ ok: false, message: result.error });
      } else {
        const result = await unsubscribeLeadAction(formData);
        setOutcome(result.ok ? { ok: true, message: result.message ?? "You're unsubscribed" } : { ok: false, message: result.error });
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
              {outcome.course ? `The syllabus of ${outcome.course.title} is on its way to your inbox.` : "Your welcome email is on its way. Meanwhile, here is where to start:"}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {outcome.course ? (
                <ButtonLink href={`/courses/${outcome.course.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
                  Back to the course
                </ButtonLink>
              ) : (
                <ButtonLink href="/free" rightIcon={<Icon.ArrowRight className="size-4" />}>
                  Free lessons
                </ButtonLink>
              )}
              <ButtonLink href="/courses" variant="outline">
                Browse courses
              </ButtonLink>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            You won&apos;t receive marketing emails from us anymore. Changed your mind?{" "}
            <Link href="/free" className="font-medium text-accent hover:underline">
              Subscribe again
            </Link>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button size="lg" variant={kind === "unsubscribe" ? "danger" : "primary"} loading={pending} onClick={run}>
        {kind === "confirm" ? "Confirm my email" : "Unsubscribe"}
      </Button>
      {outcome && !outcome.ok && (
        <p role="alert" className="text-sm text-danger">
          {outcome.message}
        </p>
      )}
    </div>
  );
}

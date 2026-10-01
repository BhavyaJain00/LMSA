import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getTeachPageData } from "@/lib/teaching/marketplace";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Badge, Tag } from "@/components/ui/badge";
import { moneyList } from "@/components/growth/affiliate-badges";
import { ApplicationStatusBadge } from "@/components/teaching/marketplace-badges";
import { TeachApplicationForm, TeachPayoutEmailForm } from "@/components/teaching/teach-forms";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Teach", robots: { index: false } };

const STEPS = [
  { icon: Icon.ClipboardList, title: "Apply", text: "Tell us about yourself, the subjects you teach and share a sample." },
  { icon: Icon.ShieldCheck, title: "Get approved", text: "An administrator reviews your application and sets your revenue share." },
  { icon: Icon.Presentation, title: "Publish courses", text: "Build courses with the course editor and submit them for review." },
  { icon: Icon.CreditCard, title: "Get paid", text: "Every sale of your courses adds your share to your earnings, paid out to your payout email." },
];

export default async function TeachPage() {
  const user = await requireUser("/teach");
  const [settings, data] = await Promise.all([getSettings(), getTeachPageData(user.id)]);
  const m = settings.marketplace;
  const currency = settings.commerce.defaultCurrency;
  const { profile, application } = data;
  const canApply = m.enabled && m.allowApplications;

  if (profile?.status === "approved") {
    const pending = data.totals.map((t) => ({ currency: t.currency, amount: t.pending }));
    const paid = data.totals.map((t) => ({ currency: t.currency, amount: t.paid }));
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Teach"
          description={`You're an approved instructor. You earn ${profile.revenueSharePercent}% of the net revenue of the courses you teach.`}
          actions={
            <>
              <ButtonLink href="/teach/earnings" variant="outline" leftIcon={<Icon.BarChart className="size-4" />}>
                Earnings
              </ButtonLink>
              <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
                New course
              </ButtonLink>
            </>
          }
        />
        {!m.enabled && (
          <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p>The marketplace is paused: new sales don&apos;t earn revenue share right now. Your unpaid earnings stay payable.</p>
          </div>
        )}
        <section aria-label="Earnings summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Revenue share" value={`${profile.revenueSharePercent}%`} hint="Of net course revenue" icon={<Icon.Percent className="size-5" />} />
          <StatCard label="Unpaid" value={<span className="text-xl sm:text-2xl">{moneyList(pending, currency)}</span>} hint="Added to your next payout" icon={<Icon.Clock className="size-5" />} />
          <StatCard
            className="col-span-2 lg:col-span-1"
            label="Paid out"
            value={<span className="text-xl sm:text-2xl">{moneyList(paid, currency)}</span>}
            hint={<Link href="/teach/earnings?tab=payouts" className="hover:underline">Payout history</Link>}
            icon={<Icon.CreditCard className="size-5" />}
          />
        </section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader title="Your courses" description="Courses where you are listed as an instructor." />
            <CardBody>
              {data.courses.length === 0 ? (
                <EmptyState
                  icon={<Icon.BookOpen />}
                  title="No courses yet"
                  description="Create your first course. When it's published, every sale adds your share to your earnings."
                  action={<ButtonLink href="/admin/courses/new">Create a course</ButtonLink>}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {data.courses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                      <Link href={`/admin/courses/${c.id}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                        {c.title}
                      </Link>
                      <Badge tone={c.published ? "success" : "neutral"}>{c.published ? "Published" : "Draft"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payout email" description="Where we send your earnings." />
            <CardBody>
              <TeachPayoutEmailForm payoutEmail={profile.payoutEmail ?? user.email} />
              {profile.reviewedAt && <p className="mt-4 text-xs text-ink-muted">Instructor since {formatDate(profile.reviewedAt)}</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (!profile && !canApply) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Teach" />
        <EmptyState
          icon={<Icon.Presentation />}
          title="Instructor applications are closed"
          description="We aren't accepting new instructors right now. Check back later."
          action={
            <ButtonLink href="/courses" variant="outline">
              Browse courses
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Teach"
        description={`Share what you know with our learners and earn ${profile?.revenueSharePercent ?? m.defaultRevenueSharePercent}% of the net revenue of your courses.`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {profile && (
            <Card>
              <CardHeader
                title="Your application"
                description={profile.status === "applied" ? `Sent ${formatDate(profile.createdAt)}. We'll notify you when it has been reviewed.` : undefined}
                actions={<ApplicationStatusBadge status={profile.status} />}
              />
              <CardBody className="space-y-3 text-sm">
                {profile.status === "rejected" && (
                  <div role="status" className="rounded-lg border border-border bg-surface-2 p-4">
                    <p className="font-medium text-ink">Reviewer&apos;s note</p>
                    <p className="mt-1 whitespace-pre-line text-ink-muted">{profile.rejectionReason || "No reason was given."}</p>
                    <p className="mt-3 text-ink-muted">{canApply ? "Update your application below and send it again." : "Applications are closed right now."}</p>
                  </div>
                )}
                {application && application.expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" aria-label="Subjects">
                    {application.expertise.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          {canApply && (
            <Card>
              <CardHeader
                title={profile ? (profile.status === "rejected" ? "Apply again" : "Edit your application") : "Apply to teach"}
                description="All fields marked with * are required."
              />
              <CardBody>
                <TeachApplicationForm
                  initial={application}
                  payoutEmail={profile?.payoutEmail ?? user.email}
                  sharePercent={profile?.revenueSharePercent ?? m.defaultRevenueSharePercent}
                  submitLabel={profile ? (profile.status === "rejected" ? "Send application again" : "Update application") : "Send application"}
                />
              </CardBody>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title="How it works" />
          <CardBody>
            <ol className="space-y-5">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-medium text-ink">
                      <span className="sr-only">Step {i + 1}: </span>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

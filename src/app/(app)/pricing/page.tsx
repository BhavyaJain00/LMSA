import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getPricingData } from "@/lib/commerce/membership-views";
import { defaultCycle } from "@/lib/commerce/plans";
import { GRACE_DAYS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/commerce/subscriptions";
import { pageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, faqPageJsonLd, seoContext } from "@/lib/seo/jsonld";
import { Markdown } from "@/lib/markdown";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { PricingPlans, type PricingCardPlan } from "@/components/commerce/pricing-plans";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, data] = await Promise.all([getSettings(), getPricingData(null)]);
  return pageMetadata(
    {
      title: "Membership plans",
      description: [
        `Join ${settings.brand.name} with a monthly or yearly membership and learn from every included course: video lessons, quizzes, assignments and certificates. Cancel any time.`,
      ],
      path: "/pricing",
      noindex: !data.enabled || data.plans.length === 0,
    },
    settings,
  );
}

function faq(brand: string, hasTrial: boolean): { question: string; answer: string }[] {
  return [
    {
      question: "What do I get with a membership?",
      answer:
        "A membership unlocks every course its plan includes for as long as it runs: all lessons and videos, quizzes, assignments, discussions and certificates. Open a course and start learning; there is no separate checkout.",
    },
    ...(hasTrial
      ? [
          {
            question: "How does the free trial work?",
            answer:
              "You get full access during the trial and nothing is charged until it ends. Cancel before the last day and you pay nothing. The trial is available once, to first-time members.",
          },
        ]
      : []),
    {
      question: "Can I cancel any time?",
      answer:
        "Yes. Cancel from Settings → Membership with one click. You keep access until the end of the period you already paid for, and you can resume before then if you change your mind.",
    },
    {
      question: "What happens to my progress if my membership ends?",
      answer: `Your progress, notes, quiz results and certificates are kept. Lessons of courses you opened through the membership lock again, and everything is right where you left it when you rejoin ${brand}.`,
    },
    {
      question: "What if a renewal payment fails?",
      answer: `We let you know straight away and keep your courses open for ${GRACE_DAYS} more days while the payment is retried or you update your payment method.`,
    },
    {
      question: "Do I keep the courses I bought separately?",
      answer: "Yes. Courses you purchased on their own, or that you joined through a batch, stay yours whether or not you have a membership.",
    },
    {
      question: "Can I change my plan later?",
      answer: "You can switch between monthly and yearly plans at any time from Settings → Membership. The new plan's courses unlock immediately.",
    },
  ];
}

export default async function PricingPage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const data = await getPricingData(user);
  const brand = settings.brand.name;

  if (!data.enabled || data.plans.length === 0) {
    return (
      <EmptyState
        icon={<Icon.Star />}
        title="Memberships aren't available right now"
        description="There are no membership plans on sale at the moment. You can still enroll in courses one by one."
        action={
          <ButtonLink href="/courses" rightIcon={<Icon.ArrowRight className="size-4" />}>
            Browse courses
          </ButtonLink>
        }
        className="my-10"
      />
    );
  }

  const plans: PricingCardPlan[] = data.plans.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ? <Markdown content={p.description} /> : null,
    interval: p.interval,
    price: p.price,
    currency: p.currency,
    trialDays: p.trialDays,
    features: p.features,
    accessLabel: p.accessLabel === "Every course" ? `Every course in the catalog (${data.courseCount} today)` : `${p.accessLabel} included`,
    courseTitles: p.courseTitles,
    savingsPercent: p.savingsPercent,
  }));
  const current = data.viewer.currentPlanId ? data.plans.find((p) => p.id === data.viewer.currentPlanId) : null;
  const hasTrial = data.plans.some((p) => p.trialDays > 0 && p.interval !== "one_time");
  const questions = faq(brand, hasTrial);
  const ctx = seoContext(settings);
  // Open on the billing cycle of the viewer's own plan when they have one.
  const initialCycle = current && current.interval !== "one_time" ? current.interval : defaultCycle(data.plans);

  return (
    <div className="pb-12">
      <JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Membership plans", path: "/pricing" }], ctx), faqPageJsonLd(questions)]} />

      <header className="mx-auto max-w-2xl pt-4 text-center sm:pt-8">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <Icon.Star className="size-3.5" aria-hidden="true" />
          {brand} membership
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">One membership, every course you need</h1>
        <p className="mt-3 text-base text-ink-muted">
          Pick a plan, open any included course and learn at your own pace. {hasTrial && data.viewer.trialEligible ? "Start with a free trial and cancel any time." : "Cancel any time."}
        </p>
      </header>

      {current && (
        <div className="mx-auto mt-6 flex max-w-2xl flex-col items-start gap-3 rounded-card border border-accent/30 bg-accent/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-ink">
            <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <span>
              You&apos;re on <strong>{current.name}</strong>
              {data.viewer.currentStatus ? ` (${SUBSCRIPTION_STATUS_LABELS[data.viewer.currentStatus].toLowerCase()})` : ""}.
            </span>
          </p>
          <ButtonLink href="/settings/subscription" size="sm" variant="outline">
            Manage membership
          </ButtonLink>
        </div>
      )}

      <section aria-label="Membership plans" className="mt-8">
        <PricingPlans plans={plans} viewer={{ loggedIn: data.viewer.loggedIn, currentPlanId: data.viewer.currentPlanId, trialEligible: data.viewer.trialEligible }} initialCycle={initialCycle} giftable={settings.growth.giftsEnabled} />
      </section>

      <section aria-label="What every plan includes" className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
        {[
          { icon: <Icon.Unlock className="size-5" />, title: "Instant access", text: "Included courses open the moment your membership starts. No extra checkout per course." },
          { icon: <Icon.Award className="size-5" />, title: "Certificates included", text: "Finish a course and earn its certificate, exactly as if you had bought it." },
          { icon: <Icon.Refresh className="size-5" />, title: "Flexible billing", text: "Switch plans, cancel or resume from your settings. Your progress is always kept." },
        ].map((item) => (
          <div key={item.title} className="rounded-card border border-border bg-surface-1 p-5">
            <span className="inline-flex rounded-lg bg-accent/10 p-2 text-accent" aria-hidden="true">
              {item.icon}
            </span>
            <h2 className="mt-3 text-sm font-semibold text-ink">{item.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{item.text}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="pricing-faq-heading" className="mx-auto mt-12 max-w-2xl">
        <h2 id="pricing-faq-heading" className="text-center text-xl font-semibold tracking-tight text-ink">
          Questions about memberships
        </h2>
        <div className="mt-5 divide-y divide-border rounded-card border border-border bg-surface-1">
          {questions.map((item) => (
            <details key={item.question} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <Icon.ChevronDown className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Prefer to buy a single course?{" "}
          <Link href="/courses" className="font-medium text-accent hover:underline">
            Browse the catalog
          </Link>
          {settings.contact.email ? (
            <>
              {" "}
              or write to{" "}
              <a href={`mailto:${settings.contact.email}`} className="font-medium text-accent hover:underline">
                {settings.contact.email}
              </a>{" "}
              with any question.
            </>
          ) : (
            "."
          )}
        </p>
      </section>
    </div>
  );
}

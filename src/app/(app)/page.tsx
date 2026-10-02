import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PublicUser } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getLandingData } from "@/lib/data/catalog";
import { pageMetadata } from "@/lib/seo/metadata";
import { seoContext, websiteJsonLd } from "@/lib/seo/jsonld";
import { getLocale, getT } from "@/i18n/server";
import { courseItemList } from "@/lib/data/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { CourseGrid } from "@/components/catalog/course-grid";
import { LandingHero } from "@/components/catalog/landing/landing-hero";
import {
  LandingBatches,
  LandingCategories,
  LandingCta,
  LandingFeatures,
  LandingSection,
  LandingStatsBand,
  LandingTestimonials,
  SeeAllLink,
} from "@/components/catalog/landing/landing-sections";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const tagline = settings.brand.tagline.trim();
  return pageMetadata(
    {
      title: tagline ? `${settings.brand.name} — ${tagline}` : settings.brand.name,
      absoluteTitle: true,
      description: [settings.seo.defaultDescription, settings.brand.metaDescription],
      path: "/",
      locale,
    },
    settings,
  );
}

/**
 * Home. Signed-in users go straight to the home page the admin configured
 * (Settings → Learning → Default home page); guests get the marketing landing
 * page built from live platform data.
 */
export default async function HomePage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  if (user) redirect(settings.learning.defaultHome === "courses" && settings.features.courses ? "/courses" : "/dashboard");

  const [data, t] = await Promise.all([getLandingData(), getT("public")]);
  const signupEnabled = !settings.learning.disableSignup;
  // With guest access off, /courses, /courses/<slug> and /batches send guests to the login
  // page, so the landing page doesn't advertise individual courses or batches then.
  const guestsCanBrowse = settings.learning.allowGuestAccess;
  const coursesOn = settings.features.courses && guestsCanBrowse;
  const browse = guestsCanBrowse
    ? { hero: { href: "/courses", label: t("home.browseCourses") }, cta: { href: "/courses", label: t("home.exploreCatalog") } }
    : signupEnabled
      ? { hero: { href: "/login?next=%2Fcourses", label: t("home.logInToBrowse") }, cta: { href: "/login?next=%2Fcourses", label: t("home.logInToBrowse") } }
      : null;

  const instructorMap = new Map<string, PublicUser>();
  for (const course of data.featured) for (const instructor of course.instructors) instructorMap.set(instructor.id, instructor);
  const instructors = Array.from(instructorMap.values());

  const ctx = seoContext(settings);
  const structuredData = [
    websiteJsonLd(ctx, { description: settings.seo.defaultDescription || settings.brand.metaDescription, searchPath: coursesOn ? undefined : null }),
    coursesOn && data.featured.length > 0 && courseItemList("Popular courses", data.featured, ctx),
  ];

  return (
    <div className="space-y-16 pb-8 sm:space-y-20">
      <JsonLd data={structuredData} />
      <LandingHero
        brandName={settings.brand.name}
        tagline={settings.brand.tagline || t("home.defaultTagline", { brand: settings.brand.name })}
        description={settings.brand.metaDescription}
        signupEnabled={signupEnabled}
        browse={settings.features.courses ? (browse?.hero ?? null) : null}
        spotlight={coursesOn ? (data.featured[0] ?? null) : null}
        instructors={instructors}
        courseCount={data.stats.courses}
        learnerCount={data.stats.learners}
        averageRating={settings.features.reviews ? data.averageRating : null}
        reviewCount={settings.features.reviews ? data.reviewCount : 0}
      />

      <LandingStatsBand stats={data.stats} showCertificates={settings.features.certifications} />

      {coursesOn && (
        <LandingSection
          id="landing-featured"
          eyebrow={t("home.featured.eyebrow")}
          title={t("home.featured.title")}
          description={t("home.featured.description")}
          action={<SeeAllLink href="/courses">{t("home.featured.seeAll")}</SeeAllLink>}
        >
          <CourseGrid
            courses={data.featured}
            columns="compact"
            empty={
              <EmptyState
                icon={<Icon.BookOpen />}
                title={t("home.featured.emptyTitle")}
                description={t("home.featured.emptyDescription")}
              />
            }
          />
        </LandingSection>
      )}

      {coursesOn && <LandingCategories categories={data.categories} />}

      {settings.features.batches && guestsCanBrowse && <LandingBatches batches={data.batches} />}

      {coursesOn && data.upcoming.length > 0 && (
        <LandingSection
          id="landing-upcoming"
          eyebrow={t("home.upcoming.eyebrow")}
          title={t("home.upcoming.title")}
          description={t("home.upcoming.description")}
          action={<SeeAllLink href="/courses?tab=upcoming">{t("home.upcoming.seeAll")}</SeeAllLink>}
        >
          <CourseGrid courses={data.upcoming} columns="compact" />
        </LandingSection>
      )}

      <LandingFeatures features={settings.features} />

      {settings.features.reviews && guestsCanBrowse && <LandingTestimonials testimonials={data.testimonials} />}

      <LandingCta brandName={settings.brand.name} signupEnabled={signupEnabled} browse={settings.features.courses ? (browse?.cta ?? null) : null} />

      {settings.contact.email && (
        <p className="text-center text-sm text-ink-muted">
          {t.rich("home.contact", {
            email: (
              <a href={`mailto:${settings.contact.email}`} dir="ltr" className="font-medium text-accent hover:underline">
                {settings.contact.email}
              </a>
            ),
          })}
        </p>
      )}
    </div>
  );
}

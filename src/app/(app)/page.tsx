import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PublicUser } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getLandingData } from "@/lib/data/catalog";
import { siteConfig } from "@/lib/config";
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
  const settings = await getSettings();
  const title = `${settings.brand.name} — ${settings.brand.tagline}`;
  return {
    metadataBase: new URL(`${siteConfig.appUrl}/`),
    title: { absolute: title },
    description: settings.brand.metaDescription,
    openGraph: {
      type: "website",
      siteName: settings.brand.name,
      title,
      description: settings.brand.metaDescription,
      images: settings.brand.metaImageUrl ? [new URL(settings.brand.metaImageUrl, `${siteConfig.appUrl}/`).href] : undefined,
    },
  };
}

/**
 * Home. Signed-in users go straight to the home page the admin configured
 * (Settings → Learning → Default home page); guests get the marketing landing
 * page built from live platform data.
 */
export default async function HomePage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  if (user) redirect(settings.learning.defaultHome === "courses" && settings.features.courses ? "/courses" : "/dashboard");

  const data = await getLandingData();
  const signupEnabled = !settings.learning.disableSignup;
  // With guest access off, /courses, /courses/<slug> and /batches send guests to the login
  // page, so the landing page doesn't advertise individual courses or batches then.
  const guestsCanBrowse = settings.learning.allowGuestAccess;
  const coursesOn = settings.features.courses && guestsCanBrowse;
  const browse = guestsCanBrowse
    ? { hero: { href: "/courses", label: "Browse courses" }, cta: { href: "/courses", label: "Explore the catalog" } }
    : signupEnabled
      ? { hero: { href: "/login?next=%2Fcourses", label: "Log in to browse courses" }, cta: { href: "/login?next=%2Fcourses", label: "Log in to browse courses" } }
      : null;

  const instructorMap = new Map<string, PublicUser>();
  for (const course of data.featured) for (const instructor of course.instructors) instructorMap.set(instructor.id, instructor);
  const instructors = Array.from(instructorMap.values());

  return (
    <div className="space-y-16 pb-8 sm:space-y-20">
      <LandingHero
        brandName={settings.brand.name}
        tagline={settings.brand.tagline || `Learn with ${settings.brand.name}`}
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
          eyebrow="Featured"
          title="Popular courses"
          description="Hand-picked courses our learners love. Start with a free preview lesson."
          action={<SeeAllLink href="/courses">Browse all courses</SeeAllLink>}
        >
          <CourseGrid
            courses={data.featured}
            columns="compact"
            empty={
              <EmptyState
                icon={<Icon.BookOpen />}
                title="No Courses Found"
                description="There are no courses currently. Keep an eye out, fresh learning experiences are on the way!"
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
          eyebrow="Coming soon"
          title="Upcoming courses"
          description="Announced courses that open for enrollment soon."
          action={<SeeAllLink href="/courses?tab=upcoming">See upcoming</SeeAllLink>}
        >
          <CourseGrid courses={data.upcoming} columns="compact" />
        </LandingSection>
      )}

      <LandingFeatures features={settings.features} />

      {settings.features.reviews && guestsCanBrowse && <LandingTestimonials testimonials={data.testimonials} />}

      <LandingCta brandName={settings.brand.name} signupEnabled={signupEnabled} browse={settings.features.courses ? (browse?.cta ?? null) : null} />

      {settings.contact.email && (
        <p className="text-center text-sm text-ink-muted">
          Questions? Write to us at{" "}
          <a href={`mailto:${settings.contact.email}`} className="font-medium text-accent hover:underline">
            {settings.contact.email}
          </a>
          .
        </p>
      )}
    </div>
  );
}

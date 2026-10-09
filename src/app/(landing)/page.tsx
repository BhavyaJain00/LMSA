import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
import { LandingHero, type HeroStickers } from "@/components/catalog/landing/landing-hero";
import { SeeAllLink } from "@/components/catalog/landing/landing-sections";
import { SectionHeading } from "@/components/catalog/landing/editorial";
import { LandingApproach, LandingBento, LandingHowItWorks, LandingStories, TiltCourseGrid } from "@/components/catalog/landing/landing-editorial";
import { Reveal } from "@/components/landing3d/reveal";
import { landingFontVariables } from "@/components/catalog/landing/fonts";

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
 * Home. Signed-in users go straight to the home page the admin configured (Settings → Learning → Default home
 * page); guests get the landing page (its own layout: no sidebar, a full-page 3D scene behind the content).
 * Editorial style: a big mixed headline with stickers, our approach, popular courses, what you get (feature
 * cards), how it works, free courses and what students say, each section swinging into place in 3D. Built from
 * live platform data and the site's own tagline.
 */
export default async function HomePage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  if (user) redirect(settings.learning.defaultHome === "courses" && settings.features.courses ? "/courses" : "/dashboard");

  const [data, t] = await Promise.all([getLandingData(), getT("public")]);
  const signupEnabled = !settings.learning.disableSignup;
  // With guest access off, /courses, /courses/<slug> and /batches send guests to the login
  // page, so the landing page doesn't advertise individual courses then.
  const guestsCanBrowse = settings.learning.allowGuestAccess;
  const coursesOn = settings.features.courses && guestsCanBrowse;
  const browse = guestsCanBrowse
    ? { href: "/courses", label: t("home.hero.explore") }
    : signupEnabled
      ? { href: "/login?next=%2Fcourses", label: t("home.logInToBrowse") }
      : null;

  const stickers: HeroStickers = {
    primary: coursesOn && data.stats.courses > 0 ? t("home.hero.sticker.courses", { count: data.stats.courses }) : undefined,
    secondary: coursesOn && data.free.length > 0 ? t("home.hero.sticker.free") : t("home.hero.sticker.selfPaced"),
    circle: settings.features.certifications ? t("home.hero.sticker.certified") : undefined,
  };

  const ctx = seoContext(settings);
  const structuredData = [
    websiteJsonLd(ctx, { description: settings.seo.defaultDescription || settings.brand.metaDescription, searchPath: coursesOn ? undefined : null }),
    coursesOn && data.featured.length > 0 && courseItemList("Popular courses", data.featured, ctx),
  ];

  return (
    <div className={`${landingFontVariables} pb-16`}>
      <JsonLd data={structuredData} />
      <LandingHero
        tagline={settings.brand.tagline || t("home.defaultTagline", { brand: settings.brand.name })}
        description={settings.brand.metaDescription}
        signupEnabled={signupEnabled}
        browse={settings.features.courses ? browse : null}
        stickers={stickers}
      />

      <div className="mx-auto max-w-6xl space-y-24 px-4 sm:space-y-32 sm:px-6 lg:px-8">
        <Reveal>
          <LandingApproach />
        </Reveal>

        {coursesOn && (
          <Reveal>
            <section aria-labelledby="landing-featured">
              <SectionHeading
                id="landing-featured"
                eyebrow={t("home.popular.eyebrow")}
                title={t("home.popular.title")}
                emphasis={t("home.popular.emphasis")}
                action={<SeeAllLink href="/courses">{t("home.viewAll")}</SeeAllLink>}
              />
              <TiltCourseGrid
                courses={data.featured.slice(0, 3)}
                empty={<EmptyState icon={<Icon.BookOpen />} title={t("home.featured.emptyTitle")} description={t("home.featured.emptyDescription")} />}
              />
            </section>
          </Reveal>
        )}

        <Reveal>
          <LandingBento features={settings.features} />
        </Reveal>

        <Reveal>
          <LandingHowItWorks features={settings.features} />
        </Reveal>

        {coursesOn && data.free.length > 0 && (
          <Reveal>
            <section aria-labelledby="landing-free">
              <SectionHeading
                id="landing-free"
                eyebrow={t("home.freeRow.eyebrow")}
                title={t("home.freeRow.title")}
                emphasis={t("home.freeRow.emphasis")}
                action={<SeeAllLink href="/courses?price=free">{t("home.viewAll")}</SeeAllLink>}
              />
              <TiltCourseGrid courses={data.free} />
            </section>
          </Reveal>
        )}

        {settings.features.reviews && guestsCanBrowse && (
          <Reveal>
            <LandingStories testimonials={data.testimonials} />
          </Reveal>
        )}

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
    </div>
  );
}

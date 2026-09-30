import type { Metadata } from "next";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, getInstructorDirectory, requireCatalogAccess } from "@/lib/data/seo";
import { sectionTrail } from "@/lib/seo/breadcrumbs";
import { instructorPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { INSTRUCTORS_PAGE_SIZE, landingHref, paginate, parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { PageLinks } from "@/components/gamification/page-links";
import { InstructorCard } from "@/components/marketing/instructor-card";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { pluralize } from "@/lib/utils";

const PATH = "/instructors";

function searchTerm(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, 80);
}

export async function generateMetadata(props: PageProps<"/instructors">): Promise<Metadata> {
  const [sp, settings] = await Promise.all([props.searchParams, getSettings()]);
  const q = searchTerm(sp.q);
  const instructors = settings.features.courses ? await getInstructorDirectory() : [];
  const { noindex } = listingIndexing({ search: q, page: parsePageParam(sp.page) });
  return pageMetadata(
    {
      title: q ? `Instructors matching “${q}”` : "Instructors",
      description: [
        `Meet the ${instructors.length > 1 ? `${instructors.length} ` : ""}instructors behind ${settings.brand.name}: their background, the courses they teach and what learners say about them.`,
      ],
      path: PATH,
      noindex: noindex || instructors.length === 0 || !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

export default async function InstructorsPage(props: PageProps<"/instructors">) {
  const sp = await props.searchParams;
  const { settings } = await requireCatalogAccess(PATH);
  const q = searchTerm(sp.q);
  const instructors = await getInstructorDirectory(q);
  const paged = paginate(instructors, parsePageParam(sp.page), INSTRUCTORS_PAGE_SIZE);
  const canonicalView = !q && paged.page === 1;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={sectionTrail("Instructors")} />
      {canonicalView && paged.items.length > 0 && (
        <JsonLd data={itemListJsonLd("Instructors", paged.items.map((i) => ({ name: i.name, path: instructorPath(i.username), image: i.avatarUrl })), { origin: siteOrigin() })} />
      )}

      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Instructors</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-ink-muted">The people who design and teach the courses on {settings.brand.name}. Open a profile to see their background and everything they teach.</p>
        </div>
        <form action={PATH} method="get" role="search" className="flex w-full gap-2 lg:w-auto">
          <Input type="search" name="q" defaultValue={q} placeholder="Search by name, skill or subject" aria-label="Search instructors" leftAddon={<Icon.Search className="size-4" />} className="lg:w-72" />
          <button type="submit" className={buttonClasses({ variant: "outline" })}>
            Search
          </button>
        </form>
      </header>

      <p className="mb-4 text-sm text-ink-muted" role="status">
        {instructors.length === 0 ? "No instructors found" : q ? `${pluralize(instructors.length, "instructor")} matching “${q}”` : pluralize(instructors.length, "instructor")}
      </p>

      {instructors.length === 0 ? (
        q ? (
          <EmptyState
            icon={<Icon.Search />}
            title="No instructors match your search"
            description="Try a name, a skill or a subject such as “design”."
            action={
              <ButtonLink href={PATH} variant="outline">
                Show all instructors
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.Presentation />}
            title="No instructors yet"
            description="Instructors are listed here as soon as their first course is published."
            action={<ButtonLink href="/courses">Browse courses</ButtonLink>}
          />
        )
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paged.items.map((instructor) => (
              <li key={instructor.id} className="min-w-0">
                <InstructorCard instructor={instructor} />
              </li>
            ))}
          </ul>
          <PageLinks className="mt-6" page={paged.page} pageCount={paged.pages} hrefFor={(page) => landingHref(PATH, { q, page })} label="Instructor pages" />
        </>
      )}
    </div>
  );
}

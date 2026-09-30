import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageProgram, getProgramBySlug, getProgramCourses, getProgramSummary } from "@/lib/data/programs";
import { pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Tooltip } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { isProgramPublic } from "@/lib/seo/visibility";
import { programPath } from "@/lib/seo/content-index";
import { programTrail } from "@/lib/seo/breadcrumbs";
import { getProgramJsonLd } from "@/lib/data/seo";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { EnrollProgramButton } from "@/components/programs/program-actions";
import { ProgramCourseGrid } from "@/components/programs/program-course-grid";

export async function generateMetadata(props: PageProps<"/programs/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [program, settings] = await Promise.all([getProgramBySlug(slug), getSettings()]);
  if (!program || !isProgramPublic(program) || !settings.features.programs) return notFoundMetadata(program ? program.title : "Program");
  return pageMetadata(
    {
      title: program.title,
      description: [program.description, `A guided learning path of ${program.courseIds.length} ${program.courseIds.length === 1 ? "course" : "courses"} on ${settings.brand.name}. Enroll once and work through the courses step by step.`],
      path: programPath(program.slug),
      generatedImage: true,
    },
    settings,
  );
}

export default async function ProgramPage(props: PageProps<"/programs/[slug]">) {
  const [{ slug }, user, settings] = await Promise.all([props.params, getCurrentUser(), getSettings()]);
  if (!settings.features.programs) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(`/programs/${slug}`)}`);

  const program = await getProgramBySlug(slug);
  if (!program) notFound();
  const summary = await getProgramSummary(program, user);
  const manager = canManageProgram(user, program);
  if (!program.published && !summary.isMember && !manager) notFound();

  const courses = await getProgramCourses(program, user);
  const progress = summary.progress ?? 0;
  const totalLessons = courses.reduce((a, c) => a + c.lessonCount, 0);
  const completed = courses.filter((c) => c.completed).length;
  const structuredData = await getProgramJsonLd(program);

  return (
    <div className="animate-fade-in pb-10">
      <JsonLd data={structuredData} />
      <Breadcrumbs items={programTrail(program)} structuredData={isProgramPublic(program)} />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">{program.title}</h1>
            {summary.isMember && <Badge tone={progress >= 100 ? "success" : "warning"}>{progress}% completed</Badge>}
            {program.enforceCourseOrder && (
              <Tooltip label="Courses must be completed in order" side="bottom">
                <span
                  tabIndex={0}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted"
                  aria-label="Courses must be completed in order. You can only start the next course after completing the previous one."
                >
                  <Icon.Info className="size-3.5" /> In order
                </span>
              </Tooltip>
            )}
            {!program.published && <Badge tone="warning">Unpublished</Badge>}
          </div>
          {program.description && <p className="mt-3 text-base text-ink-muted">{program.description}</p>}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon.BookOpen className="size-4" /> {pluralize(summary.courseCount, "course")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon.FileText className="size-4" /> {pluralize(totalLessons, "lesson")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon.Users className="size-4" /> {pluralize(summary.memberCount, "member")}
            </span>
          </div>
        </div>
        {manager && (
          <ButtonLink href={`/admin/programs/${program.id}`} variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
            Manage program
          </ButtonLink>
        )}
      </header>

      {summary.isMember ? (
        <div className="mt-6 max-w-xl">
          <ProgressBar value={progress} size="md" tone={progress >= 100 ? "success" : "accent"} label="Program progress" />
          <p className="mt-1.5 text-sm text-ink-muted">
            {completed} of {courses.length} courses completed
            {progress >= 100 && " — congratulations on finishing the program!"}
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-info/30 bg-info/10 p-5">
          <p className="text-sm text-ink">
            This program consists of {pluralize(courses.length, "course")}
            {program.enforceCourseOrder
              ? " designed as a structured learning path to guide your progress. Courses in this program must be taken in order, and each course will unlock as you complete the previous one."
              : " designed as a learning path to guide your progress. You may take the courses in any order that suits you."}
          </p>
          {user ? (
            courses.length > 0 ? (
              <EnrollProgramButton programId={program.id} className="mt-3" />
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Enrollment opens once courses are added.</p>
            )
          ) : (
            <ButtonLink href={`/login?next=${encodeURIComponent(`/programs/${program.slug}`)}`} className="mt-4" leftIcon={<Icon.LogIn className="size-4" />}>
              Please log in to enroll in this program
            </ButtonLink>
          )}
        </div>
      )}

      <section className="mt-8" aria-labelledby="program-courses">
        <h2 id="program-courses" className="mb-4 text-xl font-semibold tracking-tight text-ink">
          {summary.isMember ? "Your courses" : "Courses in this Program"}
        </h2>
        {courses.length === 0 ? (
          <EmptyState icon={<Icon.BookOpen />} title="No courses added yet." description="Courses will appear here once the program is set up." />
        ) : (
          <ProgramCourseGrid programId={program.id} courses={courses} isMember={summary.isMember} />
        )}
      </section>
    </div>
  );
}

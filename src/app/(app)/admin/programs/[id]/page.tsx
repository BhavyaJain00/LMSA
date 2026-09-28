import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import {
  canManageProgram,
  getAdminProgramCourses,
  getProgramById,
  getProgramCourseOptions,
  getProgramMemberCandidates,
  getProgramMembers,
} from "@/lib/data/programs";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/batches/breadcrumbs";
import { DeleteProgramButton, ProgramDetailsForm } from "@/components/programs/admin/program-form";
import { ProgramCoursesManager, ProgramMembersManager } from "@/components/programs/admin/program-managers";

export async function generateMetadata(props: PageProps<"/admin/programs/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const program = await getProgramById(id);
  return { title: program ? `${program.title} · Manage` : "Manage program" };
}

export default async function AdminProgramPage(props: PageProps<"/admin/programs/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/programs/${id}`);
  const settings = await getSettings();
  if (!settings.features.programs) notFound();
  const program = await getProgramById(id);
  if (!program) notFound();
  if (!canManageProgram(user, program)) redirect("/forbidden");

  const [courses, options, members, candidates] = await Promise.all([
    getAdminProgramCourses(program),
    getProgramCourseOptions(program, user),
    getProgramMembers(program),
    getProgramMemberCandidates(program),
  ]);

  return (
    <div className="animate-fade-in pb-10">
      <Breadcrumbs items={[{ label: "Programs", href: "/admin/programs" }, { label: program.title }]} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            {program.published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Unpublished</Badge>}
            {program.enforceCourseOrder && (
              <Badge tone="outline">
                <Icon.Lock className="size-3" /> Enforced order
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{program.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/programs/${program.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
            View
          </ButtonLink>
          <DeleteProgramButton programId={program.id} title={program.title} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <ProgramDetailsForm program={program} />
          <ProgramCoursesManager programId={program.id} courses={courses} options={options} enforceOrder={program.enforceCourseOrder} />
        </div>
        <ProgramMembersManager programId={program.id} programTitle={program.title} members={members} candidates={candidates} />
      </div>
    </div>
  );
}

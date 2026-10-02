import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getCourseBySlug } from "@/lib/data/courses";
import { getLearnContext, pickResumeLesson } from "@/lib/data/lessons";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("learning");
  return { title: t("learn.meta.continue") };
}

/**
 * /courses/[slug]/learn → the lesson the viewer should continue with: the one
 * they last opened (if unlocked and incomplete), else the first unlocked
 * incomplete lesson, else the first lesson.
 */
export default async function LearnIndexPage(props: PageProps<"/courses/[slug]/learn">) {
  const { slug } = await props.params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  const viewer = await getCurrentUser();
  const ctx = await getLearnContext(course, viewer);
  if (!course.published && !ctx.manager && !ctx.enrolled) notFound();

  const resume = pickResumeLesson(ctx);
  redirect(resume ? resume.href : `/courses/${course.slug}`);
}

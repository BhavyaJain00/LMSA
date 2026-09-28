import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageQuiz, getQuizEditorData } from "@/lib/data/quiz";
import { QuizBuilder } from "@/components/quiz/builder/quiz-builder";

export async function generateMetadata(props: PageProps<"/admin/quizzes/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === id);
  return { title: quiz ? `${quiz.title} · Quiz builder` : "Quiz builder" };
}

export default async function QuizBuilderPage(props: PageProps<"/admin/quizzes/[id]">) {
  const { id } = await props.params;
  const user = await requireRole(["course_creator", "moderator"], `/admin/quizzes/${id}`);
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === id);
  if (!quiz) notFound();
  if (!canManageQuiz(user, quiz, db)) redirect("/forbidden");
  const data = await getQuizEditorData(user, id);
  if (!data) notFound();
  return <QuizBuilder data={data} viewerName={user.name} />;
}

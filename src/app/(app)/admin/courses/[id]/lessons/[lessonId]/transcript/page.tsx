import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/store";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { canManageCourse, lessonHref } from "@/lib/data/courses";
import { getLessonPosition, requireManageableCourse } from "@/lib/data/admin-courses";
import { blockTranscript, type VideoBlock } from "@/lib/transcripts/data";
import { recoverInterruptedTranscripts, transcriptionAvailability, transcriptionJobState } from "@/lib/transcripts/auto";
import { toEditorTranscript } from "@/lib/transcripts/editor-shared";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { TranscriptEditor } from "@/components/admin/transcripts/transcript-editor";
import { cn } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/courses/[id]/lessons/[lessonId]/transcript">) {
  const { id, lessonId } = await props.params;
  const [db, user] = await Promise.all([getDb(), getCurrentUser()]);
  const lesson = db.lessons.find((l) => l.id === lessonId && l.courseId === id);
  const course = db.courses.find((c) => c.id === id);
  if (!lesson || !course) return { title: "Lesson not found" };
  return { title: canManageCourse(user, course) ? `Transcript: ${lesson.title}` : "Transcript editor", robots: { index: false } };
}

function videoLabel(block: VideoBlock, index: number, total: number): string {
  const title = block.title?.trim();
  if (title) return title;
  return total > 1 ? `Video ${index + 1}` : "Lesson video";
}

export default async function TranscriptEditorPage(props: PageProps<"/admin/courses/[id]/lessons/[lessonId]/transcript">) {
  const { id, lessonId } = await props.params;
  const search = await props.searchParams;
  const requested = typeof search.block === "string" ? search.block : null;
  const selfPath = `/admin/courses/${id}/lessons/${lessonId}/transcript${requested ? `?block=${encodeURIComponent(requested)}` : ""}`;
  const { user, course } = await requireManageableCourse(id, selfPath);
  await recoverInterruptedTranscripts();
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId && l.courseId === course.id);
  if (!lesson) notFound();

  const videos = lesson.blocks.filter((b): b is VideoBlock => b.type === "video");
  const lessonEditHref = `/admin/courses/${course.id}/lessons/${lesson.id}`;
  const block = (requested ? videos.find((v) => v.id === requested) : null) ?? videos[0] ?? null;
  const position = await getLessonPosition(lesson);
  const learnBase = position ? lessonHref(course.slug, position) : null;

  const breadcrumbs = (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
      <Link href="/admin/courses" className="hidden shrink-0 hover:text-ink hover:underline sm:inline">
        Courses
      </Link>
      <Icon.ChevronRight className="hidden size-3.5 shrink-0 sm:block rtl:rotate-180" />
      <Link href={`/admin/courses/${course.id}?tab=outline`} className="max-w-[40%] truncate hover:text-ink hover:underline">
        {course.title}
      </Link>
      <Icon.ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" />
      <Link href={lessonEditHref} className="min-w-0 truncate hover:text-ink hover:underline">
        {lesson.title}
      </Link>
      <Icon.ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" />
      <span className="shrink-0 text-ink">Transcript</span>
    </nav>
  );

  if (!block) {
    return (
      <div>
        {breadcrumbs}
        <EmptyState
          icon={<Icon.Video />}
          title="This lesson has no video"
          description="Transcripts belong to a lesson video. Add a video block in the lesson editor, then come back to write or generate its transcript."
          action={
            <ButtonLink href={lessonEditHref} leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
              Back to the lesson editor
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const blockIndex = videos.indexOf(block);
  const transcript = blockTranscript(db, block);
  const availability = await transcriptionAvailability();
  const job = transcriptionJobState(lesson.id, block.id);
  const learnHref = learnBase ? (blockIndex > 0 ? `${learnBase}?block=${encodeURIComponent(block.id)}` : learnBase) : null;

  return (
    <div>
      {breadcrumbs}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Transcript</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Captions and the interactive transcript learners read under{" "}
            <span className="font-medium text-ink">{videoLabel(block, blockIndex, videos.length)}</span>. Edit the lines, fix their timing against the preview, import a caption file or
            generate one automatically.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ButtonLink href={lessonEditHref} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
            Lesson editor
          </ButtonLink>
          {learnHref && (
            <ButtonLink href={learnHref} variant="ghost" size="sm" rightIcon={<Icon.ArrowUpRight className="size-4" />}>
              View as learner
            </ButtonLink>
          )}
        </div>
      </div>

      {videos.length > 1 && (
        <nav aria-label="Videos in this lesson" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
          {videos.map((v, i) => {
            const current = v.id === block.id;
            const hasTranscript = !!blockTranscript(db, v)?.cues.length;
            return (
              <Link
                key={v.id}
                href={`/admin/courses/${course.id}/lessons/${lesson.id}/transcript?block=${encodeURIComponent(v.id)}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  current ? "border-accent bg-accent/10 font-medium text-ink" : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                <Icon.Video className="size-4" />
                <span className="max-w-48 truncate">{videoLabel(v, i, videos.length)}</span>
                {hasTranscript && <Icon.CheckCircle className="size-3.5 text-success" aria-label="Has a transcript" />}
              </Link>
            );
          })}
        </nav>
      )}

      {!block.src ? (
        <EmptyState
          icon={<Icon.Video />}
          title="This video block has no file yet"
          description="Upload a video or paste its address in the lesson editor first. The transcript is timed against that file."
          action={
            <ButtonLink href={lessonEditHref} leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
              Back to the lesson editor
            </ButtonLink>
          }
        />
      ) : (
        <TranscriptEditor
          key={`${lesson.id}:${block.id}`}
          lessonId={lesson.id}
          lessonTitle={lesson.title}
          video={{
            id: block.id,
            src: block.src,
            hlsUrl: block.hlsUrl,
            posterUrl: block.posterUrl,
            captionsUrl: block.captionsUrl,
            sources: block.sources,
            title: block.title,
            duration: block.duration,
          }}
          initial={transcript ? toEditorTranscript(transcript) : null}
          initialJob={job}
          availability={{
            available: availability.available,
            reason: availability.reason,
            autoEnabled: availability.autoEnabled,
            model: availability.model,
          }}
          settingsHref={isAdmin(user) ? "/admin/settings/storage" : null}
        />
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import type { User } from "@/lib/types";
import { getCurrentUser, isEvaluator } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  getLessonNotes,
  getLessonPageData,
  getLessonTopics,
  getMentionCandidates,
  lessonHasQuiz,
  lessonHasVideo,
  toNeighbor,
  toOutlineItems,
  type LearnContext,
} from "@/lib/data/lessons";
import { ButtonLink } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { getLessonAiPanel } from "@/components/ai/lesson-ai-panel";
import { CompletedBadge, CompletionPanel, type ViewerMode } from "@/components/learn/completion-panel";
import { DiscussionPanel } from "@/components/learn/discussion-panel";
import { LessonBlocks } from "@/components/learn/lesson-blocks";
import { HideInZen, LessonFrame, ZenOnly, ZenPanelToggle, ZenToggle } from "@/components/learn/lesson-frame";
import { InstructorNotesBox, InstructorsRow, LessonBreadcrumbs, LessonMeta } from "@/components/learn/lesson-header";
import { LessonNavButtons, LessonPager, MobilePager } from "@/components/learn/lesson-nav";
import { LessonRuntimeProvider } from "@/components/learn/lesson-runtime";
import { LessonSidebar } from "@/components/learn/lesson-sidebar";
import { LockedLessonNotice } from "@/components/learn/locked-notice";
import { NoPreviewCard } from "@/components/learn/no-preview-card";
import { NotesPanel } from "@/components/learn/notes-panel";
import { SelectableContent } from "@/components/learn/selectable-content";
import type { LessonNeighbor, OutlineChapterItem, SidebarTab } from "@/components/learn/types";
import { KeyboardIcon } from "@/components/learn/learn-icons";
import { getT } from "@/i18n/server";

/** One load per request, shared by generateMetadata and the page. */
const loadLesson = cache(async (slug: string, ref: string) => {
  const viewer = await getCurrentUser();
  const data = await getLessonPageData(slug, ref, viewer);
  return { viewer, data };
});

export async function generateMetadata(props: PageProps<"/courses/[slug]/learn/[ref]">): Promise<Metadata> {
  const { slug, ref } = await props.params;
  const [{ data }, t] = await Promise.all([loadLesson(slug, ref), getT("learning")]);
  switch (data.kind) {
    case "ok":
      return { title: data.lesson.title, description: t("learn.meta.description", { course: data.ctx.course.title, number: data.chapter.number, chapter: data.chapter.title }) };
    case "locked":
    case "no_preview":
      return { title: data.lesson.title, description: data.ctx.course.title, robots: { index: false } };
    case "missing":
      return { title: t("learn.lessonNotFound"), robots: { index: false } };
    default:
      return { title: t("learn.meta.lesson") };
  }
}

function parseTab(raw: string | string[] | undefined): SidebarTab | null {
  return raw === "notes" || raw === "discussion" || raw === "outline" || raw === "ai" ? raw : null;
}

function sidebarProgress(ctx: LearnContext) {
  return ctx.enrolled ? ctx.progress : null;
}

/** The viewer is opening this lesson now; show it as started even before the view is recorded. */
function markCurrentStarted(outline: OutlineChapterItem[], lessonId: string, tracking: boolean): OutlineChapterItem[] {
  if (!tracking) return outline;
  return outline.map((chapter) => ({
    ...chapter,
    lessons: chapter.lessons.map((l) => (l.id === lessonId && l.status === "incomplete" ? { ...l, status: "partial" as const } : l)),
  }));
}

export default async function LessonPage(props: PageProps<"/courses/[slug]/learn/[ref]">) {
  const { slug, ref } = await props.params;
  const sp = await props.searchParams;
  const [{ viewer, data }, t] = await Promise.all([loadLesson(slug, ref), getT("learning")]);

  if (data.kind === "not_found") notFound();
  if (data.kind === "redirect") redirect(data.href);

  const { ctx } = data;
  const course = ctx.course;
  const courseHref = `/courses/${course.slug}`;
  const outline = toOutlineItems(ctx.chapters);
  const showPreview = !ctx.enrolled && !ctx.manager;

  /* ------------------------- locked / missing ------------------------- */
  if (data.kind === "missing" || data.kind === "locked") {
    const locked = data.kind === "locked";
    return (
      <LessonFrame
        sidebar={
          <LessonSidebar
            courseTitle={course.title}
            outline={outline}
            currentLessonId={locked ? data.lesson.id : null}
            progress={sidebarProgress(ctx)}
            tracking={ctx.enrolled}
            showPreview={showPreview}
          />
        }
      >
        <main id="lesson-main" className="px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          <div className="mx-auto w-full max-w-(--lesson-w)">
            <LessonBreadcrumbs courseTitle={course.title} courseHref={courseHref} lessonTitle={locked ? data.lesson.title : t("learn.lessonNotFound")} />
          </div>
          <LockedLessonNotice
            variant={locked ? "locked" : "not_found"}
            href={data.resume?.href ?? null}
            targetTitle={data.resume?.title}
            courseHref={courseHref}
            lock={locked ? data.lockState : undefined}
          />
        </main>
      </LessonFrame>
    );
  }

  /* ----------------------------- no preview ---------------------------- */
  if (data.kind === "no_preview") {
    const db = await getDb();
    const hasPaid = !!viewer && db.payments.some((p) => p.userId === viewer.id && p.itemType === "course" && p.itemId === course.id && p.status === "paid");
    const next = encodeURIComponent(data.lesson.href);
    return (
      <LessonFrame
        sidebar={
          <LessonSidebar
            courseTitle={course.title}
            outline={outline}
            currentLessonId={data.lesson.id}
            progress={null}
            tracking={false}
            showPreview={showPreview}
          />
        }
      >
        <main id="lesson-main" className="px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          <div className="mx-auto w-full max-w-(--lesson-w)">
            <LessonBreadcrumbs courseTitle={course.title} courseHref={courseHref} lessonTitle={data.lesson.title} />
          </div>
          <NoPreviewCard
            course={course}
            lessonTitle={data.lesson.title}
            lessonHref={data.lesson.href}
            loggedIn={!!viewer}
            hasPaid={hasPaid}
            loginHref={`/login?next=${next}`}
            signupHref={ctx.settings.learning.disableSignup ? null : `/register?next=${next}`}
            guestAccessDisabled={!ctx.settings.learning.allowGuestAccess}
            membershipEnded={!!ctx.enrollment && !ctx.enrolled}
            plansAvailable={ctx.settings.growth.subscriptionsEnabled && db.plans.some((p) => p.active)}
          />
        </main>
      </LessonFrame>
    );
  }

  /* -------------------------------- open -------------------------------- */
  const { lesson, chapter, index, total, prev, next, instructors, certificate } = data;
  const settings = ctx.settings;
  const tracking = ctx.enrolled;
  const studentView = ctx.manager && sp.studentView === "1";
  const presentAsManager = ctx.manager && !studentView;
  const loginHref = `/login?next=${encodeURIComponent(lesson.href)}`;

  const notesEnabled = settings.features.notes && ctx.enrolled && !!viewer;
  const discussionsEnabled = settings.features.discussions && (ctx.enrolled || ctx.manager) && !!viewer;
  const discussionsClosed = lessonHasQuiz(lesson);
  const [notes, topics, mentionables, aiPanel] = await Promise.all([
    notesEnabled ? getLessonNotes((viewer as User).id, lesson.id) : Promise.resolve([]),
    discussionsEnabled && !discussionsClosed ? getLessonTopics(lesson.id, course, viewer?.id ?? null) : Promise.resolve([]),
    discussionsEnabled && !discussionsClosed ? getMentionCandidates(course, viewer as User) : Promise.resolve([]),
    // The "Ask AI" tab: null unless the tutor is set up, on for this course and the viewer is enrolled or manages it.
    getLessonAiPanel({ course, lesson, viewer }),
  ]);

  const requestedTab = parseTab(sp.tab);
  const initialTab: SidebarTab =
    requestedTab === "notes" && notesEnabled
      ? "notes"
      : requestedTab === "discussion" && discussionsEnabled
        ? "discussion"
        : requestedTab === "ai" && aiPanel
          ? "ai"
          : "outline";
  const initialTopicId = typeof sp.topic === "string" ? sp.topic : null;

  // Student view is a query flag: keep it on every lesson link so previewing managers stay in it.
  const withView = (href: string) => (studentView ? `${href}?studentView=1` : href);
  const withViewNeighbor = (neighbor: LessonNeighbor | null): LessonNeighbor | null =>
    neighbor && studentView ? { ...neighbor, href: withView(neighbor.href) } : neighbor;
  const lessonOutline = studentView
    ? outline.map((ch) => ({ ...ch, lessons: ch.lessons.map((l) => ({ ...l, href: withView(l.href) })) }))
    : outline;

  const nextNeighbor = withViewNeighbor(toNeighbor(next));
  const nextUnlocksOnComplete = tracking && !!next && next.locked && next.lockReason === "sequential" && lesson.status !== "complete";
  const mode: ViewerMode = tracking ? "learner" : ctx.manager ? (studentView ? "preview" : "instructor") : viewer ? "preview" : "guest";
  const canZen = ctx.manager || ctx.enrolled || isEvaluator(viewer);
  const hasVideo = lessonHasVideo(lesson);

  let certificateButton: ReactNode = null;
  if (settings.features.certifications && viewer) {
    if (certificate) {
      certificateButton = (
        <ButtonLink href={`/certificates/${certificate.code}`} variant="outline" size="sm" leftIcon={<Icon.GraduationCap className="size-4" />}>
          {t("learn.viewCertificate")}
        </ButtonLink>
      );
    } else if (ctx.enrolled && !ctx.manager && course.paidCertificate && ctx.enrollment) {
      certificateButton = (
        <ButtonLink
          href={ctx.enrollment.purchasedCertificate ? `/courses/${course.slug}/certification` : `/billing/certificate/${course.id}`}
          variant="outline"
          size="sm"
          leftIcon={<Icon.GraduationCap className="size-4" />}
        >
          {t("learn.getCertified")}
        </ButtonLink>
      );
    }
  }

  const sidebar = (
    <LessonSidebar
      courseTitle={course.title}
      outline={markCurrentStarted(lessonOutline, lesson.id, tracking)}
      currentLessonId={lesson.id}
      progress={sidebarProgress(ctx)}
      tracking={tracking}
      showPreview={showPreview}
      notesPanel={notesEnabled ? <NotesPanel /> : undefined}
      noteCount={notes.length}
      discussionPanel={
        discussionsEnabled ? (
          <DiscussionPanel
            lessonId={lesson.id}
            topics={topics}
            canPost={ctx.enrolled || ctx.manager}
            canModerate={ctx.manager}
            closedReason={discussionsClosed ? t("learn.discussionsClosed") : null}
            mentionables={mentionables}
            initialTopicId={initialTopicId}
          />
        ) : undefined
      }
      topicCount={topics.length}
      aiPanel={aiPanel ?? undefined}
    />
  );

  return (
    <LessonRuntimeProvider
      key={lesson.id}
      lessonId={lesson.id}
      lessonHref={lesson.href}
      courseHref={courseHref}
      status={lesson.status}
      tracking={tracking}
      hasVideo={hasVideo}
      prev={withViewNeighbor(toNeighbor(prev))}
      next={nextNeighbor}
      nextUnlocksOnComplete={nextUnlocksOnComplete}
      notes={notes}
      notesEnabled={notesEnabled}
      initialTab={initialTab}
    >
      <LessonFrame sidebar={sidebar}>
        <MobilePager index={index} total={total} />
        <main id="lesson-main" className="px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
          {studentView && (
            <div className="mx-auto mb-4 flex w-full max-w-(--lesson-w) flex-wrap items-center justify-between gap-2 rounded-xl border border-info/30 bg-info/8 px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-ink">
                <Icon.Eye className="size-4 text-info" /> {t("learn.studentView.banner")}
              </span>
              <a href={lesson.href} className="font-medium text-accent hover:underline">
                {t("learn.studentView.exit")}
              </a>
            </div>
          )}

          <header className="mx-auto w-full max-w-(--lesson-w)">
            <HideInZen>
              <LessonBreadcrumbs courseTitle={course.title} courseHref={courseHref} lessonTitle={lesson.title} lessonHref={withView(lesson.href)} />
            </HideInZen>
            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <HideInZen>
                  <LessonMeta
                    chapterNumber={chapter.number}
                    chapterTitle={chapter.title}
                    index={index}
                    total={total}
                    durationSeconds={lesson.durationSeconds}
                    preview={showPreview && lesson.includeInPreview}
                  />
                </HideInZen>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink text-balance sm:text-3xl">{lesson.title}</h1>
                <ZenOnly>
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-muted">
                    {chapter.title} - {course.title}
                    {tracking && (
                      <Tooltip label={t("learn.percentCompleted", { percent: ctx.progress.percent })}>
                        <span tabIndex={0} className="inline-flex rounded text-ink-faint" aria-label={t("learn.percentCompleted", { percent: ctx.progress.percent })}>
                          <Icon.Info className="size-4" />
                        </span>
                      </Tooltip>
                    )}
                  </p>
                </ZenOnly>
                <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                  <CompletedBadge />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {ctx.manager && (
                  <ButtonLink href={`/admin/courses/${course.id}/lessons/${lesson.id}`} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                    {t("learn.editorView")}
                  </ButtonLink>
                )}
                {certificateButton}
                {canZen && (notesEnabled || discussionsEnabled) && <ZenPanelToggle tab={discussionsEnabled ? "discussion" : "notes"} />}
                {canZen && <ZenToggle />}
                <LessonNavButtons className="hidden lg:flex" />
              </div>
            </div>
            <HideInZen>
              <div className="mt-4">
                <InstructorsRow instructors={instructors} />
              </div>
            </HideInZen>
            {presentAsManager && lesson.instructorNotes && (
              <div className="mt-6">
                <InstructorNotesBox notes={lesson.instructorNotes} />
              </div>
            )}
          </header>

          <SelectableContent className="mt-8">
            {lesson.blocks.length ? (
              <LessonBlocks
                blocks={lesson.blocks}
                lessonId={lesson.id}
                courseId={course.id}
                loggedIn={!!viewer}
                loginHref={loginHref}
                watches={data.watches}
                preventSkipping={settings.learning.preventSkippingVideos && !presentAsManager}
                quizTitles={data.quizTitles}
                passedQuizIds={data.passedQuizIds}
                exercisesEnabled={settings.features.programmingExercises}
              />
            ) : (
              <div className="mx-auto w-full max-w-(--lesson-w)">
                <EmptyState
                  icon={<Icon.BookOpen />}
                  title={t("learn.empty.title")}
                  description={ctx.manager ? t("learn.empty.manager") : t("learn.empty.learner")}
                  action={
                    ctx.manager ? (
                      <ButtonLink href={`/admin/courses/${course.id}/lessons/${lesson.id}`} size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                        {t("learn.openEditor")}
                      </ButtonLink>
                    ) : undefined
                  }
                />
              </div>
            )}
          </SelectableContent>

          <div className="mx-auto mt-12 w-full max-w-(--lesson-w) space-y-6">
            <CompletionPanel mode={mode} loginHref={loginHref} />
            <LessonPager />
            <p className="hidden items-center justify-center gap-2 text-xs text-ink-faint lg:flex">
              <KeyboardIcon className="size-4" />
              {t.rich("learn.keyboardHint", {
                prev: (text) => <kbd className="rounded border border-border bg-surface-1 px-1.5 font-sans">{text}</kbd>,
                next: (text) => <kbd className="rounded border border-border bg-surface-1 px-1.5 font-sans">{text}</kbd>,
              })}
            </p>
          </div>
        </main>
      </LessonFrame>
    </LessonRuntimeProvider>
  );
}

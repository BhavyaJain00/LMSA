"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult, LessonBlock } from "@/lib/types";
import { saveLessonAction, type SavedLesson } from "@/lib/actions/lessons";
import type { LessonReleaseInfo } from "@/lib/actions/drip";
import { cn, formatDuration, relativeTime, slugify } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, FormError, Input, Switch } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { AssessmentOptions, LessonEditorNavChapter, VideoStat } from "./types";
import { computeLessonDuration } from "./blocks";
import { BlockEditor } from "./block-editor";
import { MarkdownEditor } from "./markdown-editor";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";
import { VideoStatsDialog } from "./video-stats-dialog";
import { LessonHelpDialog } from "./lesson-help-dialog";
import { LessonReleaseSection, useLessonRelease } from "./lesson-release-section";
import { LessonHistoryButton } from "@/components/teaching/version-history";

export interface LessonEditorProps {
  courseId: string;
  lesson: {
    id: string;
    title: string;
    slug: string;
    includeInPreview: boolean;
    instructorNotes: string;
    blocks: LessonBlock[];
    updatedAt: string;
  };
  index: string;
  chapterTitle: string;
  learnHref: string | null;
  outlineHref: string;
  prevHref: string | null;
  nextHref: string | null;
  nav: LessonEditorNavChapter[];
  assessments: AssessmentOptions;
  videoStats: VideoStat[];
  /**
   * Current release schedule (drip) of the lesson and its chapter. When the
   * page does not pass it, the "Release schedule" section loads it itself.
   */
  release?: LessonReleaseInfo | null;
}

interface Draft {
  title: string;
  slug: string;
  includeInPreview: boolean;
  instructorNotes: string;
  blocks: LessonBlock[];
}

const serialize = (d: Draft) => JSON.stringify([d.title.trim(), d.slug.trim(), d.includeInPreview, d.instructorNotes.trim(), d.blocks]);

/**
 * Video and audio editors fill in a missing duration from the file's metadata
 * as soon as they mount. That is not an edit by the author, so a duration that
 * appeared on an unchanged media block does not make the lesson dirty (it is
 * still saved with the next real save).
 */
function withoutDetectedDurations(blocks: LessonBlock[], baseline: LessonBlock[]): LessonBlock[] {
  const before = new Map(baseline.map((b) => [b.id, b]));
  return blocks.map((b) => {
    if ((b.type !== "video" && b.type !== "audio") || !b.duration) return b;
    const prev = before.get(b.id);
    if (!prev || prev.type !== b.type || prev.duration || prev.src !== b.src) return b;
    return { ...b, duration: undefined };
  });
}

/**
 * Server Action request bodies are capped at 1 MB by Next.js. Stay safely below
 * that (the form also carries the title, slug and multipart overhead) so an
 * oversized lesson gets a clear message instead of a failed request.
 */
const MAX_LESSON_PAYLOAD_BYTES = 900 * 1024;

export function LessonEditor({ courseId, lesson, index, chapterTitle, learnHref, outlineHref, prevHref, nextHref, nav, assessments, videoStats, release: providedRelease }: LessonEditorProps) {
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<Draft | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const [title, setTitle] = useState(lesson.title);
  const [slug, setSlug] = useState(lesson.slug);
  const [includeInPreview, setIncludeInPreview] = useState(lesson.includeInPreview);
  const [instructorNotes, setInstructorNotes] = useState(lesson.instructorNotes);
  const [blocks, setBlocks] = useState<LessonBlock[]>(lesson.blocks);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState(lesson.updatedAt);
  const [statsOpen, setStatsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [sizeError, setSizeError] = useState<string | null>(null);
  const release = useLessonRelease(lesson.id, providedRelease);

  const draft: Draft = { title, slug, includeInPreview, instructorNotes, blocks };
  const [baselineDraft, setBaselineDraft] = useState<Draft>(() => ({
    title: lesson.title,
    slug: lesson.slug,
    includeInPreview: lesson.includeInPreview,
    instructorNotes: lesson.instructorNotes,
    blocks: lesson.blocks,
  }));
  const baseline = serialize(baselineDraft);
  const snapshot = serialize({ ...draft, blocks: withoutDetectedDurations(blocks, baselineDraft.blocks) });
  const dirty = snapshot !== baseline || release.dirty;

  const [state, formAction, pending] = useActionState(async (prev: ActionResult<SavedLesson> | null, formData: FormData): Promise<ActionResult<SavedLesson> | null> => {
    const result = await saveLessonAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      const sent = submitted.current;
      const saved: Draft = {
        title: result.data.title,
        slug: result.data.slug,
        includeInPreview: sent?.includeInPreview ?? includeInPreview,
        instructorNotes: sent?.instructorNotes ?? instructorNotes,
        blocks: result.data.blocks,
      };
      setTitle(saved.title);
      setSlug(saved.slug);
      setBlocks(saved.blocks);
      setRevision((r) => r + 1);
      setBaselineDraft(saved);
      setSavedAt(result.data.updatedAt);
      if (release.status === "ready") release.markSaved({ dripDays: result.data.dripDays, availableFrom: result.data.availableFrom });
      toast.success(result.message ?? "Lesson saved");
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const [releaseReveal, setReleaseReveal] = useState(0);
  const releaseErrors = { dripDays: fieldErrors.dripDays, availableFrom: fieldErrors.availableFrom };
  const blockErrors: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) if (key.startsWith("block.")) blockErrors[key.slice(6)] = message;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const duration = computeLessonDuration(blocks);
  const hasVideo = blocks.some((b) => b.type === "video");

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        if (release.invalid) {
          e.preventDefault();
          setReleaseReveal((n) => n + 1);
          toast.error("Check the release schedule before saving");
          return;
        }
        const bytes = new Blob([JSON.stringify(blocks), instructorNotes, title, slug]).size;
        if (bytes > MAX_LESSON_PAYLOAD_BYTES) {
          // Cancels the form action: the request would be rejected by the server anyway.
          e.preventDefault();
          const message = `This lesson is too large to save (${Math.ceil(bytes / 1024)} KB of content; max ${MAX_LESSON_PAYLOAD_BYTES / 1024} KB). Split it into several lessons or move long text into an uploaded PDF or file.`;
          setSizeError(message);
          toast.error("This lesson is too large to save");
          return;
        }
        setSizeError(null);
        submitted.current = draft;
      }}
      onKeyDown={(e) => {
        // Enter in a single-line field should not save the whole lesson.
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio") e.preventDefault();
      }}
      noValidate
    >
      <UnsavedChangesGuard dirty={dirty && !pending} message="This lesson has unsaved changes. If you leave now, they will be lost." />
      <input type="hidden" name="lessonId" value={lesson.id} />
      <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      {includeInPreview && <input type="hidden" name="includeInPreview" value="on" />}

      <div className="sticky top-14 z-20 -mx-4 mb-6 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={outlineHref} variant="ghost" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
            Outline
          </ButtonLink>
          <div className="hidden items-center gap-1 sm:flex">
            {prevHref ? (
              <Link href={prevHref} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous lesson" title="Previous lesson">
                <Icon.ChevronLeft className="size-4" />
              </Link>
            ) : (
              <span className="inline-flex size-8 items-center justify-center text-ink-faint opacity-40" aria-hidden="true">
                <Icon.ChevronLeft className="size-4" />
              </span>
            )}
            <span className="font-mono text-xs text-ink-muted">{index}</span>
            {nextHref ? (
              <Link href={nextHref} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label="Next lesson" title="Next lesson">
                <Icon.ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className="inline-flex size-8 items-center justify-center text-ink-faint opacity-40" aria-hidden="true">
                <Icon.ChevronRight className="size-4" />
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirty ? (
              <Badge tone="warning" dot>
                Not Saved
              </Badge>
            ) : (
              // Relative time depends on the clock, so server and client can render different text.
              <span className="hidden text-xs text-ink-muted md:inline" suppressHydrationWarning>
                Saved {relativeTime(savedAt)}
              </span>
            )}
            <LessonHistoryButton
              lessonId={lesson.id}
              dirty={dirty}
              onRestored={(restored) => {
                // The restored content becomes the saved state of the editor (slug and preview are not versioned).
                setTitle(restored.title);
                setInstructorNotes(restored.instructorNotes);
                setBlocks(restored.blocks);
                setRevision((r) => r + 1);
                setBaselineDraft((base) => ({ ...base, title: restored.title, instructorNotes: restored.instructorNotes, blocks: restored.blocks }));
                setSavedAt(restored.updatedAt);
              }}
            />
            {hasVideo && (
              <Button variant="ghost" size="sm" onClick={() => setStatsOpen(true)} leftIcon={<Icon.TrendingUp className="size-4" />} title="Video Statistics">
                <span className="hidden sm:inline">Video Statistics</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)} leftIcon={<Icon.Question className="size-4" />} title="How to edit a lesson" className="hidden md:inline-flex">
              <span className="sr-only">How to edit a lesson</span>
            </Button>
            {learnHref && (
              <a
                href={learnHref}
                target="_blank"
                rel="noopener"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm font-medium text-ink hover:bg-surface-2"
                title={dirty ? "Opens the last saved version" : "View lesson as a student"}
              >
                <Icon.Eye className="size-4" />
                <span className="hidden sm:inline">View lesson</span>
              </a>
            )}
            <Button type="submit" size="sm" loading={pending} disabled={!dirty} title={dirty ? "Save (Ctrl+S)" : "No changes to save"} leftIcon={<Icon.Check className="size-4" />}>
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <FormError message={sizeError ?? (state && !state.ok ? state.error : null)} />
          <Card>
            <CardBody className="space-y-5">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Lesson {index} · {chapterTitle}
                </p>
                <label htmlFor="lesson-title" className="sr-only">
                  Lesson title
                </label>
                <textarea
                  id="lesson-title"
                  name="title"
                  value={title}
                  rows={1}
                  maxLength={160}
                  placeholder="Lesson title"
                  aria-invalid={!!fieldErrors.title || undefined}
                  onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  className="field-sizing-content block w-full resize-none bg-transparent text-2xl font-bold tracking-tight text-ink placeholder:text-ink-faint focus:outline-none"
                />
                {fieldErrors.title && <p className="mt-1 text-xs text-danger">{fieldErrors.title}</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Slug" htmlFor="lesson-slug" error={fieldErrors.slug} hint="Unique within the course. Used for reference and exports.">
                  <Input
                    id="lesson-slug"
                    name="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"))}
                    onBlur={() => setSlug((s) => (s.trim() ? slugify(s) : slugify(title)))}
                    maxLength={80}
                    invalid={!!fieldErrors.slug}
                  />
                </Field>
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <Switch
                    id="lesson-preview"
                    checked={includeInPreview}
                    onChange={(e) => setIncludeInPreview(e.target.checked)}
                    label="Include in preview"
                    description="When on, anyone can preview this lesson without enrolling. Otherwise it is visible only to enrolled students."
                  />
                </div>
              </div>
              <details className="group rounded-xl border border-border" open={!!lesson.instructorNotes || undefined}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <Icon.Note className="size-4 text-ink-muted" />
                  <span className="text-sm font-medium text-ink">Instructor notes</span>
                  <Badge tone="neutral" size="xs">
                    private
                  </Badge>
                  <Icon.ChevronRight className="ml-auto size-4 text-ink-faint transition-transform group-open:rotate-90" />
                </summary>
                <div className="border-t border-border p-3">
                  <p className="mb-2 text-xs text-ink-muted">Only instructors and moderators see these notes on the lesson page.</p>
                  <MarkdownEditor name="instructorNotes" value={instructorNotes} onChange={setInstructorNotes} rows={5} compact ariaLabel="Instructor notes" invalid={!!fieldErrors.instructorNotes} placeholder="Teaching tips, common mistakes, links to resources…" />
                  {fieldErrors.instructorNotes && <p className="mt-1 text-xs text-danger">{fieldErrors.instructorNotes}</p>}
                </div>
              </details>
              <LessonReleaseSection state={release} errors={releaseErrors} reveal={releaseReveal} preview={includeInPreview} />
            </CardBody>
          </Card>

          <BlockEditor
            key={revision}
            blocks={blocks}
            onChange={setBlocks}
            errors={blockErrors}
            assessments={assessments}
            courseId={courseId}
            refreshingAssessments={refreshing}
            onRefreshAssessments={() => startRefresh(() => router.refresh())}
          />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:self-start lg:overflow-y-auto">
          <Card className="p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Blocks</dt>
                <dd className="font-semibold text-ink">{blocks.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Est. duration</dt>
                <dd className="font-semibold text-ink">{duration > 0 ? formatDuration(duration) : "—"}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink">Chapters</p>
              <Link href={outlineHref} className="text-xs font-medium text-accent hover:underline">
                Edit outline
              </Link>
            </div>
            <nav aria-label="Lessons in this course" className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
              {nav.map((chapter) => (
                <div key={chapter.id} className="mb-2 last:mb-0">
                  <p className="truncate px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{chapter.title}</p>
                  <ul>
                    {chapter.lessons.map((l) => {
                      const current = l.id === lesson.id;
                      return (
                        <li key={l.id}>
                          <Link
                            href={l.editHref}
                            aria-current={current ? "page" : undefined}
                            className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", current ? "bg-surface-2 font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink")}
                          >
                            <span className="w-7 shrink-0 font-mono text-[11px] text-ink-faint">{l.index}</span>
                            <span className="truncate">{current ? title || "Untitled lesson" : l.title}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </Card>
        </aside>
      </div>

      <LessonHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {hasVideo && <VideoStatsDialog open={statsOpen} onClose={() => setStatsOpen(false)} stats={videoStats} />}
    </form>
  );
}

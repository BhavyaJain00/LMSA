import type { ReactNode } from "react";
import type { LessonBlock } from "@/lib/types";
import type { VideoWatchInfo } from "@/lib/data/lessons";
import { getCurrentUser } from "@/lib/auth/session";
import { prepareLessonVideos } from "@/lib/media/sign";
import { getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";
import { QuizBlock } from "@/components/quiz/quiz-block";
import { AssignmentBlock } from "@/components/assessments/assignment-block";
import { ExerciseBlock } from "@/components/assessments/exercise-block";
import { VideoBlock } from "./blocks/video-block";
import { CodeBlock } from "./blocks/code-block";
import {
  AudioBlock,
  BlockFrame,
  CalloutBlock,
  DisabledBlock,
  EmbedBlock,
  FileBlock,
  ImageBlock,
  LoginRequiredBlock,
  MarkdownBlock,
  PdfBlock,
} from "./blocks/content-blocks";

export interface LessonBlocksProps {
  blocks: LessonBlock[];
  lessonId: string;
  courseId: string;
  /** Visitors who are not logged in get a login prompt instead of assessments. */
  loggedIn: boolean;
  loginHref: string;
  watches: Record<string, VideoWatchInfo>;
  preventSkipping: boolean;
  quizTitles: Record<string, string>;
  passedQuizIds: string[];
  exercisesEnabled: boolean;
  /**
   * The lesson header, shown under the player when the lesson opens with a video (the page renders
   * it above the content otherwise). Use `leadsWithVideo` to decide.
   */
  leadHeader?: ReactNode;
}

/** Whether the lesson opens with a video: its header then goes right under the player. */
export function leadsWithVideo(blocks: LessonBlock[]): boolean {
  return blocks[0]?.type === "video";
}

/** Resume position for a video: only when meaningfully into it and not at the very end. */
function resumePosition(watch: VideoWatchInfo | undefined, duration: number | undefined): number | undefined {
  if (!watch) return undefined;
  const pos = watch.lastPositionSeconds;
  if (pos <= 5) return undefined;
  if (duration && pos >= duration - 5) return undefined;
  return pos;
}

/** Renders a lesson's content blocks (server component; interactive blocks hydrate on the client). */
export async function LessonBlocks({
  blocks,
  lessonId,
  courseId,
  loggedIn,
  loginHref,
  watches,
  preventSkipping,
  quizTitles,
  passedQuizIds,
  exercisesEnabled,
  leadHeader,
}: LessonBlocksProps) {
  const primaryVideoId = blocks.find((b) => b.type === "video")?.id;
  const lastVideoId = blocks.findLast((b) => b.type === "video")?.id;
  // Signed URLs for protected uploads + watermark/preview/autoplay options (Settings → Video).
  const [videos, t] = await Promise.all([prepareLessonVideos(blocks, lessonId, loggedIn ? await getCurrentUser() : null), getT("learning")]);

  const leadId = leadHeader && leadsWithVideo(blocks) ? blocks[0]!.id : null;

  const renderBlock = (block: LessonBlock): ReactNode => {
    switch (block.type) {
      case "markdown":
        return <MarkdownBlock content={block.content} />;
      case "callout":
        return <CalloutBlock tone={block.tone} content={block.content} />;
      case "video": {
        const watch = watches[block.id];
        const quizNodes: Record<string, ReactNode> = {};
        for (const marker of block.quizMarkers ?? []) {
          if (quizNodes[marker.quizId]) continue;
          quizNodes[marker.quizId] = loggedIn ? (
            <QuizBlock inVideo quizId={marker.quizId} lessonId={lessonId} courseId={courseId} />
          ) : (
            <LoginRequiredBlock kind="quiz" loginHref={loginHref} />
          );
        }
        return (
          <VideoBlock
            blockId={block.id}
            src={videos.media[block.id]?.src ?? block.src}
            sources={videos.media[block.id]?.sources}
            hlsUrl={videos.media[block.id]?.hlsUrl}
            transcriptId={block.transcriptId}
            player={videos.player}
            lastVideo={block.id === lastVideoId}
            posterUrl={block.posterUrl}
            captionsUrl={block.captionsUrl}
            title={block.title}
            chapters={block.chapters}
            quizMarkers={block.quizMarkers}
            startAt={resumePosition(watch, block.duration)}
            initialMaxPosition={watch?.maxPositionSeconds}
            preventSkipping={preventSkipping}
            primary={block.id === primaryVideoId}
            quizNodes={quizNodes}
            quizTitles={quizTitles}
            passedQuizIds={passedQuizIds}
            header={block.id === leadId ? leadHeader : undefined}
          />
        );
      }
      case "audio":
        return <AudioBlock src={block.src} title={block.title} duration={block.duration} />;
      case "pdf":
        return <PdfBlock src={block.src} title={block.title} />;
      case "image":
        return <ImageBlock src={block.src} alt={block.alt} caption={block.caption} />;
      case "file":
        return <FileBlock src={block.src} title={block.title} sizeBytes={block.sizeBytes} />;
      case "code":
        return (
          <BlockFrame interactive>
            <CodeBlock language={block.language} code={block.code} />
          </BlockFrame>
        );
      case "embed":
        return <EmbedBlock src={block.src} title={block.title} height={block.height} />;
      case "quiz":
        return loggedIn ? (
          <BlockFrame interactive>
            <QuizBlock quizId={block.quizId} lessonId={lessonId} courseId={courseId} />
          </BlockFrame>
        ) : (
          <LoginRequiredBlock kind="quiz" loginHref={loginHref} />
        );
      case "assignment":
        return loggedIn ? (
          <BlockFrame interactive>
            <AssignmentBlock assignmentId={block.assignmentId} lessonId={lessonId} courseId={courseId} />
          </BlockFrame>
        ) : (
          <LoginRequiredBlock kind="assignment" loginHref={loginHref} />
        );
      case "exercise":
        if (!exercisesEnabled) {
          return <DisabledBlock title={t("learn.exercisesOff.title")} description={t("learn.exercisesOff.body")} />;
        }
        return loggedIn ? (
          <BlockFrame interactive>
            <ExerciseBlock exerciseId={block.exerciseId} lessonId={lessonId} courseId={courseId} />
          </BlockFrame>
        ) : (
          <LoginRequiredBlock kind="exercise" loginHref={loginHref} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      {blocks.map((block) =>
        // The opening video carries the lesson header (the h1), so it is not a labelled region of its own;
        // the player inside is already a named region.
        block.id === leadId ? (
          <div key={block.id} id={`block-${block.id}`} className="scroll-mt-24">
            {renderBlock(block)}
          </div>
        ) : (
          <section key={block.id} id={`block-${block.id}`} className="scroll-mt-24" aria-label={blockLabel(block, t)}>
            {renderBlock(block)}
          </section>
        ),
      )}
    </div>
  );
}

function blockLabel(block: LessonBlock, t: Translator<MessageKey<"learning">>): string | undefined {
  switch (block.type) {
    case "video":
      return block.title ? t("learn.block.videoNamed", { title: block.title }) : t("learn.block.video");
    case "audio":
      return block.title ? t("learn.block.audioNamed", { title: block.title }) : t("learn.audio");
    case "pdf":
      return block.title ? t("learn.block.pdfNamed", { title: block.title }) : t("learn.pdf.document");
    case "quiz":
      return t("learn.kind.quiz");
    case "assignment":
      return t("learn.kind.assignment");
    case "exercise":
      return t("learn.kind.exercise");
    case "file":
      return t("learn.block.fileNamed", { title: block.title });
    default:
      return undefined;
  }
}

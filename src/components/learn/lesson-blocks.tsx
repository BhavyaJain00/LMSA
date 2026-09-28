import type { ReactNode } from "react";
import type { LessonBlock } from "@/lib/types";
import type { VideoWatchInfo } from "@/lib/data/lessons";
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
export function LessonBlocks({
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
}: LessonBlocksProps) {
  const primaryVideoId = blocks.find((b) => b.type === "video")?.id;

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
            <QuizBlock quizId={marker.quizId} lessonId={lessonId} courseId={courseId} />
          ) : (
            <LoginRequiredBlock kind="quiz" loginHref={loginHref} />
          );
        }
        return (
          <VideoBlock
            blockId={block.id}
            src={block.src}
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
          return <DisabledBlock title="Programming exercises are turned off" description="An administrator has disabled programming exercises on this site." />;
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
      {blocks.map((block) => (
        <section key={block.id} id={`block-${block.id}`} className="scroll-mt-24" aria-label={blockLabel(block)}>
          {renderBlock(block)}
        </section>
      ))}
    </div>
  );
}

function blockLabel(block: LessonBlock): string | undefined {
  switch (block.type) {
    case "video":
      return block.title ? `Video: ${block.title}` : "Video";
    case "audio":
      return block.title ? `Audio: ${block.title}` : "Audio";
    case "pdf":
      return block.title ? `PDF: ${block.title}` : "PDF document";
    case "quiz":
      return "Quiz";
    case "assignment":
      return "Assignment";
    case "exercise":
      return "Programming exercise";
    case "file":
      return `File: ${block.title}`;
    default:
      return undefined;
  }
}

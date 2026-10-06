"use client";

import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import type { LessonBlockType } from "@/lib/types";
import { BlockIcon } from "./block-icon";

interface HelpSection {
  title: string;
  icon: LessonBlockType | "save" | "preview";
  body: ReactNode;
}

const SECTIONS: HelpSection[] = [
  {
    title: "Build the lesson from blocks",
    icon: "markdown",
    body: (
      <>
        <p>
          A lesson is an ordered list of blocks. Use <strong>Add block</strong> at the bottom, or <strong>Insert block below</strong> under any block, to add text, media or an
          assessment. Reorder blocks with the up and down arrows, duplicate one to reuse its settings, and collapse long blocks to get an overview.
        </p>
        <p>
          Text blocks use Markdown. The toolbar adds bold, italic, headings, lists, quotes, links and code; <kbd>Ctrl</kbd>+<kbd>B</kbd>, <kbd>Ctrl</kbd>+<kbd>I</kbd>,{" "}
          <kbd>Ctrl</kbd>+<kbd>K</kbd> and <kbd>Ctrl</kbd>+<kbd>E</kbd> work too. Switch to <strong>Preview</strong> to see exactly what learners get.
        </p>
      </>
    ),
  },
  {
    title: "Add a video",
    icon: "video",
    body: (
      <>
        <p>
          Upload an MP4, WebM or OGG file, or paste a direct link to one. YouTube and Vimeo links are not supported because every video plays in the platform&apos;s own player, which
          tracks how much each learner watched.
        </p>
        <p>
          The duration is detected automatically once the file loads; you can also type it as <code>mm:ss</code>. Add a poster image, WebVTT captions, named chapters for the seek bar and
          quizzes that pause playback at a given time. Open <strong>Preview in player</strong> and pause where you want a chapter or quiz, then use the add button to drop it at the
          current time.
        </p>
      </>
    ),
  },
  {
    title: "Attach quizzes, assignments and exercises",
    icon: "quiz",
    body: (
      <p>
        Quiz, Assignment and Exercise blocks link to items you create in their own editors. Choose one from the searchable list (filter it to this course), or use{" "}
        <strong>Create new</strong> to open the editor in a new tab, then press <strong>Refresh list</strong> to pick it up. Quizzes can also be placed inside a video from the video block.
      </p>
    ),
  },
  {
    title: "Files, images, audio and embeds",
    icon: "file",
    body: (
      <p>
        Image, PDF, Audio and File blocks accept an upload or a URL. Add alt text to images for screen readers, and a title to files so the download button is clear. Embed blocks show any
        page that allows being framed, such as an interactive playground, at the height you choose.
      </p>
    ),
  },
  {
    title: "Saving and preview",
    icon: "save",
    body: (
      <>
        <p>
          Press <strong>Save</strong> or <kbd>Ctrl</kbd>+<kbd>S</kbd> to store the lesson. A <strong>Not Saved</strong> badge shows while there are pending changes, and you are asked
          before leaving the page with unsaved work. Saving also recalculates the lesson&apos;s estimated time from video lengths and reading time.
        </p>
        <p>If a block needs attention, it is outlined in red with the reason; fix it and save again.</p>
      </>
    ),
  },
  {
    title: "Preview, visibility and instructor notes",
    icon: "preview",
    body: (
      <p>
        Turn on <strong>Include in preview</strong> to let anyone open the lesson without enrolling. <strong>View lesson</strong> opens the last saved version as learners see it.
        Instructor notes are private: only instructors and moderators see them on the lesson page.
      </p>
    ),
  },
];

function SectionIcon({ icon }: { icon: HelpSection["icon"] }) {
  if (icon === "save") return <Icon.Check className="size-4" />;
  if (icon === "preview") return <Icon.Eye className="size-4" />;
  return <BlockIcon type={icon} className="size-4" />;
}

/** "How to edit a lesson" guide opened from the lesson editor header. */
export function LessonHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How to edit a lesson" description="A quick guide to the lesson editor." size="lg">
      <div className="space-y-2">
        {SECTIONS.map((section, i) => (
          <details key={section.title} className="group rounded-xl border border-border" open={i === 0 || undefined}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                <SectionIcon icon={section.icon} />
              </span>
              <span className="flex-1 text-sm font-medium text-ink">{section.title}</span>
              <Icon.ChevronRight className="size-4 text-ink-faint transition-transform group-open:rotate-90 rtl:rotate-180" />
            </summary>
            <div className="space-y-2 border-t border-border px-4 py-3 text-sm leading-relaxed text-ink-muted [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-border-strong [&_kbd]:bg-surface-2 [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[11px] [&_strong]:font-medium [&_strong]:text-ink">
              {section.body}
            </div>
          </details>
        ))}
      </div>
    </Dialog>
  );
}

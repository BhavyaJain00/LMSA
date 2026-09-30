"use client";

import Link from "next/link";
import type { ChatMessageView, ConversationSummary, QuotaView } from "@/lib/ai/types";
import { Icon } from "@/components/ui/icons";
import { AiChatView } from "./ai-chat";
import { useAiChat } from "./use-ai-chat";

export interface AiTutorPanelProps {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  lessonId: string;
  starterQuestions: string[];
  initialConversation: ConversationSummary | null;
  initialMessages: ChatMessageView[];
  initialQuota: QuotaView | null;
}

/** "Ask AI" tab of the lesson sidebar: a compact chat about the current lesson. */
export function AiTutorPanel({ courseId, courseSlug, courseTitle, lessonId, starterQuestions, initialConversation, initialMessages, initialQuota }: AiTutorPanelProps) {
  const chat = useAiChat({ courseId, lessonId, initialConversation, initialMessages, initialQuota });
  const fullPage = `/courses/${courseSlug}/ask${chat.conversation ? `?c=${chat.conversation.id}` : `?lesson=${lessonId}`}`;

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs font-medium text-ink-muted">{chat.conversation ? chat.conversation.title : "New conversation"}</p>
        <div className="flex shrink-0 items-center gap-1">
          {chat.conversation && (
            <button
              type="button"
              onClick={() => chat.load({ conversation: null, messages: [] })}
              disabled={chat.pending}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              <Icon.Plus className="size-3.5" /> New
            </button>
          )}
          <Link href={fullPage} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Icon.ExternalLink className="size-3.5" /> Full page
          </Link>
        </div>
      </div>
      <AiChatView chat={chat} starterQuestions={starterQuestions} courseTitle={courseTitle} compact className="min-h-0 flex-1" />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSseParser } from "@/lib/ai/sse";
import type { AiErrorCode, ChatMessageView, ChatStreamEvent, CitationView, ConversationSummary, QuotaView } from "@/lib/ai/types";

export interface ChatError {
  code: AiErrorCode | "network";
  message: string;
  /** Epoch ms after which "Try again" is enabled. */
  retryAt?: number;
  /** The question that failed, for "Try again". */
  question: string;
}

export interface StreamingAnswer {
  text: string;
  citations: CitationView[];
}

export interface UseAiChatOptions {
  courseId: string;
  lessonId?: string | null;
  initialConversation?: ConversationSummary | null;
  initialMessages?: ChatMessageView[];
  initialQuota?: QuotaView | null;
  /** Called when the server created a conversation or updated its summary. */
  onConversation?: (conversation: ConversationSummary) => void;
}

/**
 * Client state for one AI tutor conversation: sends questions to
 * `/api/ai/chat`, reads the SSE stream and batches text updates per animation
 * frame so long answers render smoothly.
 */
export function useAiChat({ courseId, lessonId, initialConversation = null, initialMessages = [], initialQuota = null, onConversation }: UseAiChatOptions) {
  const [conversation, setConversation] = useState<ConversationSummary | null>(initialConversation);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [streaming, setStreaming] = useState<StreamingAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [quota, setQuota] = useState<QuotaView | null>(initialQuota);
  const [announcement, setAnnouncement] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const textRef = useRef("");
  const frameRef = useRef<number | null>(null);
  const conversationRef = useRef<ConversationSummary | null>(initialConversation);
  const onConversationRef = useRef(onConversation);

  useEffect(() => {
    onConversationRef.current = onConversation;
  }, [onConversation]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const flushText = useCallback(() => {
    frameRef.current = null;
    const text = textRef.current;
    setStreaming((s) => (s ? { ...s, text } : { text, citations: [] }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flushText);
  }, [flushText]);

  /** Replace the conversation shown (e.g. picked from the history list). */
  const load = useCallback((next: { conversation: ConversationSummary | null; messages: ChatMessageView[] }) => {
    abortRef.current?.abort();
    conversationRef.current = next.conversation;
    setConversation(next.conversation);
    setMessages(next.messages);
    setStreaming(null);
    setPending(false);
    setError(null);
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessageView>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPending(true);
      setAnnouncement("");
      textRef.current = "";
      const optimisticId = `local-${Date.now()}`;
      setMessages((list) => [...list, { id: optimisticId, role: "user", content: text, createdAt: new Date().toISOString(), citations: [] }]);
      setStreaming({ text: "", citations: [] });

      let finished = false;
      const fail = (code: ChatError["code"], message: string, retryAfter?: number) => {
        setMessages((list) => list.filter((m) => m.id !== optimisticId));
        setError({ code, message, question: text, retryAt: retryAfter ? Date.now() + retryAfter * 1000 : undefined });
        setAnnouncement(message);
      };

      const handle = (event: ChatStreamEvent) => {
        switch (event.type) {
          case "start":
            conversationRef.current = event.conversation;
            setConversation(event.conversation);
            onConversationRef.current?.(event.conversation);
            setQuota(event.quota);
            setMessages((list) => list.map((m) => (m.id === optimisticId ? event.userMessage : m)));
            break;
          case "citations":
            setStreaming((s) => ({ text: s?.text ?? "", citations: event.citations }));
            break;
          case "delta":
            textRef.current += event.text;
            scheduleFlush();
            break;
          case "done": {
            finished = true;
            setMessages((list) => [...list, event.message]);
            setQuota(event.quota);
            const summary = conversationRef.current;
            if (summary) {
              const updated = { ...summary, updatedAt: event.message.createdAt, messageCount: summary.messageCount + 1 };
              conversationRef.current = updated;
              setConversation(updated);
              onConversationRef.current?.(updated);
            }
            setAnnouncement("The tutor finished answering.");
            break;
          }
          case "error":
            finished = true;
            fail(event.code, event.message, event.retryAfter);
            break;
        }
      };

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId, conversationId: conversationRef.current?.id ?? null, lessonId: lessonId ?? null, message: text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { code?: AiErrorCode; error?: string; retryAfter?: number } | null;
          const retryAfter = body?.retryAfter ?? (Number(res.headers.get("retry-after")) || undefined);
          fail(body?.code ?? "provider_error", body?.error ?? "The AI tutor couldn't answer this time. Please try again.", retryAfter);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser(({ data }) => {
          try {
            handle(JSON.parse(data) as ChatStreamEvent);
          } catch {
            /* ignore malformed events */
          }
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.end();
        if (!finished) fail("network", "The connection was interrupted before the answer finished. Please try again.");
      } catch (err) {
        if (controller.signal.aborted) {
          // Stopped by the learner: keep the partial answer they already read (the server stores it too).
          const partial = textRef.current.trim();
          if (partial) {
            setMessages((list) => [...list, { id: `stopped-${Date.now()}`, role: "assistant", content: partial, createdAt: new Date().toISOString(), citations: [] }]);
          } else {
            setMessages((list) => list.filter((m) => m.id !== optimisticId));
          }
        } else {
          fail("network", err instanceof Error && /fetch|network/i.test(err.message) ? "You seem to be offline. Check your connection and try again." : "The AI tutor couldn't answer this time. Please try again.");
        }
      } finally {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        if (abortRef.current === controller) abortRef.current = null;
        setStreaming(null);
        setPending(false);
      }
    },
    [courseId, lessonId, scheduleFlush],
  );

  const retry = useCallback(() => {
    if (!error) return;
    const question = error.question;
    setError(null);
    void send(question);
  }, [error, send]);

  return { conversation, messages, streaming, pending, error, quota, announcement, send, stop, retry, load, updateMessage, dismissError: () => setError(null) };
}

import type { Database } from "@/lib/types";
import { exampleEventData, expandEventData, type WebhookEventName, type WebhookRefResolver } from "./events";

/**
 * The JSON body of a webhook request:
 *
 *   { "id": "evt_…", "type": "payment.paid", "createdAt": "2026-01-15T09:30:00.000Z", "data": { … } }
 *
 * `id` is the id of the event: it is the same for every endpoint that
 * receives the event and for every retry and resend, so receivers can use
 * it to ignore an event they already handled. Pure module.
 */

export interface WebhookPayload {
  id: string;
  type: WebhookEventName;
  /** When the event happened (ISO 8601, UTC). */
  createdAt: string;
  data: Record<string, unknown>;
}

/** Ids of test events start with this, so a receiver can tell them apart. */
export const TEST_EVENT_ID_PREFIX = "evt_test_";

/** Looks up the records an event refers to in the database. */
export function databaseResolver(db: Pick<Database, "users" | "courses" | "batches" | "lessons">, baseUrl: string): WebhookRefResolver {
  return {
    user(id) {
      const user = db.users.find((u) => u.id === id);
      return user ? { id: user.id, name: user.name, email: user.email, username: user.username } : null;
    },
    course(id) {
      const course = db.courses.find((c) => c.id === id);
      return course ? { id: course.id, title: course.title, slug: course.slug, url: `${baseUrl}/courses/${course.slug}` } : null;
    },
    batch(id) {
      const batch = db.batches.find((b) => b.id === id);
      return batch ? { id: batch.id, title: batch.title, slug: batch.slug, url: `${baseUrl}/batches/${batch.slug}` } : null;
    },
    lesson(id) {
      const lesson = db.lessons.find((l) => l.id === id);
      return lesson ? { id: lesson.id, title: lesson.title } : null;
    },
  };
}

/** The payload of a domain event, with the records it refers to added to `data`. */
export function buildWebhookPayload(event: { id: string; name: WebhookEventName; createdAt: string; data: object }, resolve: WebhookRefResolver): WebhookPayload {
  return { id: event.id, type: event.name, createdAt: event.createdAt, data: expandEventData(event.data, resolve) };
}

/** The payload "Send test event" delivers: the documented example of the event. `id` starts with `TEST_EVENT_ID_PREFIX`. */
export function buildTestPayload(type: WebhookEventName, baseUrl: string, id: string, now: Date = new Date()): WebhookPayload {
  return { id, type, createdAt: now.toISOString(), data: exampleEventData(type, baseUrl) };
}

/** The exact text that is sent and signed. */
export function serializeWebhookPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}

/** A stored payload back as an object, or null when it is not a payload (never throws). */
export function parseWebhookPayload(body: string): WebhookPayload | null {
  try {
    const value = JSON.parse(body) as Partial<WebhookPayload> | null;
    if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.type !== "string") return null;
    return value as WebhookPayload;
  } catch {
    return null;
  }
}

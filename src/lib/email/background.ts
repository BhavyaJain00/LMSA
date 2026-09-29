import "server-only";
import { after } from "next/server";

/**
 * Run email work after the response has been sent (Next.js `after`), so a
 * bulk send never keeps the request — or the author — waiting. Outside a
 * request scope (scripts, tests) the task runs detached on the next tick.
 * Errors are logged, never thrown: the outbox reports delivery problems.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[email] ${label} failed:`, error instanceof Error ? error.message : String(error));
    }
  };
  try {
    after(run);
  } catch {
    setTimeout(() => void run(), 0);
  }
}

import "server-only";
import { cookies } from "next/headers";

const FLASH_COOKIE = "ll_flash";

export type FlashTone = "success" | "error" | "info" | "warning";

/** Queue a one-time message shown as a toast after the next navigation. */
export async function setFlash(message: string, tone: FlashTone = "success"): Promise<void> {
  const store = await cookies();
  store.set({
    name: FLASH_COOKIE,
    value: encodeURIComponent(JSON.stringify({ message, tone })),
    path: "/",
    maxAge: 60,
    httpOnly: true,
    sameSite: "lax",
  });
}

/** Read (and clear) the pending flash message. Safe to call from layouts. */
export async function readFlash(): Promise<{ message: string; tone: FlashTone } | null> {
  const store = await cookies();
  const raw = store.get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as { message: string; tone: FlashTone };
  } catch {
    return null;
  }
}

/** Clear the flash cookie. Must be called from a Server Action or Route Handler. */
export async function clearFlash(): Promise<void> {
  const store = await cookies();
  store.set({ name: FLASH_COOKIE, value: "", path: "/", maxAge: 0 });
}

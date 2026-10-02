import { NAMESPACES, type Namespace } from "./config";
import type { Messages } from "./types";

/**
 * What client components receive. Client-safe (no message imports).
 *
 * Keys starting with `global.` in any namespace are handed to the client on
 * every page by the root layout: use the prefix for client components that
 * render outside the pages their group owns (the command palette, the PWA
 * install prompt, the footer sign-up form, a card reused on another group's
 * page). Everything else is provided by the layout or page that needs it.
 */
export const GLOBAL_PREFIX = "global.";

/** Messages handed to the client provider, per namespace. */
export type ProvidedMessages = Partial<Record<Namespace, Messages>>;

/** `pick` for the root layout: the `global.` slice of every namespace not provided in full. */
export function globalSlices(full: readonly Namespace[]): Partial<Record<Namespace, readonly string[]>> {
  const pick: Partial<Record<Namespace, readonly string[]>> = {};
  for (const namespace of NAMESPACES) if (!full.includes(namespace)) pick[namespace] = [GLOBAL_PREFIX];
  return pick;
}

/**
 * Nested providers add to what the providers above them supplied, key by key:
 * a page that provides a slice of a namespace (`pick`) keeps the `global.`
 * keys the root layout provides for that namespace.
 */
export function mergeProvided(parent: ProvidedMessages, child: ProvidedMessages): ProvidedMessages {
  const out: ProvidedMessages = { ...parent };
  for (const [namespace, messages] of Object.entries(child) as [Namespace, Messages | undefined][]) {
    if (!messages) continue;
    const above = parent[namespace];
    out[namespace] = above ? { ...above, ...messages } : messages;
  }
  return out;
}

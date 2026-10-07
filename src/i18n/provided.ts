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

/**
 * `global.` areas that are large and used on a few pages only. The root
 * layout leaves them out; the layouts that render their components provide
 * them instead: `global.player.` (video and audio player controls) through
 * `PlayerI18n` (`src/components/player/player-i18n.tsx`).
 */
export const ROUTE_PROVIDED_GLOBALS: Partial<Record<Namespace, readonly string[]>> = {
  learning: ["global.player."],
};

/** A `pick` prefix that matches no key (an empty prefix list would mean "every key"). */
const NO_KEYS = `${GLOBAL_PREFIX}\u0000`;

/**
 * The `global.<area>` prefixes of a namespace's keys, one per area, minus the
 * excluded areas (given as `global.<area>.` or `global.<area>`).
 */
export function globalAreaPrefixes(keys: Iterable<string>, excluded: readonly string[] = []): string[] {
  const areas = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(GLOBAL_PREFIX)) continue;
    const area = key.slice(GLOBAL_PREFIX.length).split(".")[0];
    if (!area) continue;
    const prefix = `${GLOBAL_PREFIX}${area}`;
    if (!excluded.some((skip) => skip === prefix || skip === `${prefix}.`)) areas.add(prefix);
  }
  return [...areas].sort();
}

/**
 * `pick` for the root layout: the `global.` slice of every namespace not
 * provided in full, without the `ROUTE_PROVIDED_GLOBALS` areas. `keysOf`
 * lists a namespace's English keys (server only); without it, every
 * `global.` key is picked.
 */
export function globalSlices(full: readonly Namespace[], keysOf?: (namespace: Namespace) => Iterable<string>): Partial<Record<Namespace, readonly string[]>> {
  const pick: Partial<Record<Namespace, readonly string[]>> = {};
  for (const namespace of NAMESPACES) {
    if (full.includes(namespace)) continue;
    const excluded = ROUTE_PROVIDED_GLOBALS[namespace];
    if (excluded?.length && keysOf) {
      const prefixes = globalAreaPrefixes(keysOf(namespace), excluded);
      pick[namespace] = prefixes.length ? prefixes : [NO_KEYS];
    } else {
      pick[namespace] = [GLOBAL_PREFIX];
    }
  }
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

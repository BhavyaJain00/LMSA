import "server-only";

/**
 * Domain event handler registry (round 3 wave B).
 *
 * Loaded lazily by `src/lib/events.ts` on the first `emit`. Each feature area
 * registers its reactions in its own `src/lib/<area>/handlers.ts` (using `on`
 * from `@/lib/events`, with a stable `key`) and adds exactly ONE side-effect
 * import line below, e.g. `import "@/lib/commerce/handlers";`.
 */

import "@/lib/growth/handlers";
import "@/lib/teaching/handlers";

export {};

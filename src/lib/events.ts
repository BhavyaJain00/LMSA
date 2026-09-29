import "server-only";
import { uid } from "@/lib/utils";
import type { DomainEvent, DomainEventMap, DomainEventName } from "./events-shared";

export type { DomainEvent, DomainEventMap, DomainEventName } from "./events-shared";
export { DOMAIN_EVENTS, DOMAIN_EVENT_NAMES, isDomainEventName } from "./events-shared";

/**
 * In-process domain event bus (round 3 wave B).
 *
 * Core flows call `emit(name, data)` right after the change is committed
 * (an order is paid, a learner enrolls, a lesson is completed, …). Feature
 * areas react with `on(name, handler)` in their own `src/lib/<area>/handlers.ts`,
 * which is registered by adding ONE import line to `src/lib/handlers.ts`.
 *
 * Guarantees:
 *  - `emit` never throws and never waits for handlers: dispatch is deferred
 *    to a later tick, so handlers always run after the mutation that emitted
 *    the event has finished (even when `emit` is called inside `mutate`).
 *  - Handlers of one event run concurrently; each one's error (thrown or
 *    rejected) is caught and logged without the payload, and never reaches
 *    the caller or the other handlers.
 *  - `src/lib/handlers.ts` is imported lazily on the first emit, so importing
 *    this module never pulls every feature area into a bundle.
 *
 * The registry lives on `globalThis` (like the store) so dev hot reloads and
 * separately bundled server entries share one bus. Register handlers with a
 * stable `key` so a re-evaluated module replaces its handler instead of
 * adding a second copy.
 */

export type DomainEventHandler<N extends DomainEventName> = (event: DomainEvent<N>) => void | Promise<void>;

type AnyHandler = (event: DomainEvent) => void | Promise<void>;

interface BusState {
  /** event name → registration key → handler */
  handlers: Map<DomainEventName, Map<unknown, AnyHandler>>;
  /** Lazy import of `src/lib/handlers.ts`; reset after a failure so the next emit retries. */
  loading: Promise<void> | null;
  loaded: boolean;
  /** Dispatches that have not finished yet (see `settleEvents`). */
  inFlight: Set<Promise<void>>;
}

const g = globalThis as unknown as { __llEventBus?: BusState };
const bus: BusState = (g.__llEventBus ??= { handlers: new Map(), loading: null, loaded: false, inFlight: new Set() });

/**
 * Subscribe to an event. Returns a function that removes the handler.
 * `key` identifies the registration (e.g. "growth:commission"); registering
 * the same key again replaces the previous handler.
 */
export function on<N extends DomainEventName>(name: N, handler: DomainEventHandler<N>, opts: { key?: string } = {}): () => void {
  let byKey = bus.handlers.get(name);
  if (!byKey) {
    byKey = new Map();
    bus.handlers.set(name, byKey);
  }
  const key: unknown = opts.key ?? handler;
  const stored = handler as unknown as AnyHandler;
  byKey.set(key, stored);
  return () => {
    const current = bus.handlers.get(name);
    if (current?.get(key) === stored) current.delete(key);
  };
}

/** Number of handlers registered for an event (diagnostics and tests). */
export function listenerCount(name: DomainEventName): number {
  return bus.handlers.get(name)?.size ?? 0;
}

function loadHandlers(): Promise<void> {
  if (bus.loaded) return Promise.resolve();
  bus.loading ??= import("./handlers")
    .then(() => {
      bus.loaded = true;
    })
    .catch((error: unknown) => {
      console.error("[events] could not load event handlers:", error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      bus.loading = null;
    });
  return bus.loading;
}

const defer: (fn: () => void) => void = typeof setImmediate === "function" ? (fn) => void setImmediate(fn) : (fn) => void setTimeout(fn, 0);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function dispatch(event: DomainEvent): Promise<void> {
  // Wait for the emitting call stack (and the mutation it is part of) to finish first.
  await new Promise<void>((resolve) => defer(resolve));
  await loadHandlers();
  const handlers = [...(bus.handlers.get(event.name)?.values() ?? [])];
  if (!handlers.length) return;
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[events] a ${event.name} handler failed (event ${event.id}):`, describe(error));
      }
    }),
  );
}

/**
 * Publish an event. Returns the event envelope immediately; handlers run
 * later and their failures are logged, never thrown.
 */
export function emit<N extends DomainEventName>(name: N, data: DomainEventMap[N]): DomainEvent<N> {
  const event: DomainEvent<N> = { id: uid("evt"), name, createdAt: new Date().toISOString(), data };
  try {
    const task = dispatch(event as unknown as DomainEvent).catch((error: unknown) => {
      console.error(`[events] dispatching ${name} failed (event ${event.id}):`, describe(error));
    });
    bus.inFlight.add(task);
    void task.finally(() => bus.inFlight.delete(task));
  } catch (error) {
    console.error(`[events] could not emit ${name}:`, describe(error));
  }
  return event;
}

/**
 * Resolve once every event emitted so far — and every event those handlers
 * emitted in turn — has been handled. Used by tests and graceful shutdown.
 */
export async function settleEvents(): Promise<void> {
  for (let round = 0; round < 50 && bus.inFlight.size > 0; round++) {
    await Promise.allSettled([...bus.inFlight]);
  }
}

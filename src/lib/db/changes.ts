import { hash } from "node:crypto";
import type { ChangeSet, CollectionChanges } from "./sqlite-core.mjs";

/**
 * Change detection for incremental persistence.
 *
 * The tracker remembers, per collection and id, the document object last
 * written (`ref`) and a fingerprint of its JSON (`print`, SHA-1). A diff
 * compares the in-memory collection with that state in one of three modes,
 * chosen by the engine from what it saw the code do:
 *
 *  - `candidates`: only the listed documents are compared (documents returned
 *    by `find`/`filter`, pushed, or assigned to an index). Cost is
 *    proportional to what the mutation touched: the hot path.
 *  - `identity`: the array's membership changed (splice, removal, whole-array
 *    replacement). Every id is looked up; only documents that are new, sit
 *    at an id under a different object, or are candidates get serialized;
 *    ids no longer present are deleted.
 *  - `full`: every document is serialized and compared. Used by the
 *    background sweep, before backups and on shutdown, and after code
 *    iterated a collection with a callback that may have edited documents.
 *
 * `diff()` never changes the tracker; `commit()` adopts a diff once it is
 * safely stored, so a failed write is simply found again by the next diff.
 */

export type DiffMode = "candidates" | "identity" | "full";

export interface DiffRequest {
  name: string;
  mode: DiffMode;
  /** Documents that may have changed (used by `candidates` and `identity`). */
  candidates?: Iterable<unknown>;
}

interface Entry {
  ref: object;
  print: string;
}

interface CollectionUpdate {
  set: [string, Entry][];
  deletes: string[];
}

export interface PendingChanges {
  changeSet: ChangeSet;
  /** Tracker updates to adopt on commit, per collection. */
  updates: Map<string, CollectionUpdate>;
  /** Settings JSON to adopt on commit (null = unchanged). */
  settingsJson: string | null;
  /** Documents skipped because they have no usable id, per collection. */
  invalid: Map<string, number>;
  /** Ids that appear more than once (only the first copy is stored), per collection. */
  duplicates: Map<string, number>;
  /** Documents serialized to build this diff (a measure of its cost). */
  compared: number;
}

/** SHA-1 of a document's JSON: 28 characters instead of a second copy of the document. */
export function fingerprint(json: string): string {
  return hash("sha1", json, "base64");
}

export class ChangeTracker {
  private entries = new Map<string, Map<string, Entry>>();
  private settingsJson: string | null = null;

  /** Adopt `collections` as the stored state (after loading or replacing everything). */
  reset(collections: Record<string, readonly unknown[]>, settings: unknown): void {
    this.entries.clear();
    for (const [name, docs] of Object.entries(collections)) {
      const map = new Map<string, Entry>();
      for (const doc of docs) {
        const id = idOf(doc);
        if (id !== null && !map.has(id)) map.set(id, { ref: doc as object, print: fingerprint(JSON.stringify(doc)) });
      }
      this.entries.set(name, map);
    }
    this.settingsJson = settings === undefined ? null : JSON.stringify(settings);
  }

  /** Compare the requested collections (and the settings, unless undefined) with the stored state. */
  diff(collections: Record<string, unknown>, requests: Iterable<DiffRequest>, settings: unknown): PendingChanges {
    const pending: PendingChanges = {
      changeSet: { collections: [], settings: null },
      updates: new Map(),
      settingsJson: null,
      invalid: new Map(),
      duplicates: new Map(),
      compared: 0,
    };
    const merged = mergeRequests(requests);
    for (const request of merged.values()) {
      const value = collections[request.name];
      const docs: readonly unknown[] = Array.isArray(value) ? value : [];
      const stored = this.entries.get(request.name) ?? new Map<string, Entry>();
      const change: CollectionChanges = { name: request.name, upserts: [], deletes: [] };
      const update: CollectionUpdate = { set: [], deletes: [] };
      const consider = (id: string, doc: object) => {
        const json = JSON.stringify(doc);
        const print = fingerprint(json);
        pending.compared++;
        const entry = stored.get(id);
        if (entry?.print === print) {
          if (entry.ref !== doc) update.set.push([id, { ref: doc, print }]);
          return;
        }
        change.upserts.push({ id, json });
        update.set.push([id, { ref: doc, print }]);
      };

      if (request.mode === "candidates") {
        const seen = new Set<string>();
        for (const doc of request.candidates) {
          const id = idOf(doc);
          if (id === null || seen.has(id)) continue;
          seen.add(id);
          consider(id, doc as object);
        }
      } else {
        const present = new Set<string>();
        let invalid = 0;
        let duplicates = 0;
        for (const doc of docs) {
          const id = idOf(doc);
          if (id === null) {
            invalid++;
            continue;
          }
          if (present.has(id)) {
            duplicates++;
            continue;
          }
          present.add(id);
          const entry = stored.get(id);
          if (request.mode === "full" || !entry || entry.ref !== doc || request.candidates.has(doc)) consider(id, doc as object);
        }
        for (const id of stored.keys()) {
          if (present.has(id)) continue;
          change.deletes.push(id);
          update.deletes.push(id);
        }
        if (invalid) pending.invalid.set(request.name, invalid);
        if (duplicates) pending.duplicates.set(request.name, duplicates);
      }
      if (change.upserts.length || change.deletes.length) pending.changeSet.collections.push(change);
      if (update.set.length || update.deletes.length) pending.updates.set(request.name, update);
    }
    const settingsJson = settings === undefined ? null : JSON.stringify(settings);
    if (settingsJson !== null && settingsJson !== this.settingsJson) {
      pending.changeSet.settings = settingsJson;
      pending.settingsJson = settingsJson;
    }
    return pending;
  }

  /** Record a successfully stored change set. */
  commit(pending: PendingChanges): void {
    for (const [name, update] of pending.updates) {
      let map = this.entries.get(name);
      if (!map) this.entries.set(name, (map = new Map()));
      for (const [id, entry] of update.set) map.set(id, entry);
      for (const id of update.deletes) map.delete(id);
    }
    if (pending.settingsJson !== null) this.settingsJson = pending.settingsJson;
  }

  /** Number of documents tracked for `name`. */
  size(name: string): number {
    return this.entries.get(name)?.size ?? 0;
  }
}

interface MergedRequest {
  name: string;
  mode: DiffMode;
  candidates: Set<unknown>;
}

const RANK: Record<DiffMode, number> = { candidates: 0, identity: 1, full: 2 };

/** One request per collection: the strongest mode wins and candidates are combined. */
function mergeRequests(requests: Iterable<DiffRequest>): Map<string, MergedRequest> {
  const out = new Map<string, MergedRequest>();
  for (const request of requests) {
    let merged = out.get(request.name);
    if (!merged) {
      merged = { name: request.name, mode: request.mode, candidates: new Set() };
      out.set(request.name, merged);
    } else if (RANK[request.mode] > RANK[merged.mode]) {
      merged.mode = request.mode;
    }
    if (request.candidates) for (const doc of request.candidates) merged.candidates.add(doc);
  }
  return out;
}

/** True when a change set writes nothing. */
export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return changes.collections.length === 0 && changes.settings === null;
}

/** Number of documents a change set writes or deletes. */
export function changeSetSize(changes: ChangeSet): number {
  return changes.collections.reduce((n, c) => n + c.upserts.length + c.deletes.length, 0) + (changes.settings === null ? 0 : 1);
}

export function idOf(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const id = (doc as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

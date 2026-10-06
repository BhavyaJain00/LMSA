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
 *    by `find`/`filter`, pushed, or assigned to an index), and the listed
 *    `removed` documents are deleted. Cost is proportional to what the
 *    mutation touched: the hot path.
 *  - `identity`: the array's membership or order changed (splice, removal,
 *    sort, whole-array replacement). Every id is looked up; only documents
 *    that are new, sit at an id under a different object, or are candidates
 *    get serialized; ids no longer present are deleted.
 *  - `full`: every document is serialized and compared. Used by the
 *    background sweep, by `flush()`, before backups and on shutdown, and
 *    after code iterated a collection in a way that may have edited any
 *    document.
 *
 * Candidates are trusted to be members of the collection. When two different
 * candidate objects carry the same id (a stale copy next to its replacement)
 * that cannot be decided without looking, so the collection is scanned as in
 * `identity` mode and the object actually in the array wins.
 *
 * Removed documents (taken out with `splice`, `pop`, `shift`, a shorter
 * `length` or `removeWhere`) are deleted by id without looking at the rest of
 * the collection, but only when that is certain: the object removed is the
 * one stored under its id and no candidate carries that id. Anything else (a
 * removed copy, a document removed and put back) is settled by an `identity`
 * scan instead.
 *
 * Array order is part of a collection's state. The tracker's maps keep ids
 * in stored order (the order rows come back in), new documents are stored
 * after the existing ones, and a scan that finds the array in any other
 * order asks the driver to renumber the rows (`order`).
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
  /**
   * Documents taken out of the array since the last write (used by
   * `candidates`; a scan finds removals by itself). They are never compared
   * as candidates.
   */
  removed?: Iterable<unknown>;
}

interface Entry {
  ref: object;
  print: string;
}

interface CollectionUpdate {
  set: [string, Entry][];
  deletes: string[];
  /** Every id in the new stored order, when the rows were renumbered. */
  order?: string[];
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

/**
 * A walk over the stored ids of one collection in stored order, a few at a
 * time (see `ChangeTracker.walkIds`). It stays valid while documents are
 * only updated or appended; `valid()` turns false once ids are deleted or
 * renumbered, or everything is replaced.
 */
export interface StoredIdWalk {
  /** The next stored id, or null after the last one. */
  next(): string | null;
  valid(): boolean;
}

export class ChangeTracker {
  private entries = new Map<string, Map<string, Entry>>();
  private settingsJson: string | null = null;
  /** Bumped by reset(): every walk started before it is stale. */
  private epoch = 0;
  /** Per collection, bumped when ids are deleted or renumbered. */
  private structure = new Map<string, number>();

  /** Adopt `collections` as the stored state (after loading or replacing everything). */
  reset(collections: Record<string, readonly unknown[]>, settings: unknown): void {
    this.epoch++;
    this.structure.clear();
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
    for (const request of mergeRequests(requests).values()) {
      const value = collections[request.name];
      const docs: readonly unknown[] = Array.isArray(value) ? value : [];
      const stored = this.entries.get(request.name) ?? new Map<string, Entry>();
      const change: CollectionChanges = { name: request.name, upserts: [], deletes: [] };
      const update: CollectionUpdate = { set: [], deletes: [] };
      let invalid = 0;
      let duplicates = 0;
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

      let listed = request.mode === "candidates" ? candidatesById(request.candidates, request.removed) : null;
      let removedIds: string[] = [];
      if (listed && request.removed.size) {
        const ids = removalsById(request.removed, listed.byId, stored);
        if (ids) removedIds = ids;
        else listed = null;
      }
      if (listed) {
        invalid = listed.invalid;
        for (const [id, doc] of listed.byId) consider(id, doc);
        for (const id of removedIds) {
          change.deletes.push(id);
          update.deletes.push(id);
        }
      } else {
        const present = new Set<string>();
        /** Ids in array order. */
        const sequence: string[] = [];
        const full = request.mode === "full";
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
          sequence.push(id);
          const entry = stored.get(id);
          if (full || !entry || entry.ref !== doc || request.candidates.has(doc)) consider(id, doc as object);
        }
        // Stored rows that remain must lead the array in their stored order; new documents follow (they are appended).
        let position = 0;
        let ordered = true;
        for (const id of stored.keys()) {
          if (!present.has(id)) {
            change.deletes.push(id);
            update.deletes.push(id);
          } else if (sequence[position++] !== id) {
            ordered = false;
          }
        }
        if (!ordered) change.order = update.order = sequence;
      }
      if (invalid) pending.invalid.set(request.name, invalid);
      if (duplicates) pending.duplicates.set(request.name, duplicates);
      if (change.upserts.length || change.deletes.length || change.order) pending.changeSet.collections.push(change);
      if (update.set.length || update.deletes.length || update.order) pending.updates.set(request.name, update);
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
      if (update.deletes.length || update.order) this.structure.set(name, (this.structure.get(name) ?? 0) + 1);
      for (const [id, entry] of update.set) map.set(id, entry);
      for (const id of update.deletes) map.delete(id);
      if (update.order) {
        const reordered = new Map<string, Entry>();
        for (const id of update.order) {
          const entry = map.get(id);
          if (entry) reordered.set(id, entry);
        }
        this.entries.set(name, reordered);
      }
    }
    if (pending.settingsJson !== null) this.settingsJson = pending.settingsJson;
  }

  /** Number of documents tracked for `name`. */
  size(name: string): number {
    return this.entries.get(name)?.size ?? 0;
  }

  /**
   * Walk the stored ids of `name` in stored order. Comparing them, a chunk
   * at a time, with the ids in the array proves that membership and order
   * are unchanged without the single long pass an `identity` diff makes:
   * updates keep an id's place and new documents are stored after the
   * existing ones, so the walk survives commits of those between chunks.
   */
  walkIds(name: string): StoredIdWalk {
    const epoch = this.epoch;
    const structure = this.structure.get(name) ?? 0;
    let map = this.entries.get(name);
    if (!map) this.entries.set(name, (map = new Map()));
    const keys = map.keys();
    const valid = () => this.epoch === epoch && (this.structure.get(name) ?? 0) === structure;
    return {
      valid,
      next: () => {
        if (!valid()) return null;
        const step = keys.next();
        return step.done ? null : step.value;
      },
    };
  }
}

/**
 * Candidates keyed by id, or null when two different objects claim the same
 * id (the caller then scans the collection to see which one is in it).
 */
function candidatesById(candidates: Iterable<unknown>, removed: ReadonlySet<unknown>): { byId: Map<string, object>; invalid: number } | null {
  const byId = new Map<string, object>();
  let invalid = 0;
  for (const doc of candidates) {
    // Returned by a read before it was taken out of the array: no longer a member.
    if (removed.size && removed.has(doc)) continue;
    const id = idOf(doc);
    if (id === null) {
      invalid++;
      continue;
    }
    const other = byId.get(id);
    if (other === undefined) byId.set(id, doc as object);
    else if (other !== doc) return null;
  }
  return { byId, invalid };
}

/**
 * Ids to delete for documents taken out of the array, or null when that
 * cannot be decided without scanning the collection: a removed object that
 * is not the one stored under its id (a copy, or one of two documents
 * sharing an id), or an id that a candidate still carries (a document
 * removed and put back, which may also have moved).
 */
function removalsById(removed: Iterable<unknown>, members: ReadonlyMap<string, object>, stored: ReadonlyMap<string, Entry>): string[] | null {
  const ids: string[] = [];
  for (const doc of removed) {
    const id = idOf(doc);
    if (id === null) continue;
    if (members.has(id)) return null;
    const entry = stored.get(id);
    // Never stored (added and removed again before a write): nothing to delete.
    if (!entry) continue;
    if (entry.ref !== doc) return null;
    ids.push(id);
  }
  return ids;
}

interface MergedRequest {
  name: string;
  mode: DiffMode;
  candidates: Set<unknown>;
  removed: Set<unknown>;
}

const RANK: Record<DiffMode, number> = { candidates: 0, identity: 1, full: 2 };

/** One request per collection: the strongest mode wins and candidates are combined. */
function mergeRequests(requests: Iterable<DiffRequest>): Map<string, MergedRequest> {
  const out = new Map<string, MergedRequest>();
  for (const request of requests) {
    let merged = out.get(request.name);
    if (!merged) {
      merged = { name: request.name, mode: request.mode, candidates: new Set(), removed: new Set() };
      out.set(request.name, merged);
    } else if (RANK[request.mode] > RANK[merged.mode]) {
      merged.mode = request.mode;
    }
    if (request.candidates) for (const doc of request.candidates) merged.candidates.add(doc);
    if (request.removed) for (const doc of request.removed) merged.removed.add(doc);
  }
  return out;
}

/** True when a change set writes nothing. */
export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return changes.collections.length === 0 && changes.settings === null;
}

/** Number of rows a change set writes, deletes or renumbers. */
export function changeSetSize(changes: ChangeSet): number {
  return changes.collections.reduce((n, c) => n + c.upserts.length + c.deletes.length + (c.order?.length ?? 0), 0) + (changes.settings === null ? 0 : 1);
}

export function idOf(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const id = (doc as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

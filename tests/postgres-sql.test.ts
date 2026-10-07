import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUMP_SEQ_SQL,
  applyChangeSet,
  batchPayload,
  batchRows,
  changeSetStatements,
  countMismatches,
  deleteStatements,
  describeDatabaseUrl,
  expectedCounts,
  extractColumns,
  insertStatement,
  quoteIdent,
  readAllData,
  reorderStatements,
  replaceTableStatements,
  sanitizeJson,
  settingsStatement,
  tableFor,
  upsertStatement,
  writeAllData,
} from "@/lib/db/postgres-core.mjs";

/**
 * Postgres phase 1: the SQL the driver sends, built without a database —
 * change sets to batched statements, extracted columns, parameters only
 * (never values in the SQL text), reading in pages.
 */

const TABLES = {
  users: { table: "users", columns: [{ key: "email", column: "email" }] },
  progress: {
    table: "progress",
    columns: [
      { key: "userId", column: "user_id" },
      { key: "lessonId", column: "lesson_id" },
    ],
  },
  notes: { table: "notes", columns: [] },
};
const NOW = "2026-10-07T10:00:00.000Z";

type Call = { kind: "query" | "execute"; sql: string; params: unknown[] };

/** An executor that records statements and answers queries from `answer`. */
function recorder(answer: (sql: string, params: unknown[]) => unknown[] = () => []) {
  const calls: Call[] = [];
  return {
    calls,
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      calls.push({ kind: "query", sql, params });
      return answer(sql, params);
    },
    async $executeRawUnsafe(sql: string, ...params: unknown[]) {
      calls.push({ kind: "execute", sql, params });
      return 1;
    },
  };
}

describe("postgres SQL: building blocks", () => {
  it("quotes only valid identifiers", () => {
    assert.equal(quoteIdent("quiz_submissions"), '"quiz_submissions"');
    for (const bad of ['users"; DROP TABLE x; --', "Users", "1abc", "", "a b"]) assert.throws(() => quoteIdent(bad), /not a valid/);
  });

  it("finds tables and refuses collections without one", () => {
    assert.equal(tableFor("users", TABLES).table, "users");
    assert.throws(() => tableFor("missing", TABLES), /no table for the collection "missing"/);
    assert.throws(() => tableFor("toString", TABLES), /no table/);
  });

  it("replaces NUL escapes (PostgreSQL cannot store them) but not an escaped backslash before u0000", () => {
    assert.equal(sanitizeJson('{"a":"x\\u0000y"}'), '{"a":"x\\ufffdy"}');
    assert.equal(sanitizeJson(JSON.stringify({ a: "\\u0000" })), JSON.stringify({ a: "\\u0000" }));
    assert.deepEqual(JSON.parse(sanitizeJson(JSON.stringify({ a: "\\\u0000" }))), { a: "\\�" });
    const plain = JSON.stringify({ a: "nothing to do" });
    assert.equal(sanitizeJson(plain), plain);
  });

  it("extracts hot-key columns the way doc->>'key' does", () => {
    assert.deepEqual(extractColumns(TABLES.progress, { id: "p1", userId: "u1", lessonId: null }), { user_id: "u1", lesson_id: null });
    assert.deepEqual(extractColumns(TABLES.progress, { id: "p1", userId: 7 }), { user_id: "7", lesson_id: null });
    assert.deepEqual(extractColumns(TABLES.notes, { id: "n1" }), {});
  });

  it("splits rows into batches by count and by size", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, json: "x".repeat(100) }));
    assert.deepEqual(
      batchRows(rows, { maxRows: 3 }).map((b) => b.length),
      [3, 3, 1],
    );
    assert.deepEqual(
      batchRows(rows, { maxBytes: 300 }).map((b) => b.length),
      [2, 2, 2, 1],
    );
    // A single row larger than the limit still gets a batch of its own.
    assert.deepEqual(
      batchRows([{ id: "big", json: "x".repeat(1000) }, ...rows.slice(0, 1)], { maxBytes: 300 }).map((b) => b.map((r) => r.id)),
      [["big"], ["r0"]],
    );
    assert.deepEqual(batchRows([]), []);
  });

  it("packs a batch into one JSON parameter with ordinals", () => {
    const payload = batchPayload(
      [
        { id: 'a"1', json: '{"id":"a\\"1","n":1}' },
        { id: "b", json: '{"id":"b"}' },
      ],
      5,
    );
    assert.deepEqual(JSON.parse(payload), [
      { id: 'a"1', ord: 5, doc: { id: 'a"1', n: 1 } },
      { id: "b", ord: 6, doc: { id: "b" } },
    ]);
  });
});

describe("postgres SQL: statements", () => {
  it("upserts a batch with parameters only, keeping positions of existing rows and appending new ones", () => {
    const doc = { id: "u1", email: "x'); DROP TABLE users; --@example.com" };
    const { sql, params } = upsertStatement(TABLES.users, [{ id: "u1", json: JSON.stringify(doc) }], NOW);
    assert.ok(!sql.includes("DROP TABLE"), "values never reach the SQL text");
    assert.match(sql, /jsonb_to_recordset\(\$1::jsonb\)/);
    assert.match(sql, /INSERT INTO "users" \("id", "doc", "position", "updated_at", "email"\)/);
    assert.match(sql, /COALESCE\(MAX\(t\.position\), -1\) FROM "users" t\) \+ COALESCE\(n\.k, 0\)/);
    assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "users" e WHERE e\.id = r\.id\)/);
    assert.match(sql, /r\.doc->>'email'/);
    assert.match(sql, /ON CONFLICT \("id"\) DO UPDATE SET "doc" = EXCLUDED\."doc", "updated_at" = EXCLUDED\."updated_at", "email" = EXCLUDED\."email"$/);
    assert.ok(!/"position" = EXCLUDED/.test(sql), "an update keeps the row's position");
    assert.deepEqual(JSON.parse(params[0] as string), [{ id: "u1", ord: 0, doc }]);
    assert.equal(params[1], NOW);
  });

  it("inserts a replaced table at explicit positions, keeping the first copy of an id", () => {
    const { sql, params } = insertStatement(TABLES.notes, [{ id: "n1", json: '{"id":"n1"}' }], 1000, NOW);
    assert.match(sql, /SELECT r\.id, r\.doc, r\.ord, \$2::timestamptz FROM jsonb_to_recordset/);
    assert.match(sql, /ON CONFLICT \("id"\) DO NOTHING$/);
    assert.equal(JSON.parse(params[0] as string)[0].ord, 1000);
  });

  it("deletes and renumbers in chunks of ids", () => {
    const ids = Array.from({ length: 20_001 }, (_, i) => `id${i}`);
    const deletes = deleteStatements(TABLES.notes, ids);
    assert.equal(deletes.length, 3);
    assert.match(deletes[0]!.sql, /^DELETE FROM "notes" WHERE "id" IN \(SELECT jsonb_array_elements_text\(\$1::jsonb\)\)$/);
    assert.equal(JSON.parse(deletes[2]!.params[0] as string).length, 1);

    const reorder = reorderStatements(TABLES.notes, ids);
    assert.equal(reorder.length, 3);
    assert.match(reorder[0]!.sql, /SET "position" = r\.ord::int - 1 \+ \$2::int FROM jsonb_array_elements_text\(\$1::jsonb\) WITH ORDINALITY/);
    assert.deepEqual(
      reorder.map((s) => s.params[1]),
      [0, 10_000, 20_000],
    );
  });

  it("turns a change set into upserts, deletes, renumbering and settings, in that order", () => {
    const statements = changeSetStatements(
      {
        collections: [
          { name: "progress", upserts: [1, 2, 3].map((n) => ({ id: `p${n}`, json: JSON.stringify({ id: `p${n}`, userId: "u1" }) })), deletes: ["p9"], order: ["p3", "p1", "p2"] },
          { name: "users", upserts: [], deletes: ["u2", "u3"] },
        ],
        settings: '{"siteName":"Loop"}',
      },
      NOW,
      { tables: TABLES, maxRows: 2 },
    );
    assert.deepEqual(
      statements.map((s) => s.sql.split(" ").slice(0, 3).join(" ")),
      ["WITH r AS", "WITH r AS", 'DELETE FROM "progress"', 'UPDATE "progress" AS', 'DELETE FROM "users"', 'INSERT INTO "settings"'],
    );
    assert.deepEqual(JSON.parse(statements[4]!.params[0] as string), ["u2", "u3"]);
    assert.deepEqual(settingsStatement('{"a":1}', NOW).params, ['{"a":1}', NOW]);
    assert.throws(() => changeSetStatements({ collections: [{ name: "nope", upserts: [], deletes: ["x"] }], settings: null }, NOW, { tables: TABLES }), /no table/);
  });

  it("replaces a table: delete, then batched inserts with running positions; duplicates are counted, missing ids rejected", () => {
    const docs = [{ id: "a" }, { id: "b" }, { id: "a", copy: true }, { id: "c" }];
    const result = replaceTableStatements("notes", docs, NOW, { tables: TABLES, maxRows: 2 });
    assert.equal(result.stored, 3);
    assert.equal(result.duplicates, 1);
    assert.equal(result.statements[0]!.sql, 'DELETE FROM "notes"');
    assert.deepEqual(
      result.statements.slice(1).map((s) => JSON.parse(s.params[0] as string).map((r: { id: string; ord: number }) => `${r.id}@${r.ord}`)),
      [["a@0", "b@1"], ["c@2"]],
    );
    assert.throws(() => replaceTableStatements("notes", [{ id: "a" }, { name: "no id" }], NOW, { tables: TABLES }), /item 2 has no id/);
  });

  it("strips credentials from a connection string for display", () => {
    assert.equal(
      describeDatabaseUrl("postgresql://postgres.abc:s3cret@aws-0-eu.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&schema=public"),
      "postgresql://aws-0-eu.pooler.supabase.com:6543/postgres?schema=public",
    );
    assert.doesNotMatch(describeDatabaseUrl("postgres://u:pw@localhost/db"), /pw/);
    assert.equal(describeDatabaseUrl("not a url"), "postgresql://(invalid DATABASE_URL)");
  });

  it("verifies copy counts per collection by distinct id", () => {
    const expected = expectedCounts({ collections: { users: [{ id: "a" }, { id: "a" }, { id: "b" }], other: [{ id: "x" }] }, settings: null }, ["users", "notes"]);
    assert.deepEqual(expected, { users: 2, notes: 0 });
    assert.deepEqual(countMismatches(expected, { users: 2, notes: 0 }), []);
    assert.deepEqual(countMismatches(expected, { users: 1 }), ["users: expected 2, stored 1"]);
  });
});

describe("postgres SQL: running against an executor", () => {
  it("applies a change set statement by statement", async () => {
    const db = recorder();
    await applyChangeSet(db, { collections: [{ name: "users", upserts: [{ id: "u1", json: '{"id":"u1"}' }], deletes: ["u2"] }], settings: null }, NOW, { tables: TABLES });
    assert.deepEqual(
      db.calls.map((c) => c.kind),
      ["execute", "execute"],
    );
    assert.match(BUMP_SEQ_SQL, /RETURNING "value"$/);
  });

  it("reads tables a page at a time in position order, then the settings", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, position: i, doc: JSON.stringify({ id: `n${i}` }) }));
    const db = recorder((sql, params) => {
      if (sql.includes('FROM "settings"')) return [{ data: '{"siteName":"Loop"}' }];
      if (sql.includes('FROM "users"')) return [];
      const after = params.length ? Number(params[0]) : -1;
      return rows.filter((r) => r.position > after).slice(0, 2);
    });
    const data = await readAllData(db, ["notes", "users"], { tables: TABLES, pageRows: 2 });
    assert.deepEqual(
      (data.collections.notes as { id: string }[]).map((d) => d.id),
      ["n0", "n1", "n2", "n3", "n4"],
    );
    assert.deepEqual(data.collections.users, []);
    assert.deepEqual(data.settings, { siteName: "Loop" });
    const pages = db.calls.filter((c) => c.sql.includes('FROM "notes"'));
    assert.equal(pages.length, 3);
    assert.match(pages[1]!.sql, /WHERE \("position", "id"\) > \(\$1::int, \$2::text\) ORDER BY "position", "id" LIMIT 2/);
    assert.deepEqual(pages[1]!.params, [1, "n1"]);
  });

  it("reports a damaged document instead of loading it", async () => {
    const db = recorder((sql) => (sql.includes('FROM "notes"') ? [{ id: "bad", position: 0, doc: "{nope" }] : []));
    await assert.rejects(readAllData(db, ["notes"], { tables: TABLES }), /"notes" has a damaged document \(id bad\)/);
  });

  it("replaces everything, records where the data came from, and leaves an initialized database alone when asked", async () => {
    const meta: Record<string, string> = {};
    const db = recorder((sql) => {
      if (sql.includes('SELECT "key", "value" FROM "meta"')) return Object.entries(meta).map(([key, value]) => ({ key, value }));
      if (sql.includes("AS \"found\"")) return [{ found: Object.keys(meta).length > 0 }];
      return [];
    });
    const result = await writeAllData(db, { collections: { users: [{ id: "u1" }], ghosts: [{ id: "g1" }] }, settings: { siteName: "Loop" } }, ["users", "notes"], {
      tables: TABLES,
      source: "seed",
      now: NOW,
    });
    assert.deepEqual(result, { written: true, skipped: ["ghosts"], duplicates: {} });
    const executed = db.calls.filter((c) => c.kind === "execute");
    assert.deepEqual(
      executed.map((c) => c.sql.slice(0, 22)),
      ['DELETE FROM "users"', 'INSERT INTO "users" ("', 'DELETE FROM "notes"', 'INSERT INTO "settings"', 'INSERT INTO "meta" ("k', 'INSERT INTO "meta" ("k'].map((s) => s.slice(0, 22)),
    );
    assert.deepEqual(executed.at(-1)!.params, ["initialized_from", "seed"]);

    meta.initialized_at = NOW;
    const again = await writeAllData(db, { collections: {}, settings: null }, ["users"], { tables: TABLES, initialize: true });
    assert.equal(again.written, false);
  });
});

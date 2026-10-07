import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COLLECTIONS } from "@/lib/db/store";
import { PG_TABLES } from "@/lib/db/postgres-tables.mjs";
import {
  HOT_COLUMN_KEYS,
  buildPrismaSchema,
  buildTableSpecs,
  buildTablesModule,
  generate,
  modelName,
  snakeCase,
} from "../scripts/prisma-generate-schema.mjs";

/**
 * Postgres phase 1: the schema generator (`npm run prisma:schema`). The
 * committed `prisma/schema.prisma` and `src/lib/db/postgres-tables.mjs` must
 * match what it produces from COLLECTIONS and `src/lib/types.ts`.
 */

describe("postgres schema: generator helpers", () => {
  it("maps collection names to snake_case tables and PascalCase models", () => {
    assert.equal(snakeCase("users"), "users");
    assert.equal(snakeCase("quizSubmissions"), "quiz_submissions");
    assert.equal(snakeCase("aiConversations"), "ai_conversations");
    assert.equal(snakeCase("userId"), "user_id");
    assert.equal(modelName("quizSubmissions"), "QuizSubmissions");
  });

  it("builds one table per collection with the hot-key columns it is given", () => {
    const specs = buildTableSpecs(["users", "quizSubmissions", "questions"], { users: ["email"], quizSubmissions: ["userId", "lessonId"] });
    assert.deepEqual(specs, [
      { name: "users", model: "Users", table: "users", columns: [{ key: "email", column: "email" }] },
      {
        name: "quizSubmissions",
        model: "QuizSubmissions",
        table: "quiz_submissions",
        columns: [
          { key: "userId", column: "user_id" },
          { key: "lessonId", column: "lesson_id" },
        ],
      },
      { name: "questions", model: "Questions", table: "questions", columns: [] },
    ]);
  });

  it("refuses names that clash with the settings/meta tables or each other", () => {
    assert.throws(() => buildTableSpecs(["settings"], {}), /already used/);
    assert.throws(() => buildTableSpecs(["fooBar", "foo_bar"], {}), /cannot be used|already used/);
    assert.throws(() => buildTableSpecs(["Bad-Name"], {}), /cannot be used/);
  });

  it("writes models with jsonb doc, position, updated_at, mapped columns and indexes", () => {
    const schema = buildPrismaSchema(buildTableSpecs(["progress"], { progress: ["userId", "courseId"] }));
    assert.match(schema, /provider\s+= "postgresql"/);
    assert.match(schema, /url\s+= env\("DATABASE_URL"\)/);
    assert.match(schema, /directUrl = env\("DIRECT_URL"\)/);
    assert.match(schema, /model Setting \{[^}]*data\s+Json[^}]*@@map\("settings"\)/);
    assert.match(schema, /model Meta \{[^}]*key\s+String @id[^}]*@@map\("meta"\)/);
    const model = /model Progress \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    assert.match(model, /id\s+String\s+@id/);
    assert.match(model, /doc\s+Json/);
    assert.match(model, /position\s+Int/);
    assert.match(model, /updatedAt\s+DateTime @map\("updated_at"\) @db\.Timestamptz\(3\)/);
    assert.match(model, /userId\s+String\?\s+@map\("user_id"\)/);
    assert.match(model, /@@index\(\[position, id\]\)/);
    assert.match(model, /@@index\(\[userId\]\)/);
    assert.match(model, /@@index\(\[courseId\]\)/);
    assert.match(model, /@@map\("progress"\)/);
  });

  it("writes the table map module", () => {
    const text = buildTablesModule(buildTableSpecs(["users"], { users: ["email"] }));
    assert.match(text, /export const PG_TABLES = \{\n {2}users: \{ table: "users", columns: \[\{ key: "email", column: "email" \}\] \},\n\};/);
  });
});

describe("postgres schema: committed files", () => {
  it("has a table for every collection, and nothing else", () => {
    assert.deepEqual(Object.keys(PG_TABLES), [...COLLECTIONS]);
  });

  it("only extracts hot keys the document types really have", () => {
    for (const [name, spec] of Object.entries(PG_TABLES)) {
      for (const { key } of spec.columns) assert.ok((HOT_COLUMN_KEYS as readonly string[]).includes(key), `${name}.${key}`);
    }
    assert.deepEqual(PG_TABLES.users!.columns, [{ key: "email", column: "email" }]);
    assert.deepEqual(PG_TABLES.questions!.columns, []);
    assert.deepEqual(
      PG_TABLES.progress!.columns.map((c) => c.key),
      ["userId", "courseId", "lessonId"],
    );
    assert.ok(PG_TABLES.courses!.columns.some((c) => c.key === "slug"));
  });

  it("matches what the generator produces from COLLECTIONS and types.ts (run `npm run prisma:schema` when this fails)", async () => {
    const { files } = await generate();
    for (const [file, text] of Object.entries(files)) {
      assert.equal(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), text, `${file} is out of date`);
    }
  });

  it("ships an initial migration that creates every table", () => {
    const root = new URL("../prisma/migrations/", import.meta.url);
    const folders = fs.readdirSync(root).filter((name) => /^\d{14}_/.test(name)).sort();
    assert.ok(folders.length >= 1);
    const sql = folders.map((name) => fs.readFileSync(new URL(`${name}/migration.sql`, root), "utf8")).join("\n");
    for (const spec of Object.values(PG_TABLES)) assert.match(sql, new RegExp(`CREATE TABLE "${spec.table}"`), spec.table);
    assert.match(sql, /CREATE TABLE "settings"/);
    assert.match(sql, /CREATE TABLE "meta"/);
    assert.match(fs.readFileSync(new URL("migration_lock.toml", root), "utf8"), /provider = "postgresql"/);
  });
});

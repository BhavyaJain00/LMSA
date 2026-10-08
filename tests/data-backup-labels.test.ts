import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectionLabel,
  countByKind,
  countChanges,
  filterBackups,
  isBackupFileName,
  pageOf,
  signedNumber,
  sortedCounts,
  uploadProblem,
  type BackupKindName,
} from "@/components/admin/settings/data-labels";

/** The pure helpers behind the backups list and the restore dialog. */

const rows = [
  { name: "lms-20260930-auto.json", kind: "auto" as BackupKindName },
  { name: "lms-20260929-101500-manual.json", kind: "manual" as BackupKindName, reason: "Before importing members", createdBy: "Ada (ada@example.com)" },
  { name: "lms-20260929-101700-safety.json", kind: "safety" as BackupKindName, reason: "Before restoring lms-20260920-auto.json" },
  { name: "lms-20260928-090000-upload.json", kind: "upload" as BackupKindName, originalName: "Export from staging.json" },
];

describe("backup list helpers", () => {
  it("names collections", () => {
    assert.equal(collectionLabel("users"), "Members");
    assert.equal(collectionLabel("quizSubmissions"), "Quiz submissions");
    assert.equal(collectionLabel("webhookDeliveries"), "Webhook deliveries");
  });

  it("filters by kind and searches names, notes, authors and original names", () => {
    assert.equal(filterBackups(rows, "all", "").length, 4);
    assert.deepEqual(filterBackups(rows, "manual", "").map((r) => r.kind), ["manual"]);
    assert.deepEqual(filterBackups(rows, "all", "  IMPORTING ").map((r) => r.kind), ["manual"]);
    assert.deepEqual(filterBackups(rows, "all", "ada@").map((r) => r.kind), ["manual"]);
    assert.deepEqual(filterBackups(rows, "all", "staging").map((r) => r.kind), ["upload"]);
    assert.deepEqual(filterBackups(rows, "all", "20260920").map((r) => r.kind), ["safety"]);
    assert.deepEqual(filterBackups(rows, "auto", "staging"), []);
  });

  it("counts backups per kind", () => {
    assert.deepEqual(countByKind(rows), { all: 4, auto: 1, manual: 1, safety: 1, upload: 1 });
    assert.deepEqual(countByKind([]), { all: 0, auto: 0, manual: 0, safety: 0, upload: 0 });
  });

  it("pages and clamps the page number", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    assert.deepEqual(pageOf(items, 1), { items: items.slice(0, 10), page: 1, pages: 3, from: 1, to: 10 });
    assert.deepEqual(pageOf(items, 3).items, [20, 21, 22]);
    assert.equal(pageOf(items, 9).page, 3);
    assert.equal(pageOf(items, 0).page, 1);
    assert.equal(pageOf(items, Number.NaN).page, 1);
    assert.deepEqual(pageOf([], 4), { items: [], page: 1, pages: 1, from: 0, to: 0 });
  });

  it("lists non-empty collections, largest first", () => {
    // Ties are ordered by label: "Courses" before "Members" (users).
    assert.deepEqual(
      sortedCounts({ users: 3, courses: 3, notes: 0, progress: 12 }).map((c) => c.name),
      ["progress", "courses", "users"],
    );
    assert.deepEqual(sortedCounts({}), []);
  });
});

describe("restore preview helpers", () => {
  it("lists collections whose size changes, largest change first", () => {
    const changes = countChanges({ users: 10, courses: 4, notes: 2 }, { users: 7, courses: 4, progress: 20 });
    assert.deepEqual(
      changes.map((c) => [c.name, c.difference]),
      [
        ["progress", 20],
        ["users", -3],
        ["notes", -2],
      ],
    );
    assert.equal(changes[0]!.current, 0);
    assert.deepEqual(countChanges({ users: 1 }, { users: 1 }), []);
  });

  it("formats signed differences with a real minus sign", () => {
    assert.equal(signedNumber(1200), "+1,200");
    assert.equal(signedNumber(-3), "−3");
    assert.equal(signedNumber(0), "0");
  });
});

describe("upload checks", () => {
  it("accepts backup extensions only, within the size limit", () => {
    assert.equal(isBackupFileName("Backup.JSON"), true);
    assert.equal(isBackupFileName("export.json"), true);
    assert.equal(isBackupFileName("lms.sqlite"), false, "SQLite files are copied with npm run db:to-postgres, not restored here");
    assert.equal(isBackupFileName("photo.png"), false);
    assert.match(uploadProblem({ name: "photo.png", size: 10 }, 1024) ?? "", /Choose a backup file/);
    assert.match(uploadProblem({ name: "a.json", size: 0 }, 1024) ?? "", /empty/);
    assert.match(uploadProblem({ name: "a.json", size: 3 * 1024 * 1024 }, 2 * 1024 * 1024) ?? "", /larger than the 2 MB limit/);
    assert.equal(uploadProblem({ name: "a.json", size: 100 }, 1024), null);
  });
});

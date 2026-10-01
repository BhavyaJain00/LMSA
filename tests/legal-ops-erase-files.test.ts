import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { JobApplication } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { personalUploadUrls } from "@/lib/legal/erase";
import { deleteErasedUploads } from "@/lib/legal/erase-files";
import { makeUser, resetDb } from "./helpers/db";

function upload(key: string, body = "x"): string {
  const file = path.join(siteConfig.uploadDir, ...key.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const application = (id: string, userId: string, resumeUrl?: string) => ({ id, userId, resumeUrl }) as unknown as JobApplication;

describe("files of an erased account", () => {
  it("lists the person's own uploads once, ignoring empty fields", () => {
    const ada = makeUser({ id: "usr_ada", avatarUrl: "/uploads/images/ada.png", coverImageUrl: "/uploads/images/ada.png" });
    const bob = makeUser({ id: "usr_bob", avatarUrl: "/uploads/images/bob.png" });
    const db = { users: [ada, bob], jobApplications: [application("ja_1", ada.id, "/uploads/files/cv.pdf"), application("ja_2", ada.id), application("ja_3", bob.id, "/uploads/files/bob.pdf")] };
    assert.deepEqual(personalUploadUrls(db, ada.id), ["/uploads/images/ada.png", "/uploads/files/cv.pdf"]);
    assert.deepEqual(personalUploadUrls(db, "usr_missing"), []);
  });

  it("deletes files nothing refers to any more and keeps shared or external ones", async () => {
    const own = upload("images/erase-own.png");
    const shared = upload("images/erase-shared.png");
    await resetDb({ users: [makeUser({ id: "usr_admin", avatarUrl: "/uploads/images/erase-shared.png" })] });
    const deleted = await deleteErasedUploads(["/uploads/images/erase-own.png", "/uploads/images/erase-shared.png", "https://cdn.example.com/a.png", "data:image/png;base64,AAAA"]);
    assert.equal(deleted, 1);
    assert.equal(fs.existsSync(own), false);
    assert.equal(fs.existsSync(shared), true, "still used by another member");
  });
});

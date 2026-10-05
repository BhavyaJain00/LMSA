import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadRoot } from "@/lib/storage";
import { loadAvatarDataUri } from "@/lib/seo/avatar-image";
import {
  MAX_AVATAR_BYTES,
  avatarDataUri,
  bioSummary,
  initialsColor,
  isIndexableProfile,
  isIndexableProfileFor,
  profileCardContent,
  sniffAvatarMime,
} from "@/lib/seo/profile-card";
import { buildSettings } from "./helpers/db";

/** Member profile share cards: who gets one, what it says, and which avatar files may be embedded. */

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF_HEAD = Buffer.from("GIF89a", "ascii");

describe("isIndexableProfile", () => {
  const teacher = { user: { enabled: true }, stats: { teaching: 2 } };

  it("indexes enabled members who teach a published course while guests may browse", () => {
    assert.equal(isIndexableProfile(teacher, true), true);
    assert.equal(isIndexableProfileFor(teacher, buildSettings({ learning: { allowGuestAccess: true } })), true);
  });

  it("keeps learners, disabled members and closed sites out", () => {
    assert.equal(isIndexableProfile({ user: { enabled: true }, stats: { teaching: 0 } }, true), false);
    assert.equal(isIndexableProfile({ user: { enabled: false }, stats: { teaching: 3 } }, true), false);
    assert.equal(isIndexableProfile(teacher, false), false);
    assert.equal(isIndexableProfileFor(teacher, buildSettings({ learning: { allowGuestAccess: false } })), false);
  });
});

describe("profileCardContent", () => {
  const base = {
    user: { name: "Maya Patel", username: "maya", headline: "Design lead at Acme", bio: "Long **bio**." },
    stats: { teaching: 3, certificates: 1, badges: 5, completed: 4 },
  };
  const on = { certifications: true, badges: true };

  it("shows the name, headline and the numbers that matter", () => {
    const card = profileCardContent(base, on);
    assert.equal(card.eyebrow, "Instructor");
    assert.equal(card.title, "Maya Patel");
    assert.equal(card.summary, "Design lead at Acme");
    assert.deepEqual(card.facts, ["3 courses taught", "1 certificate", "5 badges", "@maya"]);
  });

  it("skips zero counts and disabled features, and fills in completed courses", () => {
    const card = profileCardContent({ ...base, stats: { teaching: 1, certificates: 0, badges: 7, completed: 2 } }, { certifications: true, badges: false });
    assert.deepEqual(card.facts, ["1 course taught", "2 courses completed", "@maya"]);
  });

  it("falls back to the bio without markdown, then to nothing", () => {
    const fromBio = profileCardContent({ ...base, user: { ...base.user, headline: " ", bio: "## Hi\nI teach [Figma](https://x.test) and *UX*." } }, on);
    assert.equal(fromBio.summary, "Hi I teach Figma and UX .");
    const none = profileCardContent({ ...base, user: { name: "", username: "anon" } }, on);
    assert.equal(none.summary, undefined);
    assert.equal(none.title, "@anon");
  });

  it("member cards say Member", () => {
    assert.equal(profileCardContent({ ...base, stats: { teaching: 0, certificates: 2, badges: 0, completed: 0 } }, on).eyebrow, "Member");
  });
});

describe("bioSummary", () => {
  it("cuts long bios at a word boundary with an ellipsis", () => {
    const out = bioSummary("word ".repeat(80), 40);
    assert.ok(out.length <= 41, out);
    assert.ok(out.endsWith("word…"), out);
  });

  it("drops code blocks and images", () => {
    assert.equal(bioSummary("Intro ![me](/a.png)\n```js\nsecret()\n```\nOutro"), "Intro Outro");
  });
});

describe("avatar bytes", () => {
  it("recognises PNG and JPEG by their signatures only", () => {
    assert.equal(sniffAvatarMime(PNG_1PX), "image/png");
    assert.equal(sniffAvatarMime(JPEG_HEAD), "image/jpeg");
    assert.equal(sniffAvatarMime(GIF_HEAD), null);
    assert.equal(sniffAvatarMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffAvatarMime(new Uint8Array()), null);
  });

  it("builds data URIs and refuses empty, oversized or unknown files", () => {
    assert.equal(avatarDataUri(PNG_1PX), `data:image/png;base64,${PNG_1PX.toString("base64")}`);
    assert.equal(avatarDataUri(new Uint8Array()), null);
    assert.equal(avatarDataUri(GIF_HEAD), null);
    const big = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    PNG_1PX.copy(big);
    assert.equal(avatarDataUri(big), null);
  });

  it("derives a stable hex color for initials", () => {
    const color = initialsColor("Maya Patel");
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.equal(initialsColor("Maya Patel"), color);
    assert.notEqual(initialsColor("Alex Kim"), color);
  });
});

describe("loadAvatarDataUri", () => {
  const root = uploadRoot();

  before(async () => {
    await fs.mkdir(path.join(root, "images"), { recursive: true });
    await fs.mkdir(path.join(root, "videos"), { recursive: true });
    await fs.writeFile(path.join(root, "images", "maya.png"), PNG_1PX);
    await fs.writeFile(path.join(root, "images", "fake.png"), "not an image");
    await fs.writeFile(path.join(root, "videos", "poster.png"), PNG_1PX);
  });

  after(async () => {
    await fs.rm(path.join(root, "images"), { recursive: true, force: true });
    await fs.rm(path.join(root, "videos"), { recursive: true, force: true });
  });

  it("embeds a stored PNG upload (relative or on this site's origin)", async () => {
    const expected = `data:image/png;base64,${PNG_1PX.toString("base64")}`;
    assert.equal(await loadAvatarDataUri("/uploads/images/maya.png"), expected);
    assert.equal(await loadAvatarDataUri("http://localhost:3000/uploads/images/maya.png"), expected);
  });

  it("never reads protected videos, other hosts, traversal paths or non-images", async () => {
    assert.equal(await loadAvatarDataUri("/uploads/videos/poster.png"), null);
    assert.equal(await loadAvatarDataUri("/uploads/VIDEOS/poster.png"), null);
    assert.equal(await loadAvatarDataUri("https://evil.test/uploads/images/maya.png"), null);
    assert.equal(await loadAvatarDataUri("http://169.254.169.254/latest/meta-data"), null);
    assert.equal(await loadAvatarDataUri("/uploads/%2e%2e/package.json"), null);
    assert.equal(await loadAvatarDataUri("/uploads/images/..%2f..%2fpackage.json"), null);
    assert.equal(await loadAvatarDataUri("/../package.json"), null);
    assert.equal(await loadAvatarDataUri("/uploads/images/fake.png"), null);
    assert.equal(await loadAvatarDataUri("/uploads/images/missing.png"), null);
    assert.equal(await loadAvatarDataUri("//evil.test/a.png"), null);
    assert.equal(await loadAvatarDataUri(""), null);
    assert.equal(await loadAvatarDataUri(undefined), null);
  });

  it("does not embed non-image files from public/", async () => {
    assert.equal(await loadAvatarDataUri("/sw.js"), null);
    assert.equal(await loadAvatarDataUri("/icon.svg"), null);
  });
});

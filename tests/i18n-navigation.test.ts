import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "@/lib/db/defaults";
import { buildNavigation, englishShellLabel, type ShellLabel } from "@/lib/nav";
import { buildPaletteConfig, paletteGroupFor } from "@/components/command-palette/config";
import { createTranslator } from "@/i18n/translate";
import { catalogMessages, englishMessages } from "@/i18n/catalog";
import type { PublicUser } from "@/lib/types";

const admin = { id: "usr_admin", username: "admin", name: "Admin", email: "a@x.test", roles: ["admin"], enabled: true, createdAt: "" } as unknown as PublicUser;

function settingsWithLinks() {
  const s = defaultSettings();
  return { ...s, contact: { ...s.contact, url: "https://example.test/contact" } };
}

/** The Arabic shell translator, as the server's `getT("shell")` builds it. */
function arabicShell(): ShellLabel {
  return createTranslator({ locale: "ar", namespace: "shell", messages: catalogMessages("ar", "shell"), fallback: englishMessages("shell") });
}

describe("i18n: navigation consumers group by section key, not by translated title", () => {
  it("translated shell labels change titles but not the stable section keys", () => {
    const english = buildNavigation(admin, settingsWithLinks());
    const arabic = buildNavigation(admin, settingsWithLinks(), {}, arabicShell());
    assert.deepEqual(
      arabic.map((s) => s.key),
      english.map((s) => s.key),
    );
    const manage = arabic.find((s) => s.key === "manage");
    assert.ok(manage, "admins see the manage section");
    assert.notEqual(manage.title, "Manage", "the Arabic title is translated");
  });

  it("maps sections to palette groups by key", () => {
    assert.equal(paletteGroupFor({ key: "manage" }), "Manage");
    assert.equal(paletteGroupFor({ key: "links" }), "Links");
    assert.equal(paletteGroupFor({ key: "main" }), "Jump to");
    assert.equal(paletteGroupFor({ key: "you" }), "Jump to");
  });

  it("keeps admin links under Manage when the shell is in Arabic, with Arabic labels", () => {
    const english = buildPaletteConfig(admin, settingsWithLinks(), englishShellLabel);
    const arabic = buildPaletteConfig(admin, settingsWithLinks(), arabicShell());
    const groupOf = (cfg: typeof english, href: string) => cfg.commands.find((c) => c.href === href)?.group;
    for (const href of ["/admin", "/admin/courses", "/admin/settings"]) {
      assert.equal(groupOf(english, href), "Manage", href);
      assert.equal(groupOf(arabic, href), "Manage", href);
    }
    assert.equal(groupOf(arabic, "https://example.test/contact"), "Links");
    const label = (cfg: typeof english, href: string) => cfg.commands.find((c) => c.href === href)?.label;
    assert.equal(label(english, "/admin/courses"), englishShellLabel("nav.manageCourses"));
    assert.notEqual(label(arabic, "/admin/courses"), label(english, "/admin/courses"), "palette labels follow the shell language");
  });
});

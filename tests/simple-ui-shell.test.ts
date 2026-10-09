import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "@/lib/db/defaults";
import { buildNavigation, buildShellNav, isShellItemActive } from "@/lib/nav";
import { buildMobileTabs, isTabActive } from "@/components/layout/mobile-tabs";
import { DEFAULT_THEME, THEME_STORAGE_KEY, themeInitScript } from "@/components/ui/theme";
import { editorialLines, splitTagline } from "@/components/catalog/landing/tagline";
import type { PublicUser, Settings } from "@/lib/types";

const student = { id: "usr_s", username: "sam", name: "Sam", email: "s@x.test", roles: ["student"], enabled: true, createdAt: "" } as unknown as PublicUser;
const admin = { id: "usr_a", username: "admin", name: "Admin", email: "a@x.test", roles: ["admin"], enabled: true, createdAt: "" } as unknown as PublicUser;

function shell(user: PublicUser | null, settings: Settings = defaultSettings()) {
  return buildShellNav(user, settings, buildNavigation(user, settings, { messages: 2, grading: 3 }));
}

describe("simple shell navigation", () => {
  it("gives guests only Home, Courses and Discussions, with Home on the landing page", () => {
    const nav = shell(null);
    assert.deepEqual(
      nav.primary.map((i) => i.key),
      ["home", "courses", "discussions"],
    );
    const home = nav.primary[0]!;
    assert.equal(home.href, "/");
    assert.equal(isShellItemActive(home, "/"), true);
    assert.equal(isShellItemActive(home, "/courses"), false);
    assert.equal(nav.manage, null);
    assert.deepEqual(nav.account, []);
  });

  it("sends members home to their dashboard and adds Messages with its unread count", () => {
    const nav = shell(student);
    assert.deepEqual(
      nav.primary.map((i) => i.key),
      ["home", "courses", "discussions", "messages"],
    );
    assert.equal(nav.primary[0]!.href, "/dashboard");
    assert.equal(nav.primary.find((i) => i.key === "messages")!.badge, 2);
    assert.equal(nav.manage, null, "learners get no staff tools");
    assert.ok(nav.account.some((i) => i.href === "/user/sam"), "the profile is in the account menu");
    assert.ok(!nav.account.some((i) => i.href === "/notifications" || i.href === "/messages"), "notifications and messages are not repeated in the menu");
  });

  it("adds one Manage entry for staff, with the grading count and the grouped tools behind it", () => {
    const nav = shell(admin);
    const manage = nav.primary.at(-1)!;
    assert.equal(manage.key, "manage");
    assert.equal(manage.href, "/admin");
    assert.equal(manage.badge, 3);
    assert.ok(nav.manage && nav.manage.length > 1);
    assert.equal(nav.manage![0]!.id, "overview");
    assert.equal(isShellItemActive(manage, "/admin/settings/coupons"), true);
  });

  it("lights up Courses on the catalog's sibling pages", () => {
    const courses = shell(student).primary.find((i) => i.key === "courses")!;
    for (const path of ["/courses", "/courses/intro-to-js", "/batches/cohort-4", "/programs", "/bundles/starter", "/pricing"]) {
      assert.equal(isShellItemActive(courses, path), true, path);
    }
    assert.equal(isShellItemActive(courses, "/community"), false);
  });

  it("follows the feature switches", () => {
    const settings = defaultSettings();
    const off = { ...settings, features: { ...settings.features, discussions: false }, messaging: { ...settings.messaging, enabled: false } };
    assert.deepEqual(
      shell(student, off).primary.map((i) => i.key),
      ["home", "courses"],
    );
  });

  it("keeps the phone tabs to Home, Courses and Discussions", () => {
    for (const user of [null, student, admin]) {
      assert.deepEqual(
        buildMobileTabs(user, defaultSettings()).map((t) => t.key),
        ["home", "courses", "discussions"],
      );
    }
    const [home] = buildMobileTabs(null, defaultSettings());
    assert.equal(isTabActive("/courses", home!.match, home!.exact ? home!.href : undefined), false);
    assert.equal(isTabActive("/", home!.match, home!.exact ? home!.href : undefined), true);
  });
});

/** Run the pre-paint theme script against a fake document, storage and media query. */
function runThemeScript(saved: string | null, systemDark = false, storageThrows = false): string | null {
  let theme: string | null = null;
  const document = { documentElement: { setAttribute: (_name: string, value: string) => (theme = value) } };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_STORAGE_KEY ? saved : null;
    },
  };
  const window = { matchMedia: () => ({ matches: systemDark }) };
  new Function("document", "localStorage", "window", themeInitScript)(document, localStorage, window);
  return theme;
}

describe("theme", () => {
  it("is dark for visitors who never chose", () => {
    assert.equal(DEFAULT_THEME, "dark");
    assert.equal(runThemeScript(null), "dark");
    assert.equal(runThemeScript(null, false, true), "dark", "blocked storage still gets the default");
  });

  it("keeps a saved choice and follows the system only when asked to", () => {
    assert.equal(runThemeScript("light"), "light");
    assert.equal(runThemeScript("dark"), "dark");
    assert.equal(runThemeScript("system", false), "light");
    assert.equal(runThemeScript("system", true), "dark");
    assert.equal(runThemeScript("purple"), "dark", "unknown values fall back to the default");
  });
});

describe("home headline", () => {
  it("puts the first sentence on the plain line and the rest on the accent line", () => {
    assert.deepEqual(splitTagline("Learn by doing. Master real skills."), ["Learn by doing.", "Master real skills."]);
    assert.deepEqual(splitTagline("  Ready? Let's build!  "), ["Ready?", "Let's build!"]);
  });

  it("keeps a single sentence on one line", () => {
    assert.deepEqual(splitTagline("Learn with LearnLoop"), ["Learn with LearnLoop", null]);
    assert.deepEqual(splitTagline("Version 2.0 is here"), ["Version 2.0 is here", null]);
  });

  it("sets each sentence as bold words followed by its last word in serif", () => {
    assert.deepEqual(editorialLines("Learn by doing. Master real skills."), [
      { text: "Learn by", style: "bold" },
      { text: "doing.", style: "serif" },
      { text: "Master real", style: "bold" },
      { text: "skills.", style: "serif" },
    ]);
    assert.deepEqual(editorialLines("Learn with LearnLoop"), [
      { text: "Learn with", style: "bold" },
      { text: "LearnLoop", style: "serif" },
    ]);
  });

  it("keeps one-word sentences bold and folds extra sentences into the second", () => {
    assert.deepEqual(editorialLines("Hello."), [{ text: "Hello.", style: "bold" }]);
    assert.deepEqual(
      editorialLines("Learn. Build things. Ship them."),
      [
        { text: "Learn.", style: "bold" },
        { text: "Build things. Ship", style: "bold" },
        { text: "them.", style: "serif" },
      ],
    );
    assert.deepEqual(editorialLines("   "), []);
  });
});

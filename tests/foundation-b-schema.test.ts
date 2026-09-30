import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PublicUser, Settings } from "@/lib/types";
import { COLLECTIONS } from "@/lib/db/store";
import { defaultSettings, mergeSettings } from "@/lib/db/defaults";
import { buildSeedBundles, buildSeedPlans, buildSeedRubrics, buildSeedTaxRules } from "@/lib/db/seed-round3b";
import { buildSeedDatabase } from "@/lib/db/seed";
import { buildNavigation, managesOrganization } from "@/lib/nav";
import { resetDb } from "./helpers/db";

/**
 * Round 3 wave B foundation: new collections, settings groups (and how older
 * databases pick them up), demo plans/bundle/tax rules/rubric and navigation.
 */

const WAVE_B_COLLECTIONS = [
  "plans",
  "subscriptions",
  "bundles",
  "gifts",
  "upsells",
  "taxRules",
  "checkoutSessions",
  "affiliates",
  "affiliateReferrals",
  "commissions",
  "organizations",
  "orgSeats",
  "analyticsEvents",
  "broadcasts",
  "emailSequences",
  "sequenceEnrollments",
  "emailEvents",
  "conversations",
  "directMessages",
  "apiKeys",
  "webhookEndpoints",
  "webhookDeliveries",
  "rubrics",
  "peerReviews",
  "lessonVersions",
  "instructorProfiles",
  "earnings",
  "payouts",
] as const;

describe("wave B collections", () => {
  it("registers every new collection exactly once", () => {
    for (const name of WAVE_B_COLLECTIONS) assert.ok(COLLECTIONS.includes(name), `${name} is in COLLECTIONS`);
    assert.equal(new Set(COLLECTIONS).size, COLLECTIONS.length, "no duplicates");
  });

  it("creates every collection as an empty array when a database lacks them", async () => {
    const db = await resetDb();
    for (const name of WAVE_B_COLLECTIONS) assert.deepEqual(db[name], [], name);
  });

  it("the seed database covers exactly the store collections", async () => {
    const seed = await buildSeedDatabase();
    assert.deepEqual(Object.keys(seed).filter((k) => k !== "settings").sort(), [...COLLECTIONS].sort());
  });
});

describe("wave B demo data", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("seeds a monthly plan with a trial and a cheaper yearly plan", () => {
    const [monthly, yearly] = buildSeedPlans(now);
    assert.equal(monthly!.name, "All-Access Monthly");
    assert.equal(monthly!.interval, "month");
    assert.equal(monthly!.price, 1900);
    assert.equal(monthly!.trialDays, 7);
    assert.equal(yearly!.name, "All-Access Yearly");
    assert.equal(yearly!.interval, "year");
    assert.equal(yearly!.price, 15900);
    assert.ok(yearly!.price < monthly!.price * 12);
    for (const plan of [monthly!, yearly!]) {
      assert.equal(plan.currency, "USD");
      assert.deepEqual(plan.access, { type: "all" });
      assert.ok(plan.active && plan.features.length >= 3);
      assert.match(plan.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("seeds the Full-Stack Starter bundle of two existing courses", async () => {
    const [bundle] = buildSeedBundles(now);
    assert.equal(bundle!.title, "Full-Stack Starter Bundle");
    assert.deepEqual(bundle!.courseIds, ["crs_js", "crs_react"]);
    assert.equal(bundle!.price, 5900);
    assert.ok(bundle!.published);
    const seed = await buildSeedDatabase();
    const courses = new Set(seed.courses.map((c) => c.id));
    for (const id of bundle!.courseIds) assert.ok(courses.has(id), id);
  });

  it("seeds exclusive Indian GST and inclusive UK/German VAT", () => {
    const rules = buildSeedTaxRules();
    assert.deepEqual(
      rules.map((r) => [r.country, r.name, r.rate, r.inclusive]),
      [
        ["IN", "GST", 18, false],
        ["GB", "VAT", 20, true],
        ["DE", "VAT", 19, true],
      ],
    );
  });

  it("seeds a project rubric with three scored criteria", async () => {
    const [rubric] = buildSeedRubrics(now);
    assert.equal(rubric!.title, "Project rubric");
    assert.equal(rubric!.criteria.length, 3);
    assert.equal(new Set(rubric!.criteria.map((c) => c.id)).size, 3);
    for (const criterion of rubric!.criteria) {
      assert.ok(criterion.levels.length >= 3);
      const points = criterion.levels.map((l) => l.points);
      assert.deepEqual(points, [...points].sort((a, b) => a - b), "levels go from lowest to highest");
    }
    const seed = await buildSeedDatabase();
    assert.ok(seed.users.some((u) => u.id === rubric!.createdById));
    assert.equal(seed.plans.length, 2);
    assert.equal(seed.bundles.length, 1);
    assert.equal(seed.taxRules.length, 3);
    assert.equal(seed.rubrics.length, 1);
  });
});

describe("wave B settings", () => {
  it("has the documented defaults", () => {
    const d = defaultSettings();
    assert.deepEqual(d.growth, {
      affiliatesEnabled: true,
      affiliateAutoApprove: true,
      defaultCommissionPercent: 20,
      cookieDays: 30,
      abandonedCheckoutEnabled: true,
      abandonedCheckoutDelaysHours: [1, 24, 72],
      abandonedCheckoutCouponPercent: 10,
      giftsEnabled: true,
      teamsEnabled: true,
      subscriptionsEnabled: true,
      bundlesEnabled: true,
      installmentsEnabled: true,
      taxMode: "none",
      multiCurrency: false,
    });
    assert.deepEqual(d.marketplace, { enabled: false, defaultRevenueSharePercent: 70, allowApplications: true });
    assert.deepEqual(d.api, { enabled: true });
    assert.deepEqual(d.messaging, { enabled: true, studentToStudent: false });
    assert.equal(d.email.trackOpens, true);
    assert.equal(d.email.trackClicks, true);
  });

  it("fills the new groups and email tracking in for settings saved before wave B", () => {
    const legacy = structuredClone(defaultSettings()) as Partial<Settings>;
    delete legacy.growth;
    delete legacy.marketplace;
    delete legacy.api;
    delete legacy.messaging;
    const email = { ...defaultSettings().email, fromName: "Acme" } as Partial<Settings["email"]>;
    delete email.trackOpens;
    delete email.trackClicks;
    legacy.email = email as Settings["email"];
    const merged = mergeSettings(legacy);
    assert.equal(merged.email.fromName, "Acme");
    assert.equal(merged.email.trackOpens, true);
    assert.equal(merged.email.trackClicks, true);
    assert.deepEqual(merged.growth, defaultSettings().growth);
    assert.deepEqual(merged.marketplace, defaultSettings().marketplace);
    assert.deepEqual(merged.api, defaultSettings().api);
    assert.deepEqual(merged.messaging, defaultSettings().messaging);
  });

  it("keeps stored values and sanitizes reminder delays and the tax mode", () => {
    const merged = mergeSettings({
      growth: { cookieDays: 60, taxMode: "by_country", abandonedCheckoutDelaysHours: [72, "24", 24, 0, 1.5, 9999, 3] as unknown as number[] } as Settings["growth"],
      marketplace: { enabled: true } as Settings["marketplace"],
    });
    assert.equal(merged.growth.cookieDays, 60);
    assert.equal(merged.growth.taxMode, "by_country");
    assert.deepEqual(merged.growth.abandonedCheckoutDelaysHours, [3, 24, 72], "unique, in range, earliest first");
    assert.equal(merged.growth.defaultCommissionPercent, 20);
    assert.equal(merged.marketplace.enabled, true);
    assert.equal(merged.marketplace.defaultRevenueSharePercent, 70);
    const odd = mergeSettings({ growth: { taxMode: "vat", abandonedCheckoutDelaysHours: "24" } as unknown as Settings["growth"] });
    assert.equal(odd.growth.taxMode, "none");
    assert.deepEqual(odd.growth.abandonedCheckoutDelaysHours, [1, 24, 72]);
    assert.deepEqual(mergeSettings({ growth: { abandonedCheckoutDelaysHours: [] as number[] } as Settings["growth"] }).growth.abandonedCheckoutDelaysHours, [1, 24, 72]);
  });
});

describe("wave B navigation", () => {
  const student: PublicUser = { id: "usr_s", username: "s", name: "S", email: "s@x.test", roles: ["student"], enabled: true, createdAt: "" };
  const hrefs = (sections: ReturnType<typeof buildNavigation>) => sections.flatMap((s) => s.items.map((i) => i.href));
  const withSettings = (patch: (s: Settings) => void) => {
    const s = defaultSettings();
    patch(s);
    return s;
  };

  it("shows membership and bundles to everyone while they are enabled", () => {
    const on = defaultSettings();
    for (const viewer of [null, student]) {
      const links = hrefs(buildNavigation(viewer, on));
      assert.ok(links.includes("/pricing") && links.includes("/bundles"));
    }
    const off = withSettings((s) => {
      s.growth.subscriptionsEnabled = false;
      s.growth.bundlesEnabled = false;
    });
    const links = hrefs(buildNavigation(student, off));
    assert.ok(!links.includes("/pricing") && !links.includes("/bundles"));
  });

  it("gives members messages and the affiliate programme per settings, never guests", () => {
    const on = defaultSettings();
    const guest = hrefs(buildNavigation(null, on));
    assert.ok(!guest.includes("/messages") && !guest.includes("/affiliate") && !guest.includes("/team"));
    const member = buildNavigation(student, on, { messages: 3 });
    assert.ok(hrefs(member).includes("/messages") && hrefs(member).includes("/affiliate"));
    assert.equal(member.flatMap((s) => s.items).find((i) => i.href === "/messages")?.badge, 3);
    const off = withSettings((s) => {
      s.messaging.enabled = false;
      s.growth.affiliatesEnabled = false;
    });
    const links = hrefs(buildNavigation(student, off));
    assert.ok(!links.includes("/messages") && !links.includes("/affiliate"));
  });

  it("offers Teach only while the marketplace takes applications", () => {
    assert.ok(!hrefs(buildNavigation(student, defaultSettings())).includes("/teach"), "marketplace is off by default");
    const open = withSettings((s) => (s.marketplace.enabled = true));
    assert.ok(hrefs(buildNavigation(student, open)).includes("/teach"));
    const closed = withSettings((s) => {
      s.marketplace.enabled = true;
      s.marketplace.allowApplications = false;
    });
    assert.ok(!hrefs(buildNavigation(student, closed)).includes("/teach"));
  });

  it("shows My team only to organization owners and managers", () => {
    const orgs = [{ ownerId: "usr_owner", managerIds: ["usr_manager"] }];
    assert.equal(managesOrganization(orgs, "usr_owner"), true);
    assert.equal(managesOrganization(orgs, "usr_manager"), true);
    assert.equal(managesOrganization(orgs, "usr_s"), false);
    assert.equal(managesOrganization(orgs, null), false);
    assert.ok(!hrefs(buildNavigation(student, defaultSettings())).includes("/team"));
    assert.ok(hrefs(buildNavigation(student, defaultSettings(), { managesOrg: true })).includes("/team"));
  });
});

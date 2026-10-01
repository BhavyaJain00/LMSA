import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { saveTrackingSettingsAction } from "@/lib/actions/seo-settings";
import { ga4Params, metaPixelEvent, normalizeGa4Id, normalizeMetaPixelId, parseTrackingSettings, purchaseEventParams, trackingUrl } from "@/lib/seo/tracking";
import { disableGa4, installGa4, installMetaPixel, setTrackingState, track } from "@/components/seo/tracking-client";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

describe("tracking ids", () => {
  it("accepts GA4 measurement ids and numeric pixel ids", () => {
    assert.equal(normalizeGa4Id(" g-ab12cd34ef "), "G-AB12CD34EF");
    assert.equal(normalizeGa4Id(""), "");
    assert.equal(normalizeGa4Id("UA-12345-1"), null);
    assert.equal(normalizeGa4Id("G-<script>"), null);
    assert.equal(normalizeMetaPixelId("123456789012345"), "123456789012345");
    assert.equal(normalizeMetaPixelId("12ab"), null);
    const parsed = parseTrackingSettings({ ga4Id: "G-ABCDEF12", metaPixelId: "" });
    assert.deepEqual(parsed, { errors: {}, patch: { ga4Id: "G-ABCDEF12", metaPixelId: undefined } });
    const bad = parseTrackingSettings({ ga4Id: "nope", metaPixelId: "x" });
    assert.ok(bad.errors.ga4Id && bad.errors.metaPixelId);
  });
});

describe("trackingUrl", () => {
  it("drops the query of pages whose links carry secrets", () => {
    assert.equal(trackingUrl("https://learn.example/free/confirm?l=lead_1&e=123&t=abc#x"), "https://learn.example/free/confirm");
    assert.equal(trackingUrl("https://learn.example/reset-password?token=abc"), "https://learn.example/reset-password");
    assert.equal(trackingUrl("https://learn.example/api/email/unsubscribe?t=1"), "https://learn.example/api/email/unsubscribe");
  });

  it("removes token and personal parameters elsewhere but keeps campaign parameters", () => {
    assert.equal(
      trackingUrl("https://learn.example/courses/sql?utm_source=news&email=a%40b.c&token=1&gclid=xyz&page=2"),
      "https://learn.example/courses/sql?utm_source=news&gclid=xyz&page=2",
    );
    assert.equal(trackingUrl("not a url"), "");
  });
});

describe("event mapping", () => {
  it("maps app events to Meta standard events with value and contents", () => {
    const params = purchaseEventParams({ orderId: "ORD-1", amount: 4999, currency: "usd", taxAmount: 500, couponCode: "SPRING", itemType: "course", itemId: "crs_sql", itemTitle: "SQL" });
    assert.equal(params.value, 49.99);
    assert.equal(params.currency, "USD");
    assert.equal(params.tax, 5);
    assert.equal(params.coupon, "SPRING");
    const meta = metaPixelEvent("purchase", params);
    assert.equal(meta.method, "track");
    assert.equal(meta.name, "Purchase");
    assert.deepEqual(meta.params, { value: 49.99, currency: "USD", content_ids: ["course:crs_sql"], content_type: "product", contents: [{ id: "course:crs_sql", quantity: 1 }], num_items: 1 });
    assert.deepEqual(metaPixelEvent("generate_lead", { source: "blog" }), { method: "track", name: "Lead", params: { content_category: "blog" } });
    const custom = metaPixelEvent("watched-video!", { lesson: "intro", n: 2 });
    assert.equal(custom.method, "trackCustom");
    assert.equal(custom.name, "watched_video_");
    assert.deepEqual(custom.params, { lesson: "intro", n: 2 });
  });

  it("cleans GA4 parameters", () => {
    assert.deepEqual(ga4Params({ a: undefined, b: "x".repeat(150), c: 3 }), { b: "x".repeat(100), c: 3 });
    assert.equal(purchaseEventParams({ orderId: "O", amount: 1000, currency: "EUR", itemType: "plan", itemId: "p", itemTitle: "Pro" }).coupon, undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Browser module with a fake window                                   */
/* ------------------------------------------------------------------ */

describe("track()", () => {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const store = new Map<string, string>();
  let fakeWindow: Record<string, unknown>;

  before(() => {
    fakeWindow = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    };
    g.window = fakeWindow;
  });
  after(() => {
    delete g.window;
  });

  const layerEvents = () =>
    ((fakeWindow.dataLayer as IArguments[] | undefined) ?? [])
      .map((args) => Array.from(args))
      .filter((a) => a[0] === "event")
      .map((a) => a[1]);

  it("queues events fired before the consent state is known and sends them once it allows", () => {
    track("generate_lead", { source: "footer" });
    installGa4("G-TEST1234", false);
    setTrackingState({ ga4Id: "G-TEST1234", analytics: true, marketing: false });
    assert.deepEqual(layerEvents(), ["generate_lead"]);
    const layer = (fakeWindow.dataLayer as IArguments[]).map((a) => Array.from(a));
    assert.deepEqual(layer[0], ["consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
    assert.deepEqual(layer.find((a) => a[0] === "config"), ["config", "G-TEST1234", { send_page_view: false }]);
  });

  it("sends nothing without consent and stops after withdrawal", () => {
    const before = layerEvents().length;
    disableGa4("G-TEST1234");
    setTrackingState({ ga4Id: "G-TEST1234", analytics: false, marketing: false });
    track("page_view", { page_title: "x" });
    assert.equal(layerEvents().length, before);
    assert.equal(fakeWindow["ga-disable-G-TEST1234"], true);
  });

  it("sends a once-only event a single time per browser and forwards to the Pixel with marketing consent", () => {
    installGa4("G-TEST1234", true);
    installMetaPixel("123456789");
    setTrackingState({ ga4Id: "G-TEST1234", metaPixelId: "123456789", analytics: true, marketing: true });
    const params = purchaseEventParams({ orderId: "ORD-9", amount: 2000, currency: "USD", itemType: "course", itemId: "c", itemTitle: "C" });
    track("purchase", params, "purchase:ORD-9");
    track("purchase", params, "purchase:ORD-9");
    assert.equal(layerEvents().filter((e) => e === "purchase").length, 1);
    assert.equal(store.get("ll_tracked:purchase:ORD-9"), "1");
    const queue = (fakeWindow.fbq as { queue: unknown[][] }).queue;
    assert.deepEqual(queue[0], ["init", "123456789"]);
    const purchase = queue.find((call) => call[1] === "Purchase")!;
    assert.equal(purchase[0], "track");
    assert.deepEqual(purchase[3], { eventID: "ORD-9" });
  });
});

describe("saveTrackingSettingsAction", () => {
  beforeEach(async () => {
    resetRequest();
    await resetDb({ users: [makeUser({ id: "usr_admin", roles: ["admin"] }), makeUser({ id: "usr_mod", roles: ["moderator"] })] });
  });

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("saves valid ids for admins only", async () => {
    await createSession("usr_mod");
    assert.equal((await saveTrackingSettingsAction(null, form({ ga4Id: "G-ABCDEF12", metaPixelId: "" }))).ok, false);
    resetRequest();
    await createSession("usr_admin");
    const bad = await saveTrackingSettingsAction(null, form({ ga4Id: "UA-1", metaPixelId: "" }));
    assert.equal(bad.ok, false);
    const ok = await saveTrackingSettingsAction(null, form({ ga4Id: "g-abcdef12", metaPixelId: "1234567890" }));
    assert.equal(ok.ok, true);
    const { seo } = (await getDb()).settings;
    assert.equal(seo.ga4Id, "G-ABCDEF12");
    assert.equal(seo.metaPixelId, "1234567890");
    await saveTrackingSettingsAction(null, form({ ga4Id: "", metaPixelId: "" }));
    assert.equal((await getDb()).settings.seo.ga4Id, undefined);
  });
});

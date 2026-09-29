import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@/lib/auth/session";
import { findById } from "@/lib/db/store";
import { feedPathFor, findUserByFeedToken } from "@/lib/calendar/token";
import { disableCalendarFeedAction, enableCalendarFeedAction, regenerateCalendarFeedAction } from "@/lib/actions/calendar";
import type { ActionResult } from "@/lib/types";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Settings → Calendar actions. The feed secret is decided inside the
 * serialized store mutation, so concurrent requests (two tabs, a retried
 * request) never hand out a link that another write replaced.
 */

const USER_ID = "usr_calendar";

function feedUrlOf(result: ActionResult<{ feedUrl: string | null }>): string | null {
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.data.feedUrl;
}

/** The feed URL for the secret currently stored on the account (null when the feed is off). */
async function storedFeedPath(): Promise<string | null> {
  const user = await findById("users", USER_ID);
  assert.ok(user);
  return feedPathFor(user);
}

/** Resolve a feed URL the way the feed route does. */
async function ownerOf(url: string): Promise<string | null> {
  const token = new URL(url).pathname.replace(/^\/api\/calendar\//, "");
  return (await findUserByFeedToken(token))?.id ?? null;
}

beforeEach(async () => {
  await resetDb({ users: [makeUser({ id: USER_ID })] });
  resetRequest();
  await createSession(USER_ID);
});

describe("enableCalendarFeedAction", () => {
  it("gives concurrent requests the same, working link", async () => {
    const results = await Promise.all([enableCalendarFeedAction(), enableCalendarFeedAction(), enableCalendarFeedAction()]);
    const urls = results.map(feedUrlOf);
    assert.ok(urls[0]);
    assert.equal(new Set(urls).size, 1, "every tab shows the same link");
    const path = await storedFeedPath();
    assert.ok(path && urls[0]!.endsWith(path), "the link is built from the stored secret");
    assert.equal(await ownerOf(urls[0]!), USER_ID);
  });

  it("keeps the existing link when the feed is already on", async () => {
    const first = feedUrlOf(await enableCalendarFeedAction());
    const again = feedUrlOf(await enableCalendarFeedAction());
    assert.equal(again, first);
  });

  it("refuses signed-out requests", async () => {
    resetRequest();
    const result = await enableCalendarFeedAction();
    assert.equal(result.ok, false);
    assert.equal(await storedFeedPath(), null);
  });
});

describe("regenerateCalendarFeedAction", () => {
  it("replaces the link and returns the one it stored", async () => {
    const before = feedUrlOf(await enableCalendarFeedAction())!;
    const after = feedUrlOf(await regenerateCalendarFeedAction())!;
    assert.notEqual(after, before);
    assert.ok(after.endsWith((await storedFeedPath())!));
    assert.equal(await ownerOf(after), USER_ID);
    assert.equal(await ownerOf(before), null, "the old link stops working");
  });

  it("returns the value its own write stored when requests overlap", async () => {
    await enableCalendarFeedAction();
    const [first, second] = (await Promise.all([regenerateCalendarFeedAction(), regenerateCalendarFeedAction()])).map(feedUrlOf);
    assert.ok(first && second);
    assert.notEqual(first, second);
    // Writes are serialized: the later one wins and its response carries the live link.
    assert.ok(second.endsWith((await storedFeedPath())!));
    assert.equal(await ownerOf(second), USER_ID);
  });
});

describe("disableCalendarFeedAction", () => {
  it("turns the feed off and revokes the link", async () => {
    const url = feedUrlOf(await enableCalendarFeedAction())!;
    assert.equal(feedUrlOf(await disableCalendarFeedAction()), null);
    assert.equal(await storedFeedPath(), null);
    assert.equal(await ownerOf(url), null);
    // Turning it off twice is harmless.
    assert.equal(feedUrlOf(await disableCalendarFeedAction()), null);
  });

  it("wins over an enable that is queued before it", async () => {
    const [enabled, disabled] = await Promise.all([enableCalendarFeedAction(), disableCalendarFeedAction()]);
    assert.ok(feedUrlOf(enabled));
    assert.equal(feedUrlOf(disabled), null);
    assert.equal(await storedFeedPath(), null);
  });
});

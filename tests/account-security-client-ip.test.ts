import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { UNKNOWN_IP, clientIpFromHeaders, getRequestInfo, normalizeIp, parseClientIp, resolveClientIp, trustedProxyHops } from "@/lib/auth/request-info";
import { RATE_LIMITS, perIpLimit } from "@/lib/auth/rate-limit";
import { resetRequest } from "./helpers/request";

/**
 * The client IP comes only from proxies the deployment declares
 * (TRUST_PROXY_HOPS), never from the client-controlled left end of
 * X-Forwarded-For.
 */

const ORIGINAL = process.env.TRUST_PROXY_HOPS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = ORIGINAL;
});

describe("TRUST_PROXY_HOPS", () => {
  it("defaults to 0 and ignores garbage", () => {
    assert.equal(trustedProxyHops(undefined), 0);
    assert.equal(trustedProxyHops(""), 0);
    assert.equal(trustedProxyHops("-1"), 0);
    assert.equal(trustedProxyHops("1.5"), 0);
    assert.equal(trustedProxyHops("abc"), 0);
    assert.equal(trustedProxyHops(" 2 "), 2);
    assert.equal(trustedProxyHops("999"), 20);
  });
});

describe("resolveClientIp", () => {
  it("trusts nothing with 0 hops", () => {
    assert.equal(resolveClientIp("203.0.113.9", "198.51.100.1", 0), null);
    assert.equal(parseClientIp("203.0.113.9", "198.51.100.1", 0), UNKNOWN_IP);
  });

  it("takes the Nth entry from the right, never the spoofable leftmost one", () => {
    const header = "6.6.6.6, 203.0.113.9, 10.0.0.2";
    assert.equal(resolveClientIp(header, null, 1), "10.0.0.2");
    assert.equal(resolveClientIp(header, null, 2), "203.0.113.9");
    assert.equal(resolveClientIp(header, null, 3), "6.6.6.6");
    // A client forging "1.1.1.1" in front of the proxy-appended address changes nothing.
    assert.equal(resolveClientIp("1.1.1.1, 203.0.113.9", null, 1), "203.0.113.9");
    assert.equal(resolveClientIp("1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9", null, 1), "203.0.113.9");
  });

  it("gives up when the chain is shorter than declared or the entry is not an IP", () => {
    assert.equal(resolveClientIp("203.0.113.9", null, 2), null);
    assert.equal(resolveClientIp("203.0.113.9, garbage", null, 1), null);
    // Garbage injected on the left can't shift which entry is read.
    assert.equal(resolveClientIp("junk, , 203.0.113.9", null, 1), "203.0.113.9");
    assert.equal(resolveClientIp("unknown", null, 1), null);
  });

  it("uses X-Real-IP only when there is no X-Forwarded-For at all", () => {
    assert.equal(resolveClientIp(null, "198.51.100.1", 1), "198.51.100.1");
    assert.equal(resolveClientIp("", "198.51.100.1", 1), "198.51.100.1");
    assert.equal(resolveClientIp("203.0.113.9", "198.51.100.1", 1), "203.0.113.9");
    assert.equal(resolveClientIp(null, "198.51.100.1", 0), null);
  });

  it("normalises ports, brackets and mapped addresses", () => {
    assert.equal(resolveClientIp("[2001:DB8::1]:443", null, 1), "2001:db8::1");
    assert.equal(resolveClientIp("203.0.113.7:51234", null, 1), "203.0.113.7");
    assert.equal(resolveClientIp("::ffff:203.0.113.7", null, 1), "203.0.113.7");
    assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
    assert.equal(normalizeIp("..."), null);
    assert.equal(normalizeIp("<script>"), null);
  });
});

describe("request helpers read the configured hops", () => {
  it("ignores forwarded headers by default", async () => {
    delete process.env.TRUST_PROXY_HOPS;
    resetRequest({ headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7", "user-agent": "Test\tAgent" } });
    const info = await getRequestInfo();
    assert.equal(info.ip, UNKNOWN_IP);
    assert.equal(info.userAgent, "Test Agent");
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6" })), UNKNOWN_IP);
  });

  it("uses the proxy-appended entry when one hop is trusted", async () => {
    process.env.TRUST_PROXY_HOPS = "1";
    resetRequest({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    assert.equal((await getRequestInfo()).ip, "203.0.113.9");
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
  });
});

describe("perIpLimit", () => {
  it("keys known IPs individually with the per-IP rule", () => {
    assert.deepEqual(perIpLimit("login:ip", "203.0.113.9", RATE_LIMITS.loginIp, RATE_LIMITS.loginIpShared), { key: "login:ip:203.0.113.9", rule: RATE_LIMITS.loginIp });
  });

  it("puts every unknown client in one shared, site-wide bucket", () => {
    for (const ip of [UNKNOWN_IP, null, undefined, ""]) {
      assert.deepEqual(perIpLimit("login:ip", ip, RATE_LIMITS.loginIp, RATE_LIMITS.loginIpShared), { key: "login:ip:unknown", rule: RATE_LIMITS.loginIpShared });
    }
    for (const [perIp, shared] of [
      [RATE_LIMITS.loginIp, RATE_LIMITS.loginIpShared],
      [RATE_LIMITS.forgotIp, RATE_LIMITS.forgotIpShared],
      [RATE_LIMITS.resetIp, RATE_LIMITS.resetIpShared],
      [RATE_LIMITS.registerIp, RATE_LIMITS.registerIpShared],
    ] as const) {
      assert.ok(shared.limit > perIp.limit && shared.windowMs === perIp.windowMs);
    }
  });
});

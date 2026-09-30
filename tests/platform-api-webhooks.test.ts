import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MS, nextAttemptAt, retryDelayMs } from "@/lib/webhooks/policy";
import { computeSignature, generateWebhookSecret, isWebhookSecret, parseSignatureHeader, signatureHeader, SIGNATURE_HEADER } from "@/lib/webhooks/signature";
import { checkWebhookUrl, formatIpv4, isPublicAddress, parseIpv4Loose, resolvePublicAddresses } from "@/lib/webhooks/ssrf";

test("webhook signature: header is t=<unix>,v1=<hex HMAC-SHA256(secret, t.body)>", () => {
  const secret = generateWebhookSecret();
  assert.ok(isWebhookSecret(secret));
  const body = JSON.stringify({ id: "evt_1", type: "enrollment.created", createdAt: "2026-01-01T00:00:00.000Z", data: {} });
  const header = signatureHeader(secret, body, 1_767_225_600);
  assert.equal(SIGNATURE_HEADER, "LL-Signature");
  assert.match(header, /^t=1767225600,v1=[0-9a-f]{64}$/);
  assert.equal(header, `t=1767225600,v1=${computeSignature(secret, 1_767_225_600, body)}`);
  assert.equal(computeSignature(secret, 1_767_225_600, body), createHmac("sha256", secret).update(`1767225600.${body}`).digest("hex"));
});

test("webhook signature: changes with the body, the timestamp and the secret", () => {
  const secret = generateWebhookSecret();
  const base = computeSignature(secret, 100, "{}");
  assert.notEqual(base, computeSignature(secret, 100, "{ }"));
  assert.notEqual(base, computeSignature(secret, 101, "{}"));
  assert.notEqual(base, computeSignature(generateWebhookSecret(), 100, "{}"));
});

test("webhook signature: malformed headers do not parse", () => {
  for (const bad of [null, undefined, "", "garbage", "t=abc,v1=00", "v1=abcd"]) assert.equal(parseSignatureHeader(bad), null, String(bad));
  assert.ok(parseSignatureHeader(signatureHeader(generateWebhookSecret(), "{}", 100)));
});

test("ssrf: private, loopback and link-local addresses are blocked (IPv4 and IPv6)", () => {
  const blocked = ["127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("ssrf: decimal, octal and hex IPv4 forms resolve to the same address", () => {
  assert.equal(formatIpv4(2130706433), "127.0.0.1");
  for (const form of ["2130706433", "0177.0.0.1", "0x7f.0.0.1", "127.1"]) assert.equal(parseIpv4Loose(form), 2130706433, form);
});

test("ssrf: URL check allows only public http(s) destinations", () => {
  assert.equal(checkWebhookUrl("https://example.com/hooks/lms").ok, true);
  const rejected = ["ftp://example.com/hook", "file:///etc/passwd", "not a url", "http://127.0.0.1/hook", "http://2130706433/", "http://0177.0.0.1/", "http://0x7f.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://localhost/hook"];
  for (const url of rejected) assert.equal(checkWebhookUrl(url).ok, false, url);
});

test("ssrf: a hostname resolving to a private address is blocked after DNS resolution", async () => {
  const internal = await resolvePublicAddresses("hooks.example.com", { resolver: async () => [{ address: "10.1.2.3", family: 4 }] });
  assert.equal(internal.ok, false);
  const mixed = await resolvePublicAddresses("hooks.example.com", { resolver: async () => [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }] });
  assert.equal(mixed.ok, false);
  const open = await resolvePublicAddresses("hooks.example.com", { resolver: async () => [{ address: "8.8.8.8", family: 4 }] });
  assert.equal(open.ok, true);
});

test("webhook retries: 8 attempts with growing delays, then no further attempt", () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 8);
  assert.equal(RETRY_DELAYS_MS.length, MAX_DELIVERY_ATTEMPTS - 1);
  for (let i = 1; i < RETRY_DELAYS_MS.length; i++) assert.ok(RETRY_DELAYS_MS[i] > RETRY_DELAYS_MS[i - 1]);
  assert.equal(nextAttemptAt(1, 1_000), 1_000 + retryDelayMs(1));
  assert.equal(nextAttemptAt(MAX_DELIVERY_ATTEMPTS, 1_000), null);
});

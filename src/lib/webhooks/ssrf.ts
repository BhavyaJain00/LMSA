import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { MAX_WEBHOOK_URL_LENGTH } from "./policy";

/**
 * Server-side request forgery protection for outgoing webhooks.
 *
 * Administrators (and API keys) choose the URL the server posts to, so a
 * URL must never reach the server's own network: loopback, private ranges,
 * link-local addresses (cloud metadata lives at 169.254.169.254), carrier
 * NAT, multicast or reserved space, in IPv4, IPv6 or IPv4 embedded in IPv6.
 *
 * Three layers:
 *  1. `checkWebhookUrl` — shape of the URL (http/https only, no credentials,
 *     no internal host names) and literal IP addresses in every spelling
 *     (`127.1`, `0x7f000001`, `2130706433`, `0177.0.0.1`, `[::ffff:7f00:1]`).
 *  2. `resolvePublicAddresses` — every address the host name resolves to
 *     must be public (checked when an endpoint is saved, for a clear error).
 *  3. `guardedLookup` — the DNS lookup used by the connection itself applies
 *     the same check, so the address that was checked is the address that is
 *     connected to (no DNS rebinding window). Redirects are never followed.
 */

/* ------------------------------------------------------------------ */
/* IPv4                                                                */
/* ------------------------------------------------------------------ */

/** Dotted quad → 32-bit number, or null. Strict: four decimal parts, no leading zeros. */
export function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** One inet_aton number: decimal, octal (leading 0) or hexadecimal (0x). */
function parseAtonPart(part: string): number | null {
  if (/^0x[0-9a-f]*$/i.test(part)) return part.length === 2 ? 0 : Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]*$/.test(part)) return Number.parseInt(part, 8);
  if (/^[1-9]\d*$/.test(part)) return Number(part);
  return null;
}

/**
 * IPv4 address in any spelling the C library (and therefore many HTTP
 * clients) accepts: 1 to 4 parts, each decimal, octal or hexadecimal, the
 * last part filling the remaining bytes. `127.1`, `0x7f.0.0.1`,
 * `017700000001` and `2130706433` are all 127.0.0.1.
 */
export function parseIpv4Loose(text: string): number | null {
  const parts = text.replace(/\.$/, "").split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => part === "")) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    const value = parseAtonPart(part);
    if (value === null || !Number.isFinite(value)) return null;
    numbers.push(value);
  }
  const last = numbers.pop()!;
  if (numbers.some((n) => n > 255)) return null;
  const remainingBytes = 4 - numbers.length;
  if (last >= 256 ** remainingBytes) return null;
  let value = 0;
  for (const n of numbers) value = value * 256 + n;
  return value * 256 ** remainingBytes + last;
}

export function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** [first address, prefix length, what it is] of every IPv4 range a webhook may not reach. */
const BLOCKED_IPV4: readonly (readonly [string, number, string])[] = [
  ["0.0.0.0", 8, "an unspecified (this network) address"],
  ["10.0.0.0", 8, "a private network address"],
  ["100.64.0.0", 10, "a shared (carrier NAT) address"],
  ["127.0.0.0", 8, "a loopback address"],
  ["169.254.0.0", 16, "a link-local address"],
  ["172.16.0.0", 12, "a private network address"],
  ["192.0.0.0", 24, "a reserved address"],
  ["192.0.2.0", 24, "a documentation address"],
  ["192.88.99.0", 24, "a reserved address"],
  ["192.168.0.0", 16, "a private network address"],
  ["198.18.0.0", 15, "a benchmarking address"],
  ["198.51.100.0", 24, "a documentation address"],
  ["203.0.113.0", 24, "a documentation address"],
  ["224.0.0.0", 4, "a multicast address"],
  ["240.0.0.0", 4, "a reserved address"],
];

const IPV4_RANGES = BLOCKED_IPV4.map(([first, bits, reason]) => ({ first: parseIpv4(first)!, size: 2 ** (32 - bits), reason }));

function blockedIpv4Reason(value: number): string | null {
  for (const range of IPV4_RANGES) if (value >= range.first && value < range.first + range.size) return range.reason;
  return null;
}

/* ------------------------------------------------------------------ */
/* IPv6                                                                */
/* ------------------------------------------------------------------ */

/** IPv6 text → eight 16-bit groups, or null. Accepts `::` and an IPv4 tail; zone ids are refused. */
export function parseIpv6(text: string): number[] | null {
  let source = text;
  if (source.startsWith("[") && source.endsWith("]")) source = source.slice(1, -1);
  if (!source || source.includes("%") || !/^[0-9a-f:.]+$/i.test(source)) return null;

  if (source.includes(".")) {
    // An IPv4 tail (::ffff:127.0.0.1) is the last two groups written in decimal.
    const at = source.lastIndexOf(":");
    const v4 = at === -1 ? null : parseIpv4(source.slice(at + 1));
    if (v4 === null) return null;
    source = `${source.slice(0, at + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return null;
  const given = head.length + rest.length;
  if (halves.length === 2) {
    if (given > 7) return null;
    return [...head, ...new Array<number>(8 - given).fill(0), ...rest];
  }
  return given === 8 ? head : null;
}

function embeddedIpv4(high: number, low: number): number {
  return high * 65536 + low;
}

function blockedIpv6Reason(groups: readonly number[]): string | null {
  const [a, b, c, d, e, f, g, h] = groups as [number, number, number, number, number, number, number, number];
  const leadingZeros = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  if (leadingZeros && f === 0 && g === 0 && h === 0) return "an unspecified address";
  if (leadingZeros && f === 0 && g === 0 && h === 1) return "a loopback address";
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible form (::a.b.c.d).
  if (leadingZeros && (f === 0xffff || f === 0)) return blockedIpv4Reason(embeddedIpv4(g, h)) ?? (f === 0 ? "a reserved address" : null);
  // NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 address.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return blockedIpv4Reason(embeddedIpv4(g, h));
  // Global unicast is 2000::/3: everything else is loopback, unique-local (fc00::/7),
  // link-local (fe80::/10), site-local, multicast (ff00::/8), discard or reserved space.
  if ((a & 0xe000) !== 0x2000) {
    if ((a & 0xfe00) === 0xfc00) return "a private network address";
    if ((a & 0xffc0) === 0xfe80) return "a link-local address";
    if ((a & 0xff00) === 0xff00) return "a multicast address";
    return "a reserved address";
  }
  // 2001::/23 is set aside for protocols (Teredo 2001::/32 tunnels to arbitrary IPv4 hosts).
  if (a === 0x2001 && b < 0x200) return "a reserved address";
  if (a === 0x2001 && b === 0xdb8) return "a documentation address";
  if (a === 0x3fff && b < 0x1000) return "a documentation address";
  // 6to4 (2002::/16) embeds the IPv4 address it tunnels to.
  if (a === 0x2002) return blockedIpv4Reason(embeddedIpv4(b, c));
  return null;
}

/* ------------------------------------------------------------------ */
/* Addresses and host names                                            */
/* ------------------------------------------------------------------ */

/**
 * Why a webhook may not connect to this IP address ("a loopback address"),
 * or null when the address is public. Text that is not an IP address is
 * refused too (fail closed).
 */
export function blockedAddressReason(address: string): string | null {
  const text = address.trim();
  if (text.includes(":")) {
    const groups = parseIpv6(text);
    return groups ? blockedIpv6Reason(groups) : "not a valid IP address";
  }
  const v4 = parseIpv4Loose(text);
  return v4 === null ? "not a valid IP address" : blockedIpv4Reason(v4);
}

export function isPublicAddress(address: string): boolean {
  return blockedAddressReason(address) === null;
}

/** Host name of a parsed URL without IPv6 brackets or a trailing dot, lower-cased. */
export function urlHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** The host as an IP address in canonical text, or null when it is a name. */
function hostAsIp(host: string): { address: string; family: 4 | 6 } | null {
  if (host.includes(":")) return parseIpv6(host) ? { address: host, family: 6 } : null;
  const v4 = parseIpv4Loose(host);
  return v4 === null ? null : { address: formatIpv4(v4), family: 4 };
}

/** Names that only resolve inside a private network. */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa"];

export type UrlCheck = { ok: true; url: URL; host: string; literal: boolean } | { ok: false; error: string };

export interface SsrfOptions {
  /** Development only: allow loopback and private destinations (a receiver on localhost). */
  allowPrivate?: boolean;
}

/**
 * Check the shape of a webhook URL without touching the network. On success
 * `url` is the normalized URL (no fragment) and `literal` tells whether the
 * host is an IP address.
 */
export function checkWebhookUrl(raw: string, opts: SsrfOptions = {}): UrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter the URL that should receive the events." };
  if (text.length > MAX_WEBHOOK_URL_LENGTH) return { ok: false, error: `The URL must be at most ${MAX_WEBHOOK_URL_LENGTH} characters.` };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "Enter a full URL, for example https://example.com/webhooks/learnloop." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only http:// and https:// URLs can receive webhooks." };
  if (url.username || url.password) return { ok: false, error: "Remove the user name and password from the URL. Verify requests with the signing secret instead." };
  const host = urlHost(url);
  if (!host) return { ok: false, error: "The URL has no host name." };
  url.hash = "";

  const ip = hostAsIp(host);
  if (ip) {
    const reason = blockedAddressReason(ip.address);
    if (reason && !opts.allowPrivate) return { ok: false, error: `${host} is ${reason}. Webhooks can only be sent to public addresses.` };
    return { ok: true, url, host, literal: true };
  }
  if (!opts.allowPrivate) {
    if (host === "localhost" || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return { ok: false, error: `${host} is an internal host name. Webhooks can only be sent to public addresses.` };
    }
    if (!host.includes(".")) return { ok: false, error: `${host} is not a public host name. Use the full domain, for example hooks.example.com.` };
  }
  return { ok: true, url, host, literal: false };
}

/* ------------------------------------------------------------------ */
/* DNS                                                                 */
/* ------------------------------------------------------------------ */

export type Resolver = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });

export type ResolveResult = { ok: true; addresses: { address: string; family: number }[] } | { ok: false; error: string; blocked: boolean };

/**
 * Resolve a host name and require every address to be public. One private
 * address among several fails the check: a name that answers with both a
 * public and an internal address could otherwise be steered at will.
 */
export async function resolvePublicAddresses(hostname: string, opts: SsrfOptions & { resolver?: Resolver } = {}): Promise<ResolveResult> {
  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await (opts.resolver ?? systemResolver)(hostname);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return { ok: false, blocked: false, error: code === "ENOTFOUND" || code === "EAI_NONAME" ? `${hostname} could not be found (DNS lookup failed).` : `${hostname} could not be resolved${code ? ` (${code})` : ""}.` };
  }
  if (!addresses.length) return { ok: false, blocked: false, error: `${hostname} has no IP address.` };
  if (!opts.allowPrivate) {
    for (const { address } of addresses) {
      const reason = blockedAddressReason(address);
      if (reason) return { ok: false, blocked: true, error: `${hostname} resolves to ${address}, ${reason}. Webhooks can only be sent to public addresses.` };
    }
  }
  return { ok: true, addresses: addresses.map(({ address, family }) => ({ address, family })) };
}

/** Full check of a destination: URL shape, then DNS. Used when an endpoint is saved. */
export async function checkWebhookDestination(raw: string, opts: SsrfOptions & { resolver?: Resolver } = {}): Promise<UrlCheck> {
  const checked = checkWebhookUrl(raw, opts);
  if (!checked.ok || checked.literal) return checked;
  const resolved = await resolvePublicAddresses(checked.host, opts);
  return resolved.ok ? checked : { ok: false, error: resolved.error };
}

/** Error raised by `guardedLookup` when a name resolves to a blocked address. */
export class BlockedAddressError extends Error {
  readonly code = "EBLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

/**
 * DNS lookup for `http.request({ lookup })`: resolves the name and hands the
 * socket only public addresses, failing the connection otherwise. Because
 * the socket connects to exactly what this function returns, a name cannot
 * answer "public" to the check and "127.0.0.1" to the connection.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, result) => {
    if (error) return callback(error, "", 0);
    const addresses = result as LookupAddress[];
    if (!addresses.length) return callback(Object.assign(new Error(`${hostname} has no IP address.`), { code: "ENOTFOUND" }), "", 0);
    for (const { address } of addresses) {
      const reason = blockedAddressReason(address);
      if (reason) return callback(new BlockedAddressError(`${hostname} resolves to ${address}, ${reason}.`), "", 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

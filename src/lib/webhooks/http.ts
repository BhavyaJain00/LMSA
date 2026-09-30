import "server-only";
import http from "node:http";
import https from "node:https";
import { DELIVERY_TIMEOUT_MS, RESPONSE_BODY_LIMIT } from "./policy";
import { BlockedAddressError, blockedAddressReason, checkWebhookUrl, guardedLookup, urlHost, type SsrfOptions } from "./ssrf";

/**
 * One HTTP POST to a webhook endpoint.
 *
 * Built on `node:http(s)` rather than `fetch` so the connection can use
 * `guardedLookup`: the socket connects only to an address that passed the
 * SSRF check. Redirects are never followed (a 3xx answer is a failure), the
 * whole exchange must finish within the timeout, and only the start of the
 * response body is read and kept.
 */

export interface WebhookHttpResult {
  /** The endpoint answered with a 2xx status. */
  ok: boolean;
  /** HTTP status, when a response arrived. */
  status?: number;
  /** Start of the response body (at most `RESPONSE_BODY_LIMIT` characters). */
  body?: string;
  /** Why the attempt failed, in words an administrator can act on. */
  error?: string;
  /** The destination was refused by the SSRF protection (nothing was sent). */
  blocked?: boolean;
  durationMs: number;
}

export interface WebhookHttpOptions extends SsrfOptions {
  timeoutMs?: number;
}

/** Bytes of the response read before the connection is dropped (a body is only kept for the log). */
const MAX_RESPONSE_BYTES = 16 * 1024;

/** Text for the delivery log: valid UTF-8, no control characters, bounded. */
export function cleanResponseBody(raw: Buffer | string, limit: number = RESPONSE_BODY_LIMIT): string {
  const text = (typeof raw === "string" ? raw : raw.toString("utf8")).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeNetworkError(error: unknown, host: string): string {
  const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `${host} could not be found (DNS lookup failed).`;
    case "ECONNREFUSED":
      return `${host} refused the connection.`;
    case "ECONNRESET":
    case "EPIPE":
      return `${host} closed the connection before answering.`;
    case "ETIMEDOUT":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${host} could not be reached.`;
    case "CERT_HAS_EXPIRED":
      return `The TLS certificate of ${host} has expired.`;
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return `The TLS certificate of ${host} is not trusted (self-signed or incomplete chain).`;
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `The TLS certificate of ${host} is for a different host name.`;
    default:
      return `Could not connect to ${host}: ${message.slice(0, 300)}`;
  }
}

/**
 * POST `body` to `url` with the given headers. Never throws: every outcome
 * (2xx, other status, network error, timeout, blocked destination) is a
 * `WebhookHttpResult`.
 */
export function postWebhook(url: string, body: string, headers: Record<string, string>, opts: WebhookHttpOptions = {}): Promise<WebhookHttpResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  const checked = checkWebhookUrl(url, opts);
  if (!checked.ok) return Promise.resolve({ ok: false, blocked: true, error: checked.error, durationMs: 0 });
  const target = checked.url;
  const host = urlHost(target);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise<WebhookHttpResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: Omit<WebhookHttpResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };

    const request = transport.request({
      protocol: target.protocol,
      hostname: host,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: { ...headers, "Content-Length": String(Buffer.byteLength(body, "utf8")), Connection: "close" },
      // A fresh socket per delivery: a pooled connection would skip the guarded lookup.
      agent: false,
      lookup: opts.allowPrivate ? undefined : guardedLookup,
    });

    timer = setTimeout(() => {
      finish({ ok: false, error: `No complete response within ${Math.round(timeoutMs / 1000)} seconds (timed out).` });
      request.destroy();
    }, timeoutMs);

    // Last line of defense: whatever the lookup returned, refuse a socket that ended up on a blocked address.
    request.on("socket", (socket) => {
      socket.once("connect", () => {
        const remote = socket.remoteAddress;
        const reason = !opts.allowPrivate && remote ? blockedAddressReason(remote) : null;
        if (reason) {
          finish({ ok: false, blocked: true, error: `${host} connected to ${remote}, ${reason}. Webhooks can only be sent to public addresses.` });
          request.destroy();
        }
      });
    });

    request.on("error", (error) => {
      if (error instanceof BlockedAddressError) finish({ ok: false, blocked: true, error: `${error.message} Webhooks can only be sent to public addresses.` });
      else finish({ ok: false, error: describeNetworkError(error, host) });
    });

    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      let received = 0;
      const done = () => {
        const text = cleanResponseBody(Buffer.concat(chunks));
        if (status >= 200 && status < 300) return finish({ ok: true, status, body: text });
        if (status >= 300 && status < 400) {
          return finish({ ok: false, status, body: text, error: `The endpoint answered ${status} (a redirect). Redirects are not followed: use the final URL.` });
        }
        finish({ ok: false, status, body: text, error: `The endpoint answered ${status}${response.statusMessage ? ` ${response.statusMessage.slice(0, 80)}` : ""}.` });
      };
      response.on("data", (chunk: Buffer) => {
        if (received < MAX_RESPONSE_BYTES) chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - received));
        received += chunk.length;
        if (received >= MAX_RESPONSE_BYTES) {
          // Enough for the log: the status is known, the rest of the body is not needed.
          done();
          request.destroy();
        }
      });
      response.on("end", done);
      response.on("error", () => done());
      response.on("aborted", () => done());
    });

    request.end(body, "utf8");
  });
}

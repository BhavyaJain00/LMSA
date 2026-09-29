/**
 * Hand-written SMTP client (RFC 5321) on `node:net` / `node:tls`.
 *
 * Supports:
 *  - implicit TLS (port 465, `secure: true`) or STARTTLS upgrade (RFC 3207)
 *    when the server offers it; credentials are never sent over an
 *    unencrypted connection unless the server is on a loopback address,
 *  - EHLO with HELO fallback and capability parsing (SIZE, STARTTLS, AUTH,
 *    SMTPUTF8, 8BITMIME),
 *  - AUTH PLAIN (RFC 4616) and AUTH LOGIN,
 *  - MAIL FROM / RCPT TO (per-recipient results) / DATA with dot-stuffing,
 *  - multi-line reply parsing with enhanced status codes (RFC 3463),
 *  - per-phase timeouts, RSET between messages and QUIT,
 *  - typed errors: `transient` (4xx, network) vs permanent (5xx), and a
 *    `scope` telling whether the problem is the connection/configuration or
 *    this particular message.
 *
 * The module has no app imports so the protocol pieces (`ReplyParser`,
 * `parseReplies`, `dotStuff`, `parseEhloCapabilities`) can be unit-tested
 * directly.
 */
import net from "node:net";
import tls from "node:tls";
import { StringDecoder } from "node:string_decoder";

export const SMTP_CRLF = "\r\n";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type SmtpPhase = "connect" | "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "rset" | "quit" | "protocol";

export interface SmtpErrorOptions {
  phase: SmtpPhase;
  transient: boolean;
  scope: "connection" | "message";
  code?: number;
  enhancedCode?: string;
  response?: string;
  cause?: unknown;
}

export class SmtpError extends Error {
  readonly phase: SmtpPhase;
  /** True for 4xx replies and network problems: trying again later may succeed. */
  readonly transient: boolean;
  /** "connection": server/configuration problem (affects every message). "message": this message was refused. */
  readonly scope: "connection" | "message";
  readonly code?: number;
  readonly enhancedCode?: string;
  readonly response?: string;

  constructor(message: string, opts: SmtpErrorOptions) {
    super(message);
    this.name = "SmtpError";
    this.phase = opts.phase;
    this.transient = opts.transient;
    this.scope = opts.scope;
    this.code = opts.code;
    this.enhancedCode = opts.enhancedCode;
    this.response = opts.response;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }

  /** Permanent errors (5xx) should not be retried. */
  get permanent(): boolean {
    return !this.transient;
  }
}

export function isSmtpError(error: unknown): error is SmtpError {
  return error instanceof SmtpError;
}

/* ------------------------------------------------------------------ */
/* Reply parsing                                                       */
/* ------------------------------------------------------------------ */

export interface SmtpReply {
  /** Three-digit reply code, e.g. 250. */
  code: number;
  /** RFC 3463 enhanced status code from the first line, e.g. "5.1.1". */
  enhancedCode?: string;
  /** Text of every line (without the code and separator). */
  lines: string[];
  /** Lines joined with "\n". */
  text: string;
}

const REPLY_LINE_RE = /^([2-5][0-5][0-9])(?:([ -])(.*))?$/;
const ENHANCED_RE = /^([245])\.(\d{1,3})\.(\d{1,3})(?=\s|$)/;

/** Parse one reply line ("250-SIZE 1000", "250 OK", "354"). Returns null for malformed lines. */
export function parseReplyLine(line: string): { code: number; last: boolean; text: string } | null {
  const m = REPLY_LINE_RE.exec(line);
  if (!m) return null;
  return { code: Number(m[1]), last: m[2] !== "-", text: m[3] ?? "" };
}

function makeReply(code: number, lines: string[]): SmtpReply {
  const enhanced = ENHANCED_RE.exec(lines[0] ?? "");
  return {
    code,
    enhancedCode: enhanced ? `${enhanced[1]}.${enhanced[2]}.${enhanced[3]}` : undefined,
    lines,
    text: lines.join("\n"),
  };
}

/**
 * Incremental reply parser: feed it raw text as it arrives; it returns every
 * complete (possibly multi-line) reply. Lines end with CRLF (a bare LF is
 * tolerated). Throws an `SmtpError` (phase "protocol") on malformed input.
 */
export class ReplyParser {
  private buffer = "";
  private code: number | null = null;
  private lines: string[] = [];

  constructor(private readonly maxBuffer = 64 * 1024) {}

  push(chunk: string): SmtpReply[] {
    this.buffer += chunk;
    const out: SmtpReply[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const parsed = parseReplyLine(line);
      if (!parsed) {
        throw new SmtpError(`Malformed reply from the server: ${truncate(line, 120)}`, { phase: "protocol", transient: true, scope: "connection" });
      }
      if (this.code !== null && parsed.code !== this.code) {
        throw new SmtpError(`Inconsistent multi-line reply (${this.code} then ${parsed.code}).`, { phase: "protocol", transient: true, scope: "connection" });
      }
      this.code = parsed.code;
      this.lines.push(parsed.text);
      if (parsed.last) {
        out.push(makeReply(parsed.code, this.lines));
        this.code = null;
        this.lines = [];
      }
    }
    if (this.buffer.length > this.maxBuffer) {
      throw new SmtpError("The server sent an overlong reply line.", { phase: "protocol", transient: true, scope: "connection" });
    }
    return out;
  }

  /** Text received after the last complete line. */
  get remainder(): string {
    return this.buffer;
  }

  /** True when bytes of an unfinished reply are buffered. */
  hasPendingData(): boolean {
    return this.buffer.length > 0 || this.lines.length > 0;
  }

  reset(): void {
    this.buffer = "";
    this.code = null;
    this.lines = [];
  }
}

/** Parse a complete transcript into replies (pure helper for tests). */
export function parseReplies(input: string): { replies: SmtpReply[]; rest: string } {
  const parser = new ReplyParser(Number.MAX_SAFE_INTEGER);
  const replies = parser.push(input);
  return { replies, rest: parser.remainder };
}

/**
 * Parse the EHLO reply into a capability map: keyword (upper-case) →
 * parameters. Handles the legacy "AUTH=LOGIN PLAIN" form.
 */
export function parseEhloCapabilities(reply: SmtpReply): Map<string, string[]> {
  const caps = new Map<string, string[]>();
  for (const line of reply.lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const legacy = /^AUTH=(.*)$/i.exec(trimmed);
    const [keyword, ...params] = legacy ? ["AUTH", ...legacy[1]!.split(/\s+/)] : trimmed.split(/\s+/);
    const key = keyword!.toUpperCase();
    const existing = caps.get(key) ?? [];
    for (const p of params) if (p && !existing.includes(p.toUpperCase())) existing.push(key === "AUTH" ? p.toUpperCase() : p);
    caps.set(key, existing);
  }
  return caps;
}

/* ------------------------------------------------------------------ */
/* DATA helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Prepare a message for the DATA phase: normalize line endings to CRLF,
 * double every leading "." (RFC 5321 §4.5.2 transparency) and make sure the
 * content ends with CRLF so the terminating "." sits on its own line.
 */
export function dotStuff(message: string): string {
  const normalized = message.replace(/\r\n|\r|\n/g, SMTP_CRLF);
  const stuffed = normalized.replace(/(^|\r\n)\./g, "$1..");
  return stuffed.endsWith(SMTP_CRLF) ? stuffed : stuffed + SMTP_CRLF;
}

/** Reverse of `dotStuff` (what a receiving server does). */
export function dotUnstuff(data: string): string {
  return data.replace(/(^|\r\n)\.\./g, "$1.");
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h.endsWith(".localhost");
}

/** EHLO argument: a domain name, or an address literal for IPs (RFC 5321 §4.1.3). */
export function ehloName(hostname: string | undefined): string {
  const h = (hostname ?? "").trim().toLowerCase();
  if (!h) return "localhost";
  if (net.isIPv4(h)) return `[${h}]`;
  if (net.isIPv6(h)) return `[IPv6:${h}]`;
  return /^[a-z0-9.-]+$/.test(h) ? h : "localhost";
}

function validEnvelopeAddress(address: string): boolean {
   
  return address.length > 0 && address.length <= 254 && !/[\s<>\u0000-\u001f\u007f]/.test(address) && address.includes("@");
}

function hasEightBit(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

export interface SmtpClientOptions {
  host: string;
  port: number;
  /** Implicit TLS from the first byte (usually port 465). Otherwise STARTTLS is used when offered. */
  secure: boolean;
  auth?: { user: string; pass: string };
  /** Name sent with EHLO. */
  clientName?: string;
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  commandTimeoutMs?: number;
  /** Time allowed for the final reply after the message body. */
  dataTimeoutMs?: number;
  /** Refuse to continue without TLS. Defaults to true when credentials are configured and the host is not a loopback address. */
  requireTls?: boolean;
  /** Verify TLS certificates. Defaults to true, except for loopback hosts (local test servers). */
  rejectUnauthorized?: boolean;
  /** Protocol trace. Credentials are always redacted. */
  logger?: (direction: "C" | "S", line: string) => void;
}

export interface SmtpEnvelope {
  from: string;
  to: string[];
}

export interface SmtpRecipientResult {
  address: string;
  code: number;
  enhancedCode?: string;
  message: string;
}

export interface SmtpSendResult {
  accepted: string[];
  rejected: SmtpRecipientResult[];
  /** Final reply to the message body, e.g. "2.0.0 Ok: queued as 4F1Z…". */
  response: string;
  code: number;
}

interface Waiter {
  resolve: (reply: SmtpReply) => void;
  reject: (error: SmtpError) => void;
  timer: NodeJS.Timeout;
}

const DEFAULTS = {
  connectionTimeoutMs: 15_000,
  greetingTimeoutMs: 30_000,
  commandTimeoutMs: 30_000,
  dataTimeoutMs: 120_000,
};

/** Classify a reply that did not match what the command expected. */
function replyError(reply: SmtpReply, phase: SmtpPhase, label: string): SmtpError {
  const transient = reply.code >= 400 && reply.code < 500;
  const scope: "connection" | "message" = phase === "rcpt" || phase === "data" ? "message" : "connection";
  return new SmtpError(`${label} failed: ${reply.code} ${truncate(reply.text.replace(/\n/g, " "), 300)}`, {
    phase,
    transient: transient || reply.code === 421,
    scope,
    code: reply.code,
    enhancedCode: reply.enhancedCode,
    response: truncate(reply.text, 1000),
  });
}

/**
 * One SMTP session. Use `SmtpConnection.connect()` to open, authenticate and
 * negotiate TLS, then `sendMail()` any number of times, then `quit()`.
 */
export class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private decoder = new StringDecoder("utf8");
  private readonly parser = new ReplyParser();
  private readonly queue: SmtpReply[] = [];
  private waiter: Waiter | null = null;
  private failure: SmtpError | null = null;
  private closing = false;
  private readonly opts: Required<Omit<SmtpClientOptions, "auth" | "logger" | "requireTls" | "rejectUnauthorized">> &
    Pick<SmtpClientOptions, "auth" | "logger"> & { requireTls: boolean; rejectUnauthorized: boolean };

  /** Capabilities from the last EHLO (keyword → parameters). */
  capabilities = new Map<string, string[]>();
  /** Server greeting text. */
  greeting = "";
  /** Whether the session is encrypted. */
  secure = false;
  /** Negotiated TLS protocol, e.g. "TLSv1.3". */
  tlsProtocol: string | null = null;
  /** Authentication mechanism used, if any. */
  authMechanism: "PLAIN" | "LOGIN" | null = null;

  private constructor(options: SmtpClientOptions) {
    const loopback = isLoopbackHost(options.host);
    this.opts = {
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.auth && options.auth.user ? options.auth : undefined,
      clientName: options.clientName || "localhost",
      connectionTimeoutMs: options.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs,
      greetingTimeoutMs: options.greetingTimeoutMs ?? DEFAULTS.greetingTimeoutMs,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs,
      dataTimeoutMs: options.dataTimeoutMs ?? DEFAULTS.dataTimeoutMs,
      requireTls: options.requireTls ?? (!!options.auth?.user && !loopback),
      rejectUnauthorized: options.rejectUnauthorized ?? !loopback,
      logger: options.logger,
    };
  }

  /** Connect, read the greeting, EHLO, upgrade to TLS when possible and authenticate. */
  static async connect(options: SmtpClientOptions): Promise<SmtpConnection> {
    if (!options.host) throw new SmtpError("No SMTP host configured.", { phase: "connect", transient: true, scope: "connection" });
    if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
      throw new SmtpError(`Invalid SMTP port ${options.port}.`, { phase: "connect", transient: true, scope: "connection" });
    }
    const conn = new SmtpConnection(options);
    try {
      await conn.open();
    } catch (error) {
      conn.close();
      throw error;
    }
    return conn;
  }

  get isOpen(): boolean {
    return !!this.socket && !this.socket.destroyed && !this.failure && !this.closing;
  }

  /* --------------------------- socket plumbing --------------------------- */

  private tlsOptions(): tls.ConnectionOptions {
    const servername = net.isIP(this.opts.host) ? undefined : this.opts.host;
    return { servername, rejectUnauthorized: this.opts.rejectUnauthorized, minVersion: "TLSv1.2" };
  }

  private readonly onData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let replies: SmtpReply[];
    try {
      replies = this.parser.push(text);
    } catch (error) {
      this.fail(error instanceof SmtpError ? error : new SmtpError(String(error), { phase: "protocol", transient: true, scope: "connection" }));
      return;
    }
    for (const reply of replies) {
      if (this.opts.logger) for (const line of reply.lines) this.opts.logger("S", `${reply.code} ${line}`);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        clearTimeout(w.timer);
        w.resolve(reply);
      } else {
        this.queue.push(reply);
      }
    }
  };

  private readonly onError = (error: Error) => {
    const code = (error as NodeJS.ErrnoException).code;
    this.fail(
      new SmtpError(`Connection error: ${error.message}${code && !error.message.includes(code) ? ` (${code})` : ""}`, {
        phase: "connect",
        transient: true,
        scope: "connection",
        cause: error,
      }),
    );
  };

  private readonly onClose = () => {
    if (!this.closing) this.fail(new SmtpError("The server closed the connection unexpectedly.", { phase: "protocol", transient: true, scope: "connection" }));
  };

  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  private detach(socket: net.Socket | tls.TLSSocket) {
    socket.removeListener("data", this.onData);
    socket.removeListener("error", this.onError);
    socket.removeListener("close", this.onClose);
  }

  private fail(error: SmtpError) {
    if (!this.failure) this.failure = error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(this.failure);
    }
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
  }

  private waitForSocket(socket: net.Socket | tls.TLSSocket, event: "connect" | "secureConnect", phase: SmtpPhase): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(
          new SmtpError(`Timed out after ${Math.round(this.opts.connectionTimeoutMs / 1000)}s connecting to ${this.opts.host}:${this.opts.port}.`, {
            phase,
            transient: true,
            scope: "connection",
          }),
        );
      }, this.opts.connectionTimeoutMs);
      const onOk = () => {
        cleanup();
        resolve();
      };
      const onErr = (error: Error) => {
        cleanup();
        socket.destroy();
        const code = (error as NodeJS.ErrnoException).code;
        const what = phase === "starttls" ? "TLS negotiation failed" : `Could not connect to ${this.opts.host}:${this.opts.port}`;
        reject(new SmtpError(`${what}: ${error.message}${code && !error.message.includes(code) ? ` (${code})` : ""}`, { phase, transient: true, scope: "connection", cause: error }));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener(event, onOk);
        socket.removeListener("error", onErr);
      };
      socket.once(event, onOk);
      socket.once("error", onErr);
    });
  }

  private readReply(timeoutMs: number, phase: SmtpPhase): Promise<SmtpReply> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new SmtpError("The connection is closed.", { phase, transient: true, scope: "connection" }));
    }
    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        const error = new SmtpError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the server (${phase}).`, {
          phase,
          transient: true,
          scope: phase === "data" ? "message" : "connection",
        });
        this.fail(error);
        reject(error);
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  private write(line: string, redacted?: string) {
    if (!this.socket || this.socket.destroyed || this.failure) {
      throw this.failure ?? new SmtpError("The connection is closed.", { phase: "protocol", transient: true, scope: "connection" });
    }
    this.opts.logger?.("C", redacted ?? line);
    this.socket.write(`${line}${SMTP_CRLF}`);
  }

  /** Send one command line and return the reply, whatever its code. */
  private async exchange(line: string, phase: SmtpPhase, opts: { timeoutMs?: number; redacted?: string } = {}): Promise<SmtpReply> {
     
    if (/[\r\n\u0000]/.test(line)) throw new SmtpError("Refusing to send a command containing line breaks.", { phase, transient: false, scope: "message" });
    this.write(line, opts.redacted);
    return this.readReply(opts.timeoutMs ?? this.opts.commandTimeoutMs, phase);
  }

  /** Send a command and require one of the expected reply codes. */
  private async command(line: string, phase: SmtpPhase, expect: number[], opts: { timeoutMs?: number; redacted?: string; label?: string } = {}): Promise<SmtpReply> {
    const reply = await this.exchange(line, phase, opts);
    if (!expect.includes(reply.code)) throw replyError(reply, phase, opts.label ?? (opts.redacted ?? line).split(" ")[0]!);
    return reply;
  }

  /* ------------------------------ handshake ------------------------------ */

  private async open(): Promise<void> {
    const { host, port } = this.opts;
    let socket: net.Socket | tls.TLSSocket;
    if (this.opts.secure) {
      socket = tls.connect({ host, port, ...this.tlsOptions() });
      await this.waitForSocket(socket, "secureConnect", "connect");
      this.secure = true;
      this.tlsProtocol = (socket as tls.TLSSocket).getProtocol();
    } else {
      socket = net.connect({ host, port });
      await this.waitForSocket(socket, "connect", "connect");
    }
    socket.setNoDelay(true);
    this.socket = socket;
    this.attach(socket);

    const greeting = await this.readReply(this.opts.greetingTimeoutMs, "greeting");
    if (greeting.code !== 220) throw replyError(greeting, "greeting", "Server greeting");
    this.greeting = greeting.text;

    await this.ehlo();

    if (!this.secure) {
      if (this.capabilities.has("STARTTLS")) {
        await this.startTls();
        await this.ehlo();
      } else if (this.opts.requireTls) {
        throw new SmtpError(
          "The server does not offer STARTTLS, so the connection cannot be encrypted. Refusing to send credentials in clear text — use SMTP_SECURE=true (port 465) or a server that supports STARTTLS.",
          { phase: "starttls", transient: true, scope: "connection" },
        );
      }
    }

    if (this.opts.auth) await this.authenticate(this.opts.auth);
  }

  private async ehlo(): Promise<void> {
    const reply = await this.exchange(`EHLO ${this.opts.clientName}`, "ehlo");
    if (reply.code === 250) {
      this.capabilities = parseEhloCapabilities(reply);
      return;
    }
    if (reply.code >= 500) {
      // Very old servers: fall back to HELO (no extensions).
      await this.command(`HELO ${this.opts.clientName}`, "ehlo", [250]);
      this.capabilities = new Map();
      return;
    }
    throw replyError(reply, "ehlo", "EHLO");
  }

  private async startTls(): Promise<void> {
    await this.command("STARTTLS", "starttls", [220]);
    // Anything the server sent after the 220 would be processed as if it came
    // over TLS — refuse it (STARTTLS command injection, CVE-2011-0411).
    if (this.queue.length || this.parser.hasPendingData()) {
      throw new SmtpError("Unexpected data received before the TLS handshake.", { phase: "starttls", transient: true, scope: "connection" });
    }
    const plain = this.socket!;
    this.detach(plain);
    const secureSocket = tls.connect({ socket: plain, ...this.tlsOptions() });
    await this.waitForSocket(secureSocket, "secureConnect", "starttls");
    this.socket = secureSocket;
    this.decoder = new StringDecoder("utf8");
    this.parser.reset();
    this.attach(secureSocket);
    this.secure = true;
    this.tlsProtocol = secureSocket.getProtocol();
  }

  private async authenticate(auth: { user: string; pass: string }): Promise<void> {
    if (!this.secure && !isLoopbackHost(this.opts.host)) {
      throw new SmtpError("Refusing to authenticate over an unencrypted connection.", { phase: "auth", transient: true, scope: "connection" });
    }
    const mechanisms = this.capabilities.get("AUTH");
    if (!mechanisms) {
      throw new SmtpError("SMTP_USER is set but the server does not advertise authentication (AUTH).", { phase: "auth", transient: true, scope: "connection" });
    }
    if (mechanisms.includes("PLAIN")) {
      if (await this.authPlain(auth)) return;
      // 504: mechanism not available after all — fall back to LOGIN when offered.
      if (!mechanisms.includes("LOGIN")) throw new SmtpError("The server refused AUTH PLAIN (504).", { phase: "auth", transient: true, scope: "connection", code: 504 });
    }
    if (mechanisms.includes("LOGIN")) {
      await this.authLogin(auth);
      return;
    }
    throw new SmtpError(`No supported authentication mechanism (server offers: ${mechanisms.join(", ") || "none"}; supported: PLAIN, LOGIN).`, {
      phase: "auth",
      transient: true,
      scope: "connection",
    });
  }

  /** Returns false only when the server says the mechanism is unavailable (504). */
  private async authPlain(auth: { user: string; pass: string }): Promise<boolean> {
    const token = Buffer.from(`\u0000${auth.user}\u0000${auth.pass}`, "utf8").toString("base64");
    let reply = await this.exchange(`AUTH PLAIN ${token}`, "auth", { redacted: "AUTH PLAIN ********" });
    if (reply.code === 334) reply = await this.exchange(token, "auth", { redacted: "********" });
    if (reply.code === 235) {
      this.authMechanism = "PLAIN";
      return true;
    }
    if (reply.code === 504) return false;
    throw this.authError(reply);
  }

  private async authLogin(auth: { user: string; pass: string }): Promise<void> {
    let reply = await this.exchange("AUTH LOGIN", "auth");
    if (reply.code !== 334) throw this.authError(reply);
    reply = await this.exchange(Buffer.from(auth.user, "utf8").toString("base64"), "auth", { redacted: "********" });
    if (reply.code !== 334) throw this.authError(reply);
    reply = await this.exchange(Buffer.from(auth.pass, "utf8").toString("base64"), "auth", { redacted: "********" });
    if (reply.code !== 235) throw this.authError(reply);
    this.authMechanism = "LOGIN";
  }

  private authError(reply: SmtpReply): SmtpError {
    const hint = reply.code === 535 ? " Check SMTP_USER and SMTP_PASS." : "";
    return new SmtpError(`Authentication failed: ${reply.code} ${truncate(reply.text.replace(/\n/g, " "), 200)}.${hint}`, {
      phase: "auth",
      transient: reply.code < 500,
      scope: "connection",
      code: reply.code,
      enhancedCode: reply.enhancedCode,
      response: truncate(reply.text, 500),
    });
  }

  /* ------------------------------- sending ------------------------------- */

  /** Maximum message size advertised by the server (0 = unknown/unlimited). */
  get maxMessageSize(): number {
    const n = Number(this.capabilities.get("SIZE")?.[0]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Send one message. `raw` is the complete RFC 5322 message (headers and
   * body); it is dot-stuffed here. Recipients refused at RCPT are reported in
   * `rejected`; the call only throws when no recipient was accepted or the
   * server refused the transaction.
   */
  async sendMail(envelope: SmtpEnvelope, raw: string): Promise<SmtpSendResult> {
    if (!this.isOpen) throw this.failure ?? new SmtpError("The connection is closed.", { phase: "mail", transient: true, scope: "connection" });
    const recipients = Array.from(new Set(envelope.to.map((a) => a.trim()).filter(Boolean)));
    if (!validEnvelopeAddress(envelope.from)) {
      throw new SmtpError(`Invalid sender address "${truncate(envelope.from, 80)}".`, { phase: "mail", transient: false, scope: "connection" });
    }
    if (!recipients.length) throw new SmtpError("The message has no recipients.", { phase: "rcpt", transient: false, scope: "message" });
    const invalid = recipients.find((r) => !validEnvelopeAddress(r));
    if (invalid) throw new SmtpError(`Invalid recipient address "${truncate(invalid, 80)}".`, { phase: "rcpt", transient: false, scope: "message" });

    const data = dotStuff(raw);
    const size = Buffer.byteLength(data, "utf8");
    if (this.maxMessageSize && size > this.maxMessageSize) {
      throw new SmtpError(`The message (${size} bytes) exceeds the server limit of ${this.maxMessageSize} bytes.`, {
        phase: "mail",
        transient: false,
        scope: "message",
        code: 552,
      });
    }
    const needsUtf8 = [envelope.from, ...recipients].some((a) => hasEightBit(a));
    if (needsUtf8 && !this.capabilities.has("SMTPUTF8")) {
      throw new SmtpError("An address contains non-ASCII characters but the server does not support SMTPUTF8.", {
        phase: "mail",
        transient: false,
        scope: "message",
      });
    }
    const params: string[] = [];
    if (this.capabilities.has("SIZE")) params.push(`SIZE=${size}`);
    if (hasEightBit(data) && this.capabilities.has("8BITMIME")) params.push("BODY=8BITMIME");
    if (needsUtf8) params.push("SMTPUTF8");

    await this.command(`MAIL FROM:<${envelope.from}>${params.length ? ` ${params.join(" ")}` : ""}`, "mail", [250], { label: "MAIL FROM" });

    const accepted: string[] = [];
    const rejected: SmtpRecipientResult[] = [];
    for (const rcpt of recipients) {
      const reply = await this.exchange(`RCPT TO:<${rcpt}>`, "rcpt");
      if (reply.code === 250 || reply.code === 251) accepted.push(rcpt);
      else if (reply.code === 421) throw replyError(reply, "rcpt", "RCPT TO");
      else rejected.push({ address: rcpt, code: reply.code, enhancedCode: reply.enhancedCode, message: truncate(reply.text.replace(/\n/g, " "), 300) });
    }
    if (!accepted.length) {
      await this.reset().catch(() => undefined);
      const transient = rejected.some((r) => r.code >= 400 && r.code < 500);
      const first = rejected[0];
      throw new SmtpError(
        `All recipients were rejected: ${rejected.map((r) => `${r.address} (${r.code} ${r.message})`).join("; ")}`.slice(0, 600),
        { phase: "rcpt", transient, scope: "message", code: first?.code, enhancedCode: first?.enhancedCode, response: first?.message },
      );
    }

    await this.command("DATA", "data", [354]);
    if (!this.socket || this.socket.destroyed) throw this.failure ?? new SmtpError("The connection is closed.", { phase: "data", transient: true, scope: "connection" });
    this.opts.logger?.("C", `<message: ${size} bytes>`);
    this.socket.write(data);
    this.write(".");
    const final = await this.readReply(this.opts.dataTimeoutMs, "data");
    if (final.code !== 250) throw replyError(final, "data", "Message delivery");
    return { accepted, rejected, response: truncate(final.text, 500), code: final.code };
  }

  /** Abort the current transaction (keeps the session open). */
  async reset(): Promise<void> {
    await this.command("RSET", "rset", [250]);
  }

  /** End the session politely and close the socket. Never throws. */
  async quit(): Promise<void> {
    if (this.isOpen) {
      try {
        await this.command("QUIT", "quit", [221], { timeoutMs: 5_000 });
      } catch {
        /* closing anyway */
      }
    }
    this.close();
  }

  /** Close the socket immediately. */
  close(): void {
    this.closing = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(new SmtpError("The connection was closed.", { phase: "quit", transient: true, scope: "connection" }));
    }
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
  }
}

/** Open a session, send one message and quit. */
export async function sendMailOnce(options: SmtpClientOptions, envelope: SmtpEnvelope, raw: string): Promise<SmtpSendResult> {
  const conn = await SmtpConnection.connect(options);
  try {
    return await conn.sendMail(envelope, raw);
  } finally {
    await conn.quit();
  }
}

export interface SmtpVerifyResult {
  greeting: string;
  secure: boolean;
  tlsProtocol: string | null;
  authMechanism: "PLAIN" | "LOGIN" | null;
  capabilities: string[];
  maxMessageSize: number;
}

/** Connect, negotiate TLS and authenticate without sending anything (admin "Verify connection"). */
export async function verifySmtp(options: SmtpClientOptions): Promise<SmtpVerifyResult> {
  const conn = await SmtpConnection.connect(options);
  try {
    return {
      greeting: truncate(conn.greeting, 200),
      secure: conn.secure,
      tlsProtocol: conn.tlsProtocol,
      authMechanism: conn.authMechanism,
      capabilities: Array.from(conn.capabilities.entries()).map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k)),
      maxMessageSize: conn.maxMessageSize,
    };
  } finally {
    await conn.quit();
  }
}

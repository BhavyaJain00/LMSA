import "server-only";
import type { EmailMessage, Settings } from "@/lib/types";
import { mailEnv, maskSecret } from "@/lib/server-env";
import { siteConfig } from "@/lib/config";
import { type MailAddress, isSafeAddress, parseAddress } from "./mime";
import { type SmtpClientOptions, type SmtpEnvelope, SmtpConnection, SmtpError, ehloName, isLoopbackHost, verifySmtp, type SmtpVerifyResult } from "./smtp";

/**
 * Delivery transports:
 *  - `log` (default): the message is stored in the outbox, a one-line summary
 *    is printed and it is marked sent. Nothing leaves the server.
 *  - `smtp`: the message is delivered through the configured SMTP server with
 *    the hand-written client in `smtp.ts`.
 * Configuration comes from `.env` via `mailEnv` (MAIL_TRANSPORT, SMTP_*, MAIL_FROM).
 */

export type TransportKind = "log" | "smtp";

export interface SenderIdentity {
  address: string;
  name: string;
  /** Where the address came from. */
  source: "MAIL_FROM" | "SMTP_USER" | "default";
}

function appHostname(): string {
  try {
    return new URL(siteConfig.appUrl).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
}

/**
 * The envelope/From address and display name. The display name is taken
 * from Settings → Email (fromName), falling back to MAIL_FROM's name and the
 * brand name. Returns null when SMTP delivery has no usable sender address.
 */
export function resolveSender(settings: Settings): SenderIdentity | null {
  const fromEnv = mailEnv.from ? parseAddress(mailEnv.from) : null;
  const name = settings.email.fromName?.trim() || fromEnv?.name || settings.brand.name || siteConfig.name;
  if (fromEnv) return { address: fromEnv.address, name, source: "MAIL_FROM" };
  if (mailEnv.transport === "smtp") {
    if (mailEnv.user && isSafeAddress(mailEnv.user)) return { address: mailEnv.user, name, source: "SMTP_USER" };
    return null;
  }
  const host = appHostname();
  const domain = host.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : "localhost.localdomain";
  return { address: `no-reply@${domain}`, name, source: "default" };
}

export function resolveReplyTo(settings: Settings): MailAddress | undefined {
  const raw = settings.email.replyTo?.trim();
  if (!raw) return undefined;
  return parseAddress(raw) ?? undefined;
}

/** SMTP client options from the environment. */
export function smtpClientOptions(): SmtpClientOptions {
  return {
    host: mailEnv.host,
    port: mailEnv.port,
    secure: mailEnv.secure,
    auth: mailEnv.user ? { user: mailEnv.user, pass: mailEnv.pass } : undefined,
    clientName: ehloName(appHostname()),
  };
}

/** "smtp.gmail.com" → "smtp.•••.com"; single-label hosts and loopback stay readable. */
export function maskHost(host: string): string {
  if (!host) return "";
  if (isLoopbackHost(host)) return host;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.•.•`;
  const labels = host.split(".");
  if (labels.length <= 2) return labels.length === 2 ? `${labels[0]!.slice(0, 2)}•••.${labels[1]}` : host;
  return [labels[0], ...labels.slice(1, -1).map(() => "•••"), labels[labels.length - 1]].join(".");
}

export interface TransportStatus {
  transport: TransportKind;
  /** Delivery will be attempted with this configuration. */
  ready: boolean;
  /** Human summary, e.g. "SMTP · smtp.•••.com:587 · STARTTLS". */
  label: string;
  host: string;
  port: number;
  security: "Implicit TLS" | "STARTTLS" | "None";
  user: string;
  passSet: boolean;
  sender: SenderIdentity | null;
  replyTo?: string;
  problems: string[];
  warnings: string[];
}

/** What the admin screens show about delivery (never includes secrets). */
export function getTransportStatus(settings: Settings): TransportStatus {
  const sender = resolveSender(settings);
  const problems: string[] = [];
  const warnings: string[] = [];
  const security: TransportStatus["security"] = mailEnv.secure ? "Implicit TLS" : "STARTTLS";
  if (mailEnv.transport === "smtp") {
    if (!mailEnv.host) problems.push("SMTP_HOST is not set.");
    if (!sender) problems.push("MAIL_FROM is not set (and SMTP_USER is not an email address), so there is no sender address.");
    if (mailEnv.user && !mailEnv.pass) problems.push("SMTP_USER is set but SMTP_PASS is missing.");
    if (mailEnv.secure && mailEnv.port === 587) warnings.push("SMTP_SECURE=true with port 587: most servers expect STARTTLS on 587 and implicit TLS on 465.");
    if (!mailEnv.secure && mailEnv.port === 465) warnings.push("Port 465 usually needs SMTP_SECURE=true (implicit TLS).");
    if (!mailEnv.user && mailEnv.host && !isLoopbackHost(mailEnv.host)) warnings.push("No SMTP_USER: most providers require authentication.");
  } else {
    warnings.push("MAIL_TRANSPORT is \"log\": emails are stored in the outbox and printed to the server log, but not delivered.");
  }
  if (mailEnv.from && !parseAddress(mailEnv.from)) problems.push("MAIL_FROM is not a valid address (use \"Name <no-reply@example.com>\" or \"no-reply@example.com\").");
  if (settings.email.replyTo && !resolveReplyTo(settings)) warnings.push("The reply-to address in settings is not valid and will be ignored.");
  const hostLabel = mailEnv.host ? `${maskHost(mailEnv.host)}:${mailEnv.port}` : "no host";
  return {
    transport: mailEnv.transport,
    ready: mailEnv.transport === "log" ? true : problems.length === 0,
    label: mailEnv.transport === "smtp" ? `SMTP · ${hostLabel} · ${security}` : "Log only (not delivered)",
    host: maskHost(mailEnv.host),
    port: mailEnv.port,
    security: mailEnv.transport === "smtp" ? security : "None",
    user: mailEnv.user ? (isSafeAddress(mailEnv.user) ? maskEmail(mailEnv.user) : maskSecret(mailEnv.user, 2)) : "",
    passSet: !!mailEnv.pass,
    sender,
    replyTo: resolveReplyTo(settings)?.address,
    problems,
    warnings,
  };
}

function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, Math.min(6, local.length - visible.length)))}${address.slice(at)}`;
}

/* ------------------------------------------------------------------ */
/* Delivery agents                                                     */
/* ------------------------------------------------------------------ */

export interface DeliveryReceipt {
  /** Server response or log note. */
  response: string;
  /** Recipients the server refused (the message still went to the others). */
  rejected: { address: string; message: string }[];
}

export interface DeliveryAgent {
  readonly kind: TransportKind;
  send(message: EmailMessage, raw: string, envelope: SmtpEnvelope): Promise<DeliveryReceipt>;
  close(): Promise<void>;
}

class LogAgent implements DeliveryAgent {
  readonly kind = "log" as const;
  async send(message: EmailMessage, raw: string, envelope: SmtpEnvelope): Promise<DeliveryReceipt> {
    const cc = envelope.to.length > 1 ? ` (+${envelope.to.length - 1} cc)` : "";
    // One line, no body: bodies can contain one-time links.
    console.info(`[email:log] ${message.category} → ${message.to}${cc}: ${message.subject} [${message.id}, ${Buffer.byteLength(raw, "utf8")} bytes]`);
    return { response: "Logged (MAIL_TRANSPORT=log)", rejected: [] };
  }
  async close(): Promise<void> {}
}

/** Reuses one SMTP session for a batch of messages; reconnects after connection errors. */
class SmtpAgent implements DeliveryAgent {
  readonly kind = "smtp" as const;
  private conn: SmtpConnection | null = null;

  constructor(private readonly options: SmtpClientOptions) {}

  private async connection(): Promise<SmtpConnection> {
    if (this.conn?.isOpen) return this.conn;
    this.conn?.close();
    this.conn = await SmtpConnection.connect(this.options);
    return this.conn;
  }

  async send(_message: EmailMessage, raw: string, envelope: SmtpEnvelope): Promise<DeliveryReceipt> {
    const conn = await this.connection();
    try {
      const result = await conn.sendMail(envelope, raw);
      return { response: result.response, rejected: result.rejected.map((r) => ({ address: r.address, message: `${r.code} ${r.message}` })) };
    } catch (error) {
      if (conn.isOpen && error instanceof SmtpError && error.scope === "message") {
        // Keep the session for the next message.
        await conn.reset().catch(() => conn.close());
      } else {
        conn.close();
        this.conn = null;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.conn) await this.conn.quit();
    this.conn = null;
  }
}

export function createDeliveryAgent(): DeliveryAgent {
  return mailEnv.transport === "smtp" ? new SmtpAgent(smtpClientOptions()) : new LogAgent();
}

/** Connect/authenticate without sending (admin "Verify connection"). */
export async function verifySmtpConnection(): Promise<SmtpVerifyResult> {
  if (mailEnv.transport !== "smtp") throw new Error("MAIL_TRANSPORT is not \"smtp\".");
  return verifySmtp(smtpClientOptions());
}

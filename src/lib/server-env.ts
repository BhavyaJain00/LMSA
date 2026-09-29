import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { siteConfig } from "@/lib/config";

/**
 * Server-only secrets and integration settings read from `.env`.
 * Never import this module from a Client Component.
 */

function read(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

let cachedSecret: string | null = null;

/**
 * Application secret used to sign media URLs, encrypt 2FA secrets and sign
 * unsubscribe/calendar links. Uses APP_SECRET when set (required in
 * production); otherwise generates one and persists it next to the database
 * so it survives restarts in development.
 */
export function getAppSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = read("APP_SECRET");
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("APP_SECRET must be at least 32 characters long.");
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is not set. Add a long random value to your .env file (e.g. `openssl rand -hex 32`).");
  }
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), path.dirname(siteConfig.dataFile), ".app-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
    if (cachedSecret.length >= 32) return cachedSecret;
  } catch {
    /* create below */
  }
  cachedSecret = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cachedSecret, { encoding: "utf8", mode: 0o600 });
  return cachedSecret;
}

export type MailTransport = "log" | "smtp";

export const mailEnv = {
  /** "log" (default) stores emails and prints a summary; "smtp" delivers them. */
  transport: (read("MAIL_TRANSPORT") === "smtp" ? "smtp" : "log") as MailTransport,
  host: read("SMTP_HOST"),
  port: Number(read("SMTP_PORT")) || 587,
  /** true = implicit TLS (usually port 465); false = STARTTLS when offered. */
  secure: ["true", "1", "yes"].includes(read("SMTP_SECURE").toLowerCase()),
  user: read("SMTP_USER"),
  pass: read("SMTP_PASS"),
  /** Default sender address, e.g. "LearnLoop <no-reply@example.com>". */
  from: read("MAIL_FROM"),
};

export const stripeEnv = {
  secretKey: read("STRIPE_SECRET_KEY"),
  webhookSecret: read("STRIPE_WEBHOOK_SECRET"),
};

export const razorpayEnv = {
  keyId: read("RAZORPAY_KEY_ID"),
  keySecret: read("RAZORPAY_KEY_SECRET"),
  webhookSecret: read("RAZORPAY_WEBHOOK_SECRET"),
};

/** Mask a secret for display in admin screens: "sk_live_…a1b2". */
export function maskSecret(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "•".repeat(value.length);
  return `${value.slice(0, Math.min(8, value.length - visible))}…${value.slice(-visible)}`;
}

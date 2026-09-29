/**
 * Preloaded with `node --import ./tests/register.mjs` (see the "test"
 * script in package.json). Runs in the test runner and in every test file's
 * process before any test code:
 *
 *  1. Points the app at a throwaway environment: a fresh temporary JSON
 *     database (an empty `{}` document, so nothing is seeded unless a test
 *     asks for it), a temporary upload directory, a fixed APP_SECRET, the
 *     "log" mail transport and no payment-gateway credentials. The real
 *     `storage/db.json` and `.env` are never read or written.
 *  2. Registers the resolve hooks in `tests/loader.mjs` (`@/` alias,
 *     extensionless imports, Next.js stubs).
 *
 * The temporary directory belongs to this process and is removed on exit.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "ll-test-"));
const dataFile = path.join(dir, "db.json");
writeFileSync(dataFile, "{}\n", "utf8");
mkdirSync(path.join(dir, "uploads"), { recursive: true });

const env = {
  NODE_ENV: "test",
  DATA_FILE: dataFile,
  DB_DRIVER: "json",
  UPLOAD_DIR: path.join(dir, "uploads"),
  APP_URL: "http://localhost:3000",
  APP_SECRET: "test-app-secret-0123456789abcdef-0123456789abcdef",
  SEED_DEMO_DATA: "true",
  MAIL_TRANSPORT: "log",
  MAIL_FROM: "LearnLoop Tests <no-reply@learnloop.test>",
};
Object.assign(process.env, env);
for (const name of [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "QUIZ_ATTEMPT_SECRET",
  "SESSION_COOKIE_NAME",
  "COOKIE_SECURE",
]) {
  delete process.env[name];
}

process.once("exit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the OS cleans the temp folder eventually.
  }
});

register("./loader.mjs", import.meta.url);

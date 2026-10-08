/**
 * Preloaded with `node --import ./tests/register.mjs` (see the "test"
 * script in package.json). Runs in the test runner and in every test file's
 * process before any test code:
 *
 *  1. Points the app at a throwaway environment: the in-memory store driver
 *     (`tests/helpers/memory-driver.ts`; the database starts empty, so
 *     nothing is seeded unless a test asks for it), a temporary storage
 *     folder (backups, SEO files) and upload directory, a fixed APP_SECRET,
 *     the "log" mail transport and no payment-gateway credentials. No
 *     PostgreSQL server is needed, DATABASE_URL is cleared, and the real
 *     `storage/` and `.env` are never read or written.
 *  2. Registers the resolve hooks in `tests/loader.mjs` (`@/` alias,
 *     extensionless imports, Next.js stubs).
 *
 * The temporary directory belongs to this process and is removed on exit.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "ll-test-"));
mkdirSync(path.join(dir, "uploads"), { recursive: true });

const env = {
  NODE_ENV: "test",
  STORAGE_DIR: dir,
  STORAGE_DRIVER: "local",
  UPLOAD_DIR: path.join(dir, "uploads"),
  APP_URL: "http://localhost:3000",
  APP_SECRET: "test-app-secret-0123456789abcdef-0123456789abcdef",
  SEED_DEMO_DATA: "true",
  MAIL_TRANSPORT: "log",
  MAIL_FROM: "LearnLoop Tests <no-reply@learnloop.test>",
};
Object.assign(process.env, env);
for (const name of [
  // Never a real database: the store runs on the in-memory test driver.
  "DATABASE_URL",
  "DIRECT_URL",
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
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_PUBLIC_BASE_URL",
  "S3_FORCE_PATH_STYLE",
  "ANTHROPIC_API_KEY",
  "TRANSCRIBE_API_URL",
  "TRANSCRIBE_API_KEY",
  "SEO_CANONICAL_HOST",
  "DB_AUTO_BACKUP",
  "DB_BACKUP_KEEP",
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

// The store's test database (honoured by src/lib/db/store.ts only when NODE_ENV is "test").
const { installMemoryStore } = await import("./helpers/memory-driver.ts");
installMemoryStore();

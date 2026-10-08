import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEnvironment, isBuildPhase, runStartupChecks, type EnvCheckResult } from "@/lib/env-check";

/**
 * Round 3 legal-ops part 3: start-up configuration rules. Production refuses
 * to start without a strong APP_SECRET or an https APP_URL; development only
 * warns; `next build` skips the checks. (DATABASE_URL, required everywhere,
 * is covered by `postgres-config.test.ts`; every case here has one.)
 */

const SECRET = "a".repeat(32);
const DATABASE = { DATABASE_URL: "postgresql://app:pw@db.example.com:5432/postgres", DIRECT_URL: "postgresql://app:pw@db.example.com:5432/postgres" };
const GOOD_PROD = {
  ...DATABASE,
  APP_SECRET: SECRET,
  APP_URL: "https://learn.example.com",
  SEED_DEMO_DATA: "false",
  TRUST_PROXY_HOPS: "1",
  MAIL_TRANSPORT: "smtp",
  SMTP_HOST: "smtp.example.com",
  MAIL_FROM: "School <no-reply@example.com>",
};

const keys = (issues: EnvCheckResult["errors"]) => issues.map((i) => i.key);
const prod = (env: Record<string, string | undefined>) => checkEnvironment(env, { production: true });
const dev = (env: Record<string, string | undefined>) => checkEnvironment({ ...DATABASE, ...env }, { production: false });

describe("env-check: production requirements", () => {
  it("passes a complete production configuration with no issues", () => {
    const result = prod(GOOD_PROD);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.production, true);
  });

  it("requires APP_SECRET of at least 32 characters", () => {
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_SECRET: undefined }).errors), ["APP_SECRET"]);
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_SECRET: "   " }).errors), ["APP_SECRET"]);
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_SECRET: "x".repeat(31) }).errors), ["APP_SECRET"]);
    assert.deepEqual(prod({ ...GOOD_PROD, APP_SECRET: "x".repeat(32) }).errors, []);
  });

  it("requires an https APP_URL on public hosts", () => {
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_URL: "http://learn.example.com" }).errors), ["APP_URL"]);
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_URL: undefined }).errors), ["APP_URL"]);
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_URL: "not a url" }).errors), ["APP_URL"]);
    assert.deepEqual(keys(prod({ ...GOOD_PROD, APP_URL: "ftp://learn.example.com" }).errors), ["APP_URL"]);
  });

  it("only warns about http on a loopback address (local production test)", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://app.localhost"]) {
      const result = prod({ ...GOOD_PROD, APP_URL: url });
      assert.deepEqual(result.errors, [], url);
      assert.ok(keys(result.warnings).includes("APP_URL"), url);
    }
  });

  it("warns about a path in APP_URL", () => {
    assert.ok(keys(prod({ ...GOOD_PROD, APP_URL: "https://example.com/learn" }).warnings).includes("APP_URL"));
  });

  it("never echoes secret values in messages", () => {
    const secret = "short-but-secret-value";
    const result = prod({ ...GOOD_PROD, APP_SECRET: secret, SMTP_PASS: "smtp-password" });
    for (const issue of [...result.errors, ...result.warnings]) {
      assert.ok(!issue.message.includes(secret));
      assert.ok(!issue.message.includes("smtp-password"));
    }
  });

  it("warns about demo data, proxy hops and the dev switches", () => {
    const result = prod({ ...GOOD_PROD, SEED_DEMO_DATA: undefined, TRUST_PROXY_HOPS: "0", LL_DEV_LOGIN: "1", DB_DRIVER: "json" });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(keys(result.warnings).sort(), ["DB_DRIVER", "LL_DEV_LOGIN", "SEED_DEMO_DATA", "TRUST_PROXY_HOPS"]);
    assert.ok(keys(prod({ ...GOOD_PROD, SEED_DEMO_DATA: "true" }).warnings).includes("SEED_DEMO_DATA"));
    assert.ok(keys(prod({ ...GOOD_PROD, TRUST_PROXY_HOPS: undefined }).warnings).includes("TRUST_PROXY_HOPS"));
  });

  it("warns when production cookies are not marked secure", () => {
    assert.ok(keys(prod({ ...GOOD_PROD, COOKIE_SECURE: "false" }).warnings).includes("COOKIE_SECURE"));
  });

  it("warns when email is not delivered", () => {
    assert.ok(keys(prod({ ...GOOD_PROD, MAIL_TRANSPORT: "log" }).warnings).includes("MAIL_TRANSPORT"));
    assert.ok(keys(prod({ ...GOOD_PROD, MAIL_TRANSPORT: undefined }).warnings).includes("MAIL_TRANSPORT"));
  });
});

describe("env-check: integrations configured by halves", () => {
  it("fails SMTP without a host and warns about the sender and TLS", () => {
    const result = dev({ MAIL_TRANSPORT: "smtp", SMTP_REQUIRE_TLS: "false" });
    assert.deepEqual(keys(result.errors), ["SMTP_HOST"]);
    assert.ok(keys(result.warnings).includes("MAIL_FROM"));
    assert.ok(keys(result.warnings).includes("SMTP_REQUIRE_TLS"));
  });

  it("checks payment gateway secrets", () => {
    assert.ok(keys(dev({ STRIPE_SECRET_KEY: "sk_test_123" }).warnings).includes("STRIPE_WEBHOOK_SECRET"));
    assert.ok(keys(prod({ ...GOOD_PROD, STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec" }).warnings).includes("STRIPE_SECRET_KEY"));
    assert.ok(!keys(prod({ ...GOOD_PROD, STRIPE_SECRET_KEY: "sk_live_123", STRIPE_WEBHOOK_SECRET: "whsec" }).warnings).includes("STRIPE_SECRET_KEY"));
    const razorpay = dev({ RAZORPAY_KEY_ID: "rzp_test_1" });
    assert.deepEqual(keys(razorpay.errors), ["RAZORPAY_KEY_SECRET"]);
    assert.ok(keys(razorpay.warnings).includes("RAZORPAY_WEBHOOK_SECRET"));
  });

  it("checks S3 storage keys and the CDN scheme", () => {
    const missing = dev({ STORAGE_DRIVER: "s3", S3_BUCKET: "media" });
    assert.equal(missing.errors.length, 1);
    assert.equal(missing.errors[0]!.key, "S3_ACCESS_KEY_ID");
    assert.match(missing.errors[0]!.message, /S3_SECRET_ACCESS_KEY/);
    const complete = { STORAGE_DRIVER: "s3", S3_BUCKET: "media", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" };
    assert.deepEqual(dev(complete).errors, []);
    assert.ok(keys(prod({ ...GOOD_PROD, ...complete, S3_PUBLIC_BASE_URL: "http://cdn.example.com" }).warnings).includes("S3_PUBLIC_BASE_URL"));
  });

  it("validates numeric and boolean switches", () => {
    assert.ok(keys(dev({ TRUST_PROXY_HOPS: "one" }).warnings).includes("TRUST_PROXY_HOPS"));
    assert.ok(keys(dev({ SESSION_DAYS: "-3" }).warnings).includes("SESSION_DAYS"));
    assert.ok(keys(dev({ COOKIE_SECURE: "maybe" }).warnings).includes("COOKIE_SECURE"));
    assert.ok(keys(dev({ TRANSCRIBE_API_URL: "https://api.example.com" }).warnings).includes("TRANSCRIBE_API_KEY"));
  });
});

describe("env-check: development", () => {
  it("turns the production requirements into warnings", () => {
    const result = dev({ APP_SECRET: "short", APP_URL: "http://localhost:3000" });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(keys(result.warnings), ["APP_SECRET"]);
    assert.deepEqual(keys(dev({}).warnings), ["APP_SECRET", "APP_URL"]);
  });

  it("does not warn about demo data or proxies in development", () => {
    const result = dev({ APP_SECRET: SECRET, APP_URL: "http://localhost:3000", SEED_DEMO_DATA: "true", LL_DEV_LOGIN: "1" });
    assert.deepEqual(result.warnings, []);
  });
});

describe("env-check: runStartupChecks", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, NEXT_PHASE: env.NEXT_PHASE, APP_SECRET: env.APP_SECRET, APP_URL: env.APP_URL, DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL };
  const originalWarn = console.warn;

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    console.warn = originalWarn;
  });

  it("detects the build phase", () => {
    assert.equal(isBuildPhase({ NEXT_PHASE: "phase-production-build" }), true);
    assert.equal(isBuildPhase({ NEXT_PHASE: "phase-production-server" }), false);
    assert.equal(isBuildPhase({}), false);
  });

  it("is skipped during next build, even in production without secrets", () => {
    env.NODE_ENV = "production";
    env.NEXT_PHASE = "phase-production-build";
    delete env.APP_SECRET;
    assert.equal(runStartupChecks(), null);
  });

  it("refuses to start a production server without APP_SECRET, without printing values", () => {
    env.NODE_ENV = "production";
    delete env.NEXT_PHASE;
    delete env.APP_SECRET;
    env.APP_URL = "http://learn.example.com";
    console.warn = () => undefined;
    assert.throws(() => runStartupChecks(), (err: Error) => {
      assert.match(err.message, /Refusing to start/);
      assert.match(err.message, /APP_SECRET/);
      assert.match(err.message, /APP_URL/);
      assert.ok(!err.message.includes("learn.example.com"));
      return true;
    });
  });

  it("only logs in development", () => {
    env.NODE_ENV = "development";
    delete env.NEXT_PHASE;
    delete env.APP_SECRET;
    Object.assign(env, DATABASE);
    const logged: string[] = [];
    console.warn = (...args: unknown[]) => void logged.push(args.join(" "));
    const result = runStartupChecks();
    assert.ok(result);
    assert.equal(result.production, false);
    assert.ok(logged.some((line) => line.includes("APP_SECRET")));
  });
});

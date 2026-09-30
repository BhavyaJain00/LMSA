import type { Database } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { hashPassword } from "@/lib/auth/password";
import { uid } from "@/lib/utils";
import { defaultSettings } from "./defaults";
import { buildSeedDatabase } from "./seed";

/**
 * Contents of a brand-new database: the demo site (SEED_DEMO_DATA=true, the
 * default) or an empty site with one admin account taken from ADMIN_NAME /
 * ADMIN_EMAIL / ADMIN_PASSWORD.
 */
export async function buildInitialDatabase(): Promise<Partial<Database>> {
  return siteConfig.seedDemoData ? buildSeedDatabase() : buildEmptyDatabase();
}

async function buildEmptyDatabase(): Promise<Partial<Database>> {
  const { name, email, password } = siteConfig.bootstrapAdmin;
  if (!email || !password) {
    throw new Error("SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD in your .env file to create the first admin account.");
  }
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  const now = new Date().toISOString();
  const username = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "admin";
  return {
    users: [
      {
        id: uid("usr"),
        username,
        name,
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        roles: ["admin", "moderator", "course_creator", "batch_evaluator"],
        enabled: true,
        personaCaptured: true,
        createdAt: now,
        lastActiveAt: now,
      },
    ],
    settings: { ...defaultSettings(), updatedAt: now },
  };
}

#!/usr/bin/env node
/**
 * Health check script to verify platform readiness:
 * - Checks Node.js version
 * - Checks environment file (.env) presence and vital variables
 * - Checks storage directories
 *
 * Usage:
 *   node scripts/health-check.mjs
 */
import fs from "node:fs";
import path from "node:path";

console.log("LearnLoop LMS - System Health Check\n====================================");

let hasWarnings = false;

// 1. Node.js version check
const nodeVersion = process.versions.node;
const major = parseInt(nodeVersion.split(".")[0], 10);
if (major < 20) {
  console.warn(`[WARN] Node.js version is ${nodeVersion}. Node.js 20+ (recommended 24+) is required.`);
  hasWarnings = true;
} else {
  console.log(`[OK] Node.js runtime: v${nodeVersion}`);
}

// 2. Environment file check
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  console.log("[OK] Environment file (.env) found.");
  const envContent = fs.readFileSync(envPath, "utf-8");
  if (!envContent.includes("APP_SECRET=")) {
    console.warn("[WARN] APP_SECRET appears missing or unset in .env");
    hasWarnings = true;
  } else {
    console.log("[OK] APP_SECRET configured.");
  }
} else {
  console.warn("[WARN] .env file not found in project root. Copy .env.example to .env.");
  hasWarnings = true;
}

// 3. Storage directories check
const storageDirs = ["storage", "storage/backups", "storage/uploads"];
for (const dir of storageDirs) {
  const dirPath = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[OK] Created directory: ${dir}`);
    } catch (e) {
      console.warn(`[WARN] Could not ensure directory: ${dir} (${e.message})`);
      hasWarnings = true;
    }
  } else {
    console.log(`[OK] Directory exists: ${dir}`);
  }
}

console.log("\n====================================");
if (hasWarnings) {
  console.log("Health check completed with warnings.");
  process.exit(0);
} else {
  console.log("All health checks passed successfully!");
  process.exit(0);
}

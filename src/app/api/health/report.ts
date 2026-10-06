/**
 * Shapes of the `/api/health` answer. Pure, so the public/admin split is unit tested.
 *
 * Anonymous callers (Docker's HEALTHCHECK, load balancers, uptime monitors)
 * only need to know whether each part works and which release is running.
 * The ffmpeg build, per-check timings, failure codes and process uptime help
 * an operator but also tell an attacker which known media-parser bugs apply
 * and when the server restarts, so they are shown to administrators only.
 */

export type HealthStatus = "ok" | "degraded" | "error";

export interface HealthCheck {
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  version: string;
  uptimeSeconds: number;
  checkedAt: string;
  checks: { database: HealthCheck; storage: HealthCheck; ffmpeg: HealthCheck };
}

export interface PublicHealthReport {
  status: HealthStatus;
  version: string;
  checks: { database: { ok: boolean }; storage: { ok: boolean }; ffmpeg: { ok: boolean } };
}

/** The report without timings, uptime or check details. */
export function publicHealthReport(report: HealthReport): PublicHealthReport {
  return {
    status: report.status,
    version: report.version,
    checks: {
      database: { ok: report.checks.database.ok },
      storage: { ok: report.checks.storage.ok },
      ffmpeg: { ok: report.checks.ffmpeg.ok },
    },
  };
}

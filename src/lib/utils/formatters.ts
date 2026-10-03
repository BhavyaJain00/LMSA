/**
 * Formatting utility functions for display and presentation.
 */

/**
 * Formats a byte count into a human-readable string (e.g. 1.2 MB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  const val = parseFloat((bytes / Math.pow(k, idx)).toFixed(dm));
  return `${val} ${sizes[idx]}`;
}

/**
 * Formats seconds into HH:MM:SS or MM:SS format.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedSecs = secs.toString().padStart(2, "0");
  if (hrs > 0) {
    const paddedMins = mins.toString().padStart(2, "0");
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}

/**
 * Formats large numbers compactly (e.g., 1.5K, 2.3M).
 */
export function formatCompactNumber(num: number): string {
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(num);
}

/**
 * Formats a 0-1 ratio or percentage into a percentage string (e.g. 0.85 -> "85%").
 */
export function formatPercent(fraction: number, decimals = 0): string {
  if (!Number.isFinite(fraction)) return "0%";
  const pct = fraction <= 1 ? fraction * 100 : fraction;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Single-range `Range: bytes=…` parsing for file responses (pure).
 *
 * Returns null when there is no (supported) range — the whole file is sent —
 * and "invalid" when the range cannot be satisfied (HTTP 416). Multi-range
 * requests are answered with the whole file, which RFC 9110 allows.
 */
export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | null | undefined, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (!m[1] && m[2]) {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (m[1]) {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : size - 1;
  } else {
    return null;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

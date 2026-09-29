import { clamp } from "@/lib/utils";

/**
 * Tiny retention curve for overview tables (decorative: the table row
 * carries the numbers). One recessive line, no axes.
 */
export function RetentionSparkline({ retention, className }: { retention: number[]; className?: string }) {
  const n = retention.length;
  if (n < 2 || retention.every((v) => v <= 0)) {
    return <span className={className} aria-hidden="true" />;
  }
  const W = 100;
  const H = 28;
  const pts = retention.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - (clamp(v, 0, 100) / 100) * (H - 2) - 1).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={`M0,${H}L${pts.join("L")}L${W},${H}Z`} fill="var(--accent)" fillOpacity={0.1} />
      <path d={`M${pts.join("L")}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

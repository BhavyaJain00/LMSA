import type { ProgressBucket } from "./types";

/** Sequential ramp: faint for early progress, full success color for completed. */
export function bucketColor(intensity: number): string {
  return `color-mix(in oklab, var(--success) ${Math.round(intensity * 100)}%, var(--surface-3))`;
}

/**
 * Progress distribution donut + legend table. Buckets are ordinal, so they use
 * one hue at increasing intensity; every segment is also labelled in the
 * legend (never color alone) and has a hover tooltip.
 */
export function ProgressSummary({ buckets, averageProgress, total }: { buckets: ProgressBucket[]; averageProgress: number; total: number }) {
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const visible = buckets.filter((b) => b.count > 0);
  const gap = visible.length > 1 ? 2 : 0;
  const segments = visible.reduce<{ bucket: ProgressBucket; start: number; len: number }[]>((acc, bucket) => {
    const prev = acc[acc.length - 1];
    acc.push({ bucket, start: prev ? prev.start + prev.len : 0, len: total > 0 ? (bucket.count / total) * c : 0 });
    return acc;
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
      <figure className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`Progress distribution of ${total} learners`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
          {segments.map(({ bucket: b, start, len }) => {
            const dash = Math.max(0, len - gap);
            return (
              <circle
                key={b.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={bucketColor(b.intensity)}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-start}
                className="transition-opacity hover:opacity-80"
              >
                <title>{`${b.label} (${b.range}): ${b.count} ${b.count === 1 ? "learner" : "learners"} · ${b.percent}%`}</title>
              </circle>
            );
          })}
        </svg>
        <figcaption className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-semibold tabular-nums text-ink">{averageProgress}%</span>
          <span className="text-[11px] text-ink-muted">avg. progress</span>
        </figcaption>
      </figure>
      <table className="w-full text-sm">
        <caption className="sr-only">Learners by progress</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Learners</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: bucketColor(b.intensity) }} aria-hidden="true" />
                  <span className="text-ink" title={b.range}>
                    {b.label}
                  </span>
                  <span className="text-xs text-ink-faint">{b.range}</span>
                </span>
              </th>
              <td className="py-2 text-right tabular-nums text-ink-muted" title={`${b.count} ${b.count === 1 ? "learner" : "learners"}`}>
                {b.count}
              </td>
              <td className="w-14 py-2 text-right font-medium tabular-nums text-ink">{b.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

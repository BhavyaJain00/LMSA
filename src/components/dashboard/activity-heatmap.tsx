import { cn, formatDate, toDateKey } from "@/lib/utils";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;
const OPACITY = [0, 0.3, 0.55, 0.78, 1];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function level(count: number): number {
  if (count <= 0) return 0;
  return Math.min(4, count);
}

function describe(count: number, date: string): string {
  const when = formatDate(date, { weekday: "short" });
  if (count === 0) return `No activity on ${when}`;
  return `${count} ${count === 1 ? "activity" : "activities"} on ${when}`;
}

/**
 * GitHub-style activity heatmap drawn with inline SVG.
 * Columns are weeks (Sunday first), rows are weekdays; cells carry native
 * tooltips and the whole chart has a text summary for screen readers.
 */
export function ActivityHeatmap({ days, className }: { days: { date: string; count: number }[]; className?: string }) {
  if (!days.length) return null;
  const first = new Date(`${days[0]!.date}T00:00:00`);
  const offset = first.getDay();
  const columns = Math.ceil((days.length + offset) / 7);
  const width = LEFT + columns * STEP - GAP;
  const height = TOP + 7 * STEP - GAP;
  const today = toDateKey();
  const activeDays = days.filter((d) => d.count > 0).length;
  const total = days.reduce((acc, d) => acc + d.count, 0);

  // Month labels: first column whose first real day starts a new month.
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  let lastCol = -10;
  for (let col = 0; col < columns; col++) {
    const index = Math.max(0, col * 7 - offset);
    const day = days[index];
    if (!day) continue;
    const month = new Date(`${day.date}T00:00:00`).getMonth();
    if (month !== lastMonth) {
      if (col - lastCol >= 3) {
        monthLabels.push({ col, label: MONTHS[month]! });
        lastCol = col;
      }
      lastMonth = month;
    }
  }

  return (
    <figure className={cn("min-w-0", className)}>
      <div className="overflow-x-auto no-scrollbar">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Learning activity heatmap: ${activeDays} active ${activeDays === 1 ? "day" : "days"} and ${total} activities in the last ${Math.round(days.length / 7)} weeks.`}
          className="block max-w-full"
        >
          {monthLabels.map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * STEP} y={10} className="fill-ink-faint" fontSize={9}>
              {m.label}
            </text>
          ))}
          {[
            { row: 1, label: "Mon" },
            { row: 3, label: "Wed" },
            { row: 5, label: "Fri" },
          ].map((d) => (
            <text key={d.label} x={0} y={TOP + d.row * STEP + CELL - 2} className="fill-ink-faint" fontSize={9}>
              {d.label}
            </text>
          ))}
          {days.map((d, i) => {
            const pos = i + offset;
            const col = Math.floor(pos / 7);
            const row = pos % 7;
            const lvl = level(d.count);
            const isToday = d.date === today;
            return (
              <rect
                key={d.date}
                x={LEFT + col * STEP}
                y={TOP + row * STEP}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={lvl === 0 ? "var(--surface-3)" : "var(--accent)"}
                fillOpacity={lvl === 0 ? 1 : OPACITY[lvl]}
                stroke={isToday ? "var(--ink-muted)" : "none"}
                strokeWidth={isToday ? 1.25 : 0}
              >
                <title>{describe(d.count, d.date)}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-faint">
        <span>
          {activeDays} active {activeDays === 1 ? "day" : "days"}
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          Less
          {OPACITY.map((o, i) => (
            <span
              key={i}
              className={cn("inline-block size-2.5 rounded-[3px]", i === 0 ? "bg-surface-3" : "bg-accent")}
              style={i === 0 ? undefined : { opacity: o }}
            />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}

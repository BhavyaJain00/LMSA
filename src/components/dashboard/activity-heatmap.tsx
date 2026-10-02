import { getFormatter, getT } from "@/i18n/server";
import { cn, toDateKey } from "@/lib/utils";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;
const OPACITY = [0, 0.3, 0.55, 0.78, 1];
/** Known dates for the weekday labels (2024-01-01 was a Monday). */
const WEEKDAY_ROWS = [
  { row: 1, date: "2024-01-01" },
  { row: 3, date: "2024-01-03" },
  { row: 5, date: "2024-01-05" },
];
const NO_YEAR_DAY = { year: undefined, month: undefined, day: undefined } as const;

function level(count: number): number {
  if (count <= 0) return 0;
  return Math.min(4, count);
}

/**
 * GitHub-style activity heatmap drawn with inline SVG.
 * Columns are weeks (Sunday first), rows are weekdays; cells carry native
 * tooltips and the whole chart has a text summary for screen readers.
 */
export async function ActivityHeatmap({ days, className }: { days: { date: string; count: number }[]; className?: string }) {
  if (!days.length) return null;
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const first = new Date(`${days[0]!.date}T00:00:00`);
  const offset = first.getDay();
  const columns = Math.ceil((days.length + offset) / 7);
  const width = LEFT + columns * STEP - GAP;
  const height = TOP + 7 * STEP - GAP;
  const today = toDateKey();
  const activeDays = days.filter((d) => d.count > 0).length;
  const total = days.reduce((acc, d) => acc + d.count, 0);
  const describe = (count: number, date: string) => {
    const when = f.date(date, { weekday: "short" });
    return count === 0 ? t("dashboard.heatmap.dayEmpty", { date: when }) : t("dashboard.heatmap.day", { count, date: when });
  };

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
        monthLabels.push({ col, label: f.date(`2024-${String(month + 1).padStart(2, "0")}-01`, { ...NO_YEAR_DAY, month: "short" }) });
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
          aria-label={t("dashboard.heatmap.summary", { days: activeDays, total, weeks: Math.round(days.length / 7) })}
          className="block max-w-full"
        >
          {monthLabels.map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * STEP} y={10} className="fill-ink-faint" fontSize={9}>
              {m.label}
            </text>
          ))}
          {WEEKDAY_ROWS.map((d) => (
            <text key={d.row} x={0} y={TOP + d.row * STEP + CELL - 2} className="fill-ink-faint" fontSize={9}>
              {f.date(d.date, { ...NO_YEAR_DAY, weekday: "short" })}
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
        <span>{t("dashboard.heatmap.activeDays", { count: activeDays })}</span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {t("dashboard.heatmap.less")}
          {OPACITY.map((o, i) => (
            <span
              key={i}
              className={cn("inline-block size-2.5 rounded-[3px]", i === 0 ? "bg-surface-3" : "bg-accent")}
              style={i === 0 ? undefined : { opacity: o }}
            />
          ))}
          {t("dashboard.heatmap.more")}
        </span>
      </figcaption>
    </figure>
  );
}

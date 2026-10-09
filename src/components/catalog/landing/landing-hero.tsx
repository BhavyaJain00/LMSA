import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { DISPLAY, EDITORIAL } from "./fonts";
import { editorialLines } from "./tagline";
import { Tilt } from "@/components/landing3d/tilt";

/** Short facts shown as rotated stickers around the headline (each one optional). */
export interface HeroStickers {
  /** Accent sticker, top left (e.g. "4 courses"). */
  primary?: string;
  /** Lilac sticker, right side (e.g. "Free to start"). */
  secondary?: string;
  /** Orange circle, bottom (e.g. "Get certified"). */
  circle?: string;
}

const pill =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:hover:translate-y-0";

function Sticker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none select-none rounded-md border border-black/10 px-2.5 py-1 font-mono text-xs font-black uppercase leading-tight shadow-md shadow-black/30 sm:text-sm",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Guest home banner in the editorial style: the site tagline set as huge bold capitals mixed with italic serif
 * words, a few rotated stickers with real facts, one sentence of description and two pill buttons.
 */
export async function LandingHero({
  tagline,
  description,
  signupEnabled,
  browse,
  stickers,
}: {
  tagline: string;
  description?: string;
  signupEnabled: boolean;
  /** "Explore courses" link; null hides it (guests can't browse and signup is off). */
  browse: { href: string; label: string } | null;
  stickers: HeroStickers;
}) {
  const t = await getT("public");
  const lines = editorialLines(tagline);
  // Long taglines get a smaller scale so the capitals still fit the panel.
  const long = lines.some((l) => l.text.length > 14);
  const boldLines = lines.filter((l) => l.style === "bold");
  const highlight = boldLines.length > 1 ? boldLines.at(-1) : undefined;

  const primary = browse
    ? { href: browse.href, label: browse.label }
    : signupEnabled
      ? { href: "/register", label: t("home.hero.getStarted") }
      : { href: "/login", label: t("home.hero.logInToStart") };
  const secondary = browse && signupEnabled ? { href: "/register", label: t("home.hero.getStarted") } : null;

  return (
    <section
      aria-labelledby="landing-title"
      className="relative isolate flex flex-col justify-center px-5 pb-16 pt-24 sm:min-h-[92svh] sm:px-6 sm:pt-28 lg:px-8 lg:pb-24 lg:pt-32"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
        <div className="absolute -end-40 -top-40 size-[34rem] rounded-full bg-accent/15 blur-3xl" />
        <div className="absolute -bottom-24 -start-40 size-[30rem] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-center">
        {/* The headline tilts with the mouse; the stickers float in front of it (translate-z). */}
        <Tilt max={5} glare={false} className="w-full sm:w-auto">
          {stickers.primary && (
            <Sticker className="absolute -top-7 -start-1 z-10 hidden -rotate-6 translate-z-17.5 bg-accent text-accent-fg sm:inline-block lg:-start-14">{stickers.primary}</Sticker>
          )}
          <h1
            id="landing-title"
            className="translate-z-7.5 text-start text-ink filter-[drop-shadow(0_2px_0_rgb(0_0_0/0.35))_drop-shadow(0_6px_0_rgb(0_0_0/0.18))_drop-shadow(0_18px_28px_rgb(0_0_0/0.35))]"
          >
            {lines.map((line, i) =>
              line.style === "bold" ? (
                <span
                  key={i}
                  className={cn(
                    "block font-bold uppercase leading-[0.9] tracking-tight",
                    DISPLAY,
                    long ? "text-[2.4rem] sm:text-6xl lg:text-7xl" : "text-[2.9rem] sm:text-7xl lg:text-[6.75rem]",
                    i > 0 && "mt-1 sm:mt-2",
                  )}
                >
                  {line === highlight ? <span className="bg-linear-to-r from-accent via-violet-400 to-info bg-clip-text text-transparent">{line.text}</span> : line.text}{" "}
                </span>
              ) : (
                <span
                  key={i}
                  className={cn(
                    "relative z-10 -mt-1.5 ms-3 block font-normal italic leading-[0.9] sm:-mt-3 sm:ms-8",
                    EDITORIAL,
                    long ? "text-[2.2rem] sm:text-5xl lg:text-6xl" : "text-[2.6rem] sm:text-6xl lg:text-[5.75rem]",
                  )}
                >
                  {line.text}{" "}
                </span>
              ),
            )}
          </h1>
          {stickers.secondary && (
            <Sticker className="absolute end-0 top-[38%] z-10 hidden rotate-3 translate-z-20 bg-violet-300 text-slate-950 sm:inline-block lg:-end-10">{stickers.secondary}</Sticker>
          )}
          {stickers.circle && (
            <span className="pointer-events-none absolute bottom-1 end-[18%] z-10 hidden size-16 rotate-12 translate-z-24 select-none items-center justify-center rounded-full border border-black/10 bg-orange-400 p-1.5 text-center font-mono text-[0.68rem] font-black uppercase leading-tight text-slate-950 shadow-md sm:flex">
              {stickers.circle}
            </span>
          )}
        </Tilt>

        {/* Phones: the same stickers in a row under the headline. */}
        {(stickers.primary || stickers.secondary || stickers.circle) && (
          <div className="mt-5 flex w-full flex-wrap gap-2 sm:hidden" aria-hidden="true">
            {stickers.primary && <Sticker className="inline-block -rotate-3 bg-accent text-accent-fg">{stickers.primary}</Sticker>}
            {stickers.secondary && <Sticker className="inline-block rotate-2 bg-violet-300 text-slate-950">{stickers.secondary}</Sticker>}
            {stickers.circle && <Sticker className="inline-block -rotate-2 bg-orange-400 text-slate-950">{stickers.circle}</Sticker>}
          </div>
        )}

        {description && <p className="mt-8 max-w-2xl text-center text-base leading-relaxed text-ink-muted sm:mt-10 sm:text-lg">{description}</p>}

        <div className="mt-7 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Link href={primary.href} className={cn(pill, "bg-accent text-accent-fg shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/35")}>
            {primary.label}
            <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
          {secondary && (
            <Link href={secondary.href} className={cn(pill, "border border-border-strong text-ink hover:bg-surface-1")}>
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

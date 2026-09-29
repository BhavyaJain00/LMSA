"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MOVE_EVERY_MS = 8000;
const FADE_MS = 350;

interface Position {
  x: number;
  y: number;
}

function randomPosition(previous: Position): Position {
  // Pick a spot that is clearly away from the previous one so the mark never sits still.
  for (let i = 0; i < 6; i++) {
    const next = { x: 6 + Math.random() * 88, y: 8 + Math.random() * 76 };
    if (Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y) > 25) return next;
  }
  return { x: 100 - previous.x, y: 100 - previous.y };
}

/**
 * Semi-transparent viewer watermark (email or name) that jumps to a new
 * random position every ~8 seconds. It lives inside the player container,
 * so it stays visible in fullscreen and in the docked mini-player.
 *
 * `left/top` percentages combined with an equal negative translate keep the
 * text inside the frame whatever its width. Inline styles are re-asserted
 * on every move and the node is re-created if it is removed, which deters
 * casual tampering in developer tools.
 */
export function Watermark({ text, opacity, reducedMotion }: { text: string; opacity: number; reducedMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position>({ x: 12, y: 14 });
  const [visible, setVisible] = useState(true);
  const [generation, setGeneration] = useState(0);
  const alpha = Math.min(Math.max(opacity, 0.05), 0.5);

  useEffect(() => {
    let fadeTimer: number | null = null;
    const move = () => {
      const el = ref.current;
      if (!el || !el.isConnected) {
        setGeneration((g) => g + 1);
        return;
      }
      el.style.removeProperty("display");
      el.style.removeProperty("visibility");
      el.style.removeProperty("filter");
      if (reducedMotion) {
        setPos((p) => randomPosition(p));
        return;
      }
      setVisible(false);
      fadeTimer = window.setTimeout(() => {
        setPos((p) => randomPosition(p));
        setVisible(true);
      }, FADE_MS);
    };
    const first = window.setTimeout(move, 1200);
    const interval = window.setInterval(move, MOVE_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
    };
  }, [reducedMotion, generation]);

  return (
    <div
      key={generation}
      ref={ref}
      aria-hidden="true"
      data-player-watermark=""
      className={cn(
        "pointer-events-none absolute z-12 max-w-[80%] select-none truncate whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide text-white sm:text-sm",
        !reducedMotion && "transition-opacity duration-300 ease-out",
      )}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: `translate(-${pos.x}%, -${pos.y}%)`,
        opacity: visible ? alpha : 0,
        textShadow: "0 1px 2px rgb(0 0 0 / 0.85), 0 0 1px rgb(0 0 0 / 0.9)",
        display: "block",
        visibility: "visible",
      }}
    >
      {text}
    </div>
  );
}

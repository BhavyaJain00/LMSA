"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Swings a section into place in 3D (tilted back and lower, then flat) when it scrolls into view. The server
 * render and anything already on screen stay as they are, so nothing is ever hidden without JavaScript and
 * there is no hydration mismatch; "reduce motion" skips the effect.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"static" | "waiting" | "shown">("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    // Hide it only once we know it is below the fold and will be revealed.
    const frame = requestAnimationFrame(() => {
      setState("waiting");
      observer.observe(el);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "origin-top",
        state === "waiting" && "opacity-0 [transform:perspective(1400px)_rotateX(16deg)_translateY(64px)]",
        state === "shown" && "opacity-100 transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] [transform:perspective(1400px)_rotateX(0deg)_translateY(0)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

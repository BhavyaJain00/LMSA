"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tilts its content in 3D towards the mouse, with a soft glare that follows the pointer. Children that set
 * `[transform:translateZ(...)]` pop out of the surface (the wrapper preserves 3D). Mouse only; nothing moves
 * with "reduce motion".
 */
export function Tilt({ children, max = 8, glare = true, className }: { children: ReactNode; max?: number; glare?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLSpanElement>(null);

  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    if (glareRef.current) glareRef.current.style.opacity = "0";
  };

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const box = el.getBoundingClientRect();
        const x = (e.clientX - box.left) / box.width;
        const y = (e.clientY - box.top) / box.height;
        el.style.transform = `perspective(1000px) rotateX(${(0.5 - y) * max * 2}deg) rotateY(${(x - 0.5) * max * 2}deg)`;
        if (glareRef.current) {
          glareRef.current.style.opacity = "1";
          glareRef.current.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgb(255 255 255 / 0.16), transparent 55%)`;
        }
      }}
      onPointerLeave={reset}
      className={cn("relative transition-transform duration-200 ease-out [transform-style:preserve-3d] will-change-transform", className)}
    >
      {children}
      {glare && <span ref={glareRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] opacity-0 transition-opacity duration-300" />}
    </div>
  );
}

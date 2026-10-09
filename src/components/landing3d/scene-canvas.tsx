"use client";

import { useEffect, useRef } from "react";
import type { Vec3 } from "./math";
import { LandingScene } from "./renderer";

const FALLBACK_ACCENT: Vec3 = [0.41, 0.55, 0.9];

/** The resolved brand accent (it may be a colour-mix in dark mode), read through a 1×1 canvas. */
function readAccent(): Vec3 {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return FALLBACK_ACCENT;
  ctx.fillStyle = "#000";
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return r + g + b === 0 ? FALLBACK_ACCENT : [r / 255, g / 255, b / 255];
}

/**
 * Full-page 3D background for the landing page: a fixed, transparent canvas behind the content. Follows the
 * scroll, the pointer (mouse only), the theme and the brand colour; pauses in background tabs; honours
 * "reduce motion"; and simply disappears when WebGL is unavailable or the context is lost.
 */
export function SceneCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: LandingScene;
    try {
      scene = new LandingScene(canvas, reduced);
    } catch {
      canvas.style.display = "none";
      return;
    }

    const root = document.documentElement;
    const onScroll = () => {
      const max = root.scrollHeight - window.innerHeight;
      scene.setScroll(max > 0 ? window.scrollY / max : 0);
    };
    const measure = () => {
      scene.resize(window.innerWidth, window.innerHeight, root.scrollHeight / Math.max(1, window.innerHeight));
      onScroll();
    };
    const readTheme = () => scene.setTheme(readAccent(), root.getAttribute("data-theme") === "dark");
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    const onVisibility = () => {
      if (document.hidden) scene.pause();
      else if (!reduced) scene.play();
    };
    const onContextLost = (e: Event) => {
      e.preventDefault();
      scene.pause();
      canvas.style.display = "none";
    };

    readTheme();
    measure();
    if (!reduced) scene.play();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);
    // The page grows as images and fonts load; the theme changes from the toggle.
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(document.body);
    const themeObserver = new MutationObserver(readTheme);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      scene.destroy();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 size-full print:hidden" />;
}

"use client";

import { useEffect } from "react";

/**
 * Opens the disclosure a link points to: `/developers#listCourses` expands
 * that endpoint (and any closed section around it) and scrolls to it, on
 * load and whenever the hash changes. Renders nothing.
 */
export function HashOpener() {
  useEffect(() => {
    let frame = 0;
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      cancelAnimationFrame(frame);
      // Two frames: a filter cleared by the same hash change renders first.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const target = document.getElementById(id);
          if (!target) return;
          for (let node: HTMLElement | null = target; node; node = node.parentElement) {
            if (node instanceof HTMLDetailsElement) node.open = true;
          }
          target.scrollIntoView({ block: "start" });
          if (target instanceof HTMLDetailsElement) target.querySelector("summary")?.focus({ preventScroll: true });
        });
      });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", open);
    };
  }, []);
  return null;
}

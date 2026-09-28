/**
 * Full-width frame for the lesson player. Pages in this group do not get the
 * app shell (sidebar + header); the course-aware top bar is rendered by
 * `courses/[slug]/learn/layout.tsx`, which knows which course is open.
 */
export default function LearnGroupLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a
        href="#lesson-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface-1 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop"
      >
        Skip to lesson content
      </a>
      {children}
    </div>
  );
}

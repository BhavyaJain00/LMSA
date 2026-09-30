"use client";

import { useEffect } from "react";
import "./globals.css";
import { themeInitScript } from "@/components/ui/theme-toggle";
import { reportClientError } from "@/lib/errors/report";

/**
 * Last-resort error page, used when the root layout itself fails. It renders
 * its own document (the root layout is not available), reports the error to
 * the admin error log and offers a retry.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong</title>
        <meta name="robots" content="noindex" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-screen items-center justify-center bg-surface px-6 text-ink antialiased">
        <main role="alert" className="max-w-md text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-danger">Something went wrong</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">The site could not be loaded</h1>
          <p className="mt-2 text-sm text-ink-muted">The problem has been logged for the site team. Please try again in a moment.</p>
          {error.digest && (
            <p className="mt-3 text-xs text-ink-faint">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Try again
            </button>
            {/* A full page load: client navigation needs the root layout that just failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

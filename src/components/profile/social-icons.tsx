"use client";

import type { ReactNode, SVGProps } from "react";
import type { SocialLinks as SocialLinksType } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/* Brand glyphs drawn in the same 24×24 style as the shared icon set (not in icons.tsx, so they live here). */

type P = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: P & { children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function GithubIcon(props: P) {
  return (
    <Glyph {...props}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </Glyph>
  );
}

export function LinkedinIcon(props: P) {
  return (
    <Glyph {...props}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </Glyph>
  );
}

export function XIcon(props: P) {
  return (
    <Glyph {...props}>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
    </Glyph>
  );
}

export function YoutubeIcon(props: P) {
  return (
    <Glyph {...props}>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
    </Glyph>
  );
}

/** Social networks. Brand names are not translated; the website label is `global.social.website`. */
export const socialMeta: { key: keyof SocialLinksType; label: string; placeholder: string; icon: (props: P) => ReactNode }[] = [
  { key: "website", label: "Website", placeholder: "https://your-site.com", icon: (p) => <Icon.Globe {...p} /> },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/username", icon: (p) => <LinkedinIcon {...p} /> },
  { key: "github", label: "GitHub", placeholder: "https://github.com/username", icon: (p) => <GithubIcon {...p} /> },
  { key: "x", label: "X (Twitter)", placeholder: "https://x.com/username", icon: (p) => <XIcon {...p} /> },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@channel", icon: (p) => <YoutubeIcon {...p} /> },
];

/** Row of icon links for the socials a user has set (opens in a new tab). */
export function SocialLinks({ socials, name, className }: { socials?: SocialLinksType; name: string; className?: string }) {
  const t = useT("account");
  const entries = socialMeta.filter((m) => socials?.[m.key]);
  if (!entries.length) return null;
  const labelOf = (m: (typeof socialMeta)[number]) => (m.key === "website" ? t("global.social.website") : m.label);
  return (
    <ul className={cn("flex flex-wrap items-center gap-1", className)} aria-label={t("global.social.onTheWeb", { name })}>
      {entries.map((m) => (
        <li key={m.key}>
          <a
            href={socials![m.key]}
            target="_blank"
            rel="noopener noreferrer me"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={t("global.social.onNetwork", { name, network: labelOf(m) })}
            title={labelOf(m)}
          >
            {m.icon({ className: "size-4" })}
          </a>
        </li>
      ))}
    </ul>
  );
}

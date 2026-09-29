import type { SVGProps } from "react";

/**
 * Icons used by the installable-app and calendar features that the shared
 * set in `@/components/ui/icons` does not have. Same grid and stroke
 * (24×24, 1.75px, round caps) so they sit naturally next to `Icon.*`.
 */

type IconProps = SVGProps<SVGSVGElement>;

function svg(children: React.ReactNode) {
  const Component = ({ className, ...props }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
  return Component;
}

export const PwaIcon = {
  CalendarPlus: svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
    </>,
  ),
  CalendarSync: svg(
    <>
      <path d="M21 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M3 10h18M8 3v4M16 3v4" />
      <path d="M21 16a3.5 3.5 0 0 0-6.4-1.9M14 19.5a3.5 3.5 0 0 0 6.4 1.9" />
      <path d="M14.3 12.8v1.6h1.6M20.7 22.6V21h-1.6" />
    </>,
  ),
  WifiOff: svg(
    <>
      <path d="M2 9a15 15 0 0 1 4.3-2.7M10 5.1A15 15 0 0 1 22 9M5.5 12.5a10 10 0 0 1 3.2-1.9M15 10.8a10 10 0 0 1 3.5 1.7M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
      <path d="M3 3l18 18" />
    </>,
  ),
  /** iOS "Share" glyph (square with an arrow pointing up). */
  Share: svg(
    <>
      <path d="M8 9H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-2" />
      <path d="M12 15V3M8.5 6.5 12 3l3.5 3.5" />
    </>,
  ),
  /** iOS "Add to Home Screen" glyph (plus in a rounded square). */
  PlusSquare: svg(
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>,
  ),
  AppWindow: svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 8.5h18M6.5 6.25h.01M9 6.25h.01" />
      <path d="M12 11.5v5M9.75 14.25 12 16.5l2.25-2.25" />
    </>,
  ),
};

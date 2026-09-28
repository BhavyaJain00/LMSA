import type { ReactNode, SVGProps } from "react";

/**
 * Small local icons for the course/lesson editors that the shared icon set
 * does not include. Same 24×24 grid and 1.75 stroke as `@/components/ui/icons`.
 */
type IconProps = SVGProps<SVGSVGElement>;

function make(children: ReactNode) {
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

export const EditorIcon = {
  Bold: make(<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />),
  Italic: make(
    <>
      <path d="M19 5h-8M13 19H5" />
      <path d="M15 5 9 19" />
    </>,
  ),
  Heading: make(
    <>
      <path d="M6 5v14M18 5v14M6 12h12" />
    </>,
  ),
  BulletList: make(
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>,
  ),
  NumberedList: make(
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M4 9h3M4 14.5c0-.8.7-1.5 1.5-1.5S7 13.6 7 14.3c0 1.2-3 2-3 3.7h3" />
    </>,
  ),
  Quote: make(
    <>
      <path d="M4 7h6v6H6.5L4 17z" />
      <path d="M14 7h6v6h-3.5L14 17z" />
    </>,
  ),
  CodeBlock: make(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m9 10-2 2 2 2M15 10l2 2-2 2" />
    </>,
  ),
  ArrowUp: make(<path d="M12 19V5M6 11l6-6 6 6" />),
  ArrowDown: make(<path d="M12 5v14M6 13l6 6 6-6" />),
  MoveTo: make(
    <>
      <path d="M4 7h11M4 12h7M4 17h7" />
      <path d="m15 13 4 4-4 4M19 17h-6" />
    </>,
  ),
  Pdf: make(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 16v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M12.5 16v-4h.8a2 2 0 0 1 0 4zM16.5 12h-1.5v4M15 14h1.2" />
    </>,
  ),
  Embed: make(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <circle cx="6" cy="6.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="8.2" cy="6.5" r=".6" fill="currentColor" stroke="none" />
      <path d="m10 13-2 2 2 2M14 13l2 2-2 2" />
    </>,
  ),
  Callout: make(
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M12 8.5v3M12 13.8v.2" />
    </>,
  ),
  Donut: make(
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v4.5" />
    </>,
  ),
};

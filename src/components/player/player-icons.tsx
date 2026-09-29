import type { ReactNode, SVGProps } from "react";

/**
 * Icons used only by the video player that are not part of the shared icon
 * set. Same style as src/components/ui/icons.tsx (24×24, 1.75px stroke).
 */

type IconProps = SVGProps<SVGSVGElement>;

function svg(props: IconProps, children: ReactNode) {
  const { className, ...rest } = props;
  return (
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
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Keyboard (shortcuts overlay). */
export function KeyboardIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6.5 14h.01M17.5 14h.01M9 14h6" />
    </>,
  );
}

/** Video quality (HD badge). */
export function QualityIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 9.5v5M10 9.5v5M7 12h3M13.5 9.5v5h1.25a2.5 2.5 0 0 0 0-5Z" />
    </>,
  );
}

/** Return the docked mini-player to its place in the page. */
export function DockReturnIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
      <path d="M14 14h7v6h-7z" />
      <path d="M9 9l4 4M9 13V9h4" />
    </>,
  );
}

/** Up-next arrow with a bar (autoplay next). */
export function NextTrackIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M5 5.5v13a.8.8 0 0 0 1.25.66l9.5-6.5a.8.8 0 0 0 0-1.32l-9.5-6.5A.8.8 0 0 0 5 5.5Z" fill="currentColor" stroke="none" />
      <rect x="17" y="5" width="2.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </>,
  );
}

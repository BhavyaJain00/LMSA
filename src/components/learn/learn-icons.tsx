import type { ReactNode, SVGProps } from "react";

/**
 * Icons used only by the learning experience that are not part of the shared
 * icon set. Same style as src/components/ui/icons.tsx (24×24, 1.75px stroke).
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

/** Zen / focus mode (corner brackets around a dot). */
export function FocusIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </>,
  );
}

/** Exit focus mode (inward corners). */
export function FocusExitIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M8 4v2a2 2 0 0 1-2 2H4M20 8h-2a2 2 0 0 1-2-2V4M16 20v-2a2 2 0 0 1 2-2h2M4 16h2a2 2 0 0 1 2 2v2" />
    </>,
  );
}

/** Half-filled circle for lessons in progress. */
export function CircleHalfIcon(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Notebook with pen (assignments). */
export function NotebookPenIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
      <path d="M2 6h4M2 10h4M2 14h4M2 18h4" />
      <path d="M21.4 5.6a2 2 0 1 0-2.8-2.8l-5 5a2 2 0 0 0-.5.9L12.5 12l2.3-.6a2 2 0 0 0 .9-.5Z" />
    </>,
  );
}

/** Monitor with a play triangle (video lessons). */
export function MonitorPlayIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="m10 7.5 4.5 2.5-4.5 2.5Z" fill="currentColor" />
    </>,
  );
}

/** Speech bubble with a question mark. */
export function MessageQuestionIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2.1-2.4 3.1" />
      <path d="M12 16.5h.01" />
    </>,
  );
}

/** Keyboard (shortcut hints). */
export function KeyboardIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10" />
    </>,
  );
}

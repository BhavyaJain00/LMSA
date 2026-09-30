import type { ReactNode, SVGProps } from "react";

/**
 * Icons used only by the AI tutor that are not part of the shared icon set.
 * Same style as src/components/ui/icons.tsx (24×24, 1.75px stroke).
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

export function ThumbUpIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M7 10v11" />
      <path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.5l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" />
    </>,
  );
}

export function ThumbDownIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M17 14V3" />
      <path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.5l2.3-7A2 2 0 0 1 6.5 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9Z" />
    </>,
  );
}

export function FlagIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M4 22V4" />
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1" />
    </>,
  );
}

export function StopIcon(props: IconProps) {
  return svg(props, <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />);
}

export function ArrowUpIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>,
  );
}

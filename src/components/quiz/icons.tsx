import type { ReactNode, SVGProps } from "react";

/**
 * Quiz-specific icons drawn in the same style as the shared set in
 * `@/components/ui/icons` (24×24 grid, 1.75px round strokes, currentColor).
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function make(children: ReactNode) {
  function QuizIcon({ size, className, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size ?? "1em"}
        height={size ?? "1em"}
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
  }
  return QuizIcon;
}

export const QuizIcon = {
  /** Missed correct option / negative marking. */
  MinusCircle: make(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>,
  ),
  /** Multiple choice. */
  SquareCheck: make(
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>,
  ),
  /** User input. */
  TextCursor: make(
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <path d="M12 9v6M10.5 9h3M10.5 15h3" />
    </>,
  ),
  /** Open ended. */
  AlignLeft: make(<path d="M4 6h16M4 10h10M4 14h16M4 18h10" />),
  /** Marks. */
  Gauge: make(
    <>
      <path d="M4.2 17a9 9 0 1 1 15.6 0" />
      <path d="m12 13 4-5" />
      <circle cx="12" cy="13" r="1" fill="currentColor" />
    </>,
  ),
  /** Question bank. */
  Library: make(
    <>
      <path d="M5 4v16M9 4v16" />
      <path d="m13 4.5 4 15.5" />
      <path d="M3 20h18" />
    </>,
  ),
  CalendarX: make(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="m10 13.5 4 4M14 13.5l-4 4" />
    </>,
  ),
  ShieldX: make(
    <>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </>,
  ),
  MonitorX: make(
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="m10 8.5 4 4M14 8.5l-4 4" />
    </>,
  ),
  ClipboardX: make(
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 3h6v3H9z" />
      <path d="m10 11.5 4 4M14 11.5l-4 4" />
    </>,
  ),
  PencilLine: make(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>,
  ),
  FileCheck: make(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4" />
    </>,
  ),
  ArrowUp: make(<path d="M12 19V5M6 11l6-6 6 6" />),
  ArrowDown: make(<path d="M12 5v14M18 13l-6 6-6-6" />),
  Keyboard: make(
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>,
  ),
} as const;

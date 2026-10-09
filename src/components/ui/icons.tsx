import type { SVGProps } from "react";

/**
 * Custom icon set (24×24, 1.75px stroke). No external icon library.
 * Usage: <Icon.Play className="size-5" />
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function base(children: React.ReactNode, filled = false) {
  const Component = ({ size, className, ...props }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
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

export const Icon = {
  // Media
  Play: base(<path d="M6 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 6 4.5Z" fill="currentColor" stroke="none" />),
  Pause: base(
    <>
      <rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor" stroke="none" />
    </>,
  ),
  Replay: base(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>,
  ),
  SkipBack: base(
    <>
      <path d="M11 12 20 6v12l-9-6Z" fill="currentColor" stroke="none" />
      <rect x="4" y="6" width="2.5" height="12" rx="1" fill="currentColor" stroke="none" />
    </>,
  ),
  SkipForward: base(
    <>
      <path d="M13 12 4 6v12l9-6Z" fill="currentColor" stroke="none" />
      <rect x="17.5" y="6" width="2.5" height="12" rx="1" fill="currentColor" stroke="none" />
    </>,
  ),
  Rewind10: base(
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 3v5h5" />
      <text x="12" y="15.5" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
        10
      </text>
    </>,
  ),
  Forward10: base(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v5h-5" />
      <text x="12" y="15.5" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
        10
      </text>
    </>,
  ),
  VolumeHigh: base(
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </>,
  ),
  VolumeLow: base(
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </>,
  ),
  VolumeMute: base(
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </>,
  ),
  Fullscreen: base(
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>,
  ),
  ExitFullscreen: base(
    <>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </>,
  ),
  PictureInPicture: base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </>,
  ),
  Theater: base(
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M2 10h20M2 14h20" opacity="0.4" />
    </>,
  ),
  Captions: base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" />
    </>,
  ),
  Settings: base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>,
  ),
  Speed: base(
    <>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="m12 14 4-5" />
      <circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  Video: base(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>,
  ),
  Audio: base(
    <>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>,
  ),
  Loader: base(
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </>,
  ),

  // Navigation & actions
  ChevronDown: base(<path d="m6 9 6 6 6-6" />),
  ChevronUp: base(<path d="m18 15-6-6-6 6" />),
  ChevronLeft: base(<path d="m15 18-6-6 6-6" />),
  ChevronRight: base(<path d="m9 18 6-6-6-6" />),
  ChevronsUpDown: base(<path d="m7 15 5 5 5-5M7 9l5-5 5 5" />),
  ArrowRight: base(<path d="M5 12h14M13 6l6 6-6 6" />),
  ArrowLeft: base(<path d="M19 12H5M11 18l-6-6 6-6" />),
  ArrowUpRight: base(<path d="M7 17 17 7M8 7h9v9" />),
  ExternalLink: base(
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </>,
  ),
  Menu: base(<path d="M4 7h16M4 12h16M4 17h16" />),
  X: base(<path d="M6 6l12 12M18 6 6 18" />),
  Plus: base(<path d="M12 5v14M5 12h14" />),
  Minus: base(<path d="M5 12h14" />),
  Check: base(<path d="m5 12 5 5L20 7" />),
  CheckCircle: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 5-5" />
    </>,
  ),
  CheckCircleFilled: base(
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="m8 12.5 2.5 2.5 5.5-6" stroke="#fff" strokeWidth={2} />
    </>,
  ),
  Circle: base(<circle cx="12" cy="12" r="9" />),
  CircleDot: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>,
  ),
  Search: base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  ),
  Filter: base(<path d="M4 5h16l-6 8v5l-4 2v-7L4 5Z" />),
  MoreHorizontal: base(
    <>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  MoreVertical: base(
    <>
      <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  Edit: base(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
    </>,
  ),
  Trash: base(
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </>,
  ),
  Copy: base(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
  ),
  Link: base(
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>,
  ),
  Grip: base(
    <>
      <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>,
  ),
  Download: base(
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </>,
  ),
  Upload: base(
    <>
      <path d="M12 21V9" />
      <path d="m7 14 5-5 5 5" />
      <path d="M4 3h16" />
    </>,
  ),
  Eye: base(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  EyeOff: base(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.5 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1" />
    </>,
  ),
  LogOut: base(
    <>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="m15 8 5 4-5 4" />
      <path d="M20 12H9" />
    </>,
  ),
  LogIn: base(
    <>
      <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
      <path d="m9 8 5 4-5 4" />
      <path d="M14 12H4" />
    </>,
  ),
  Sun: base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  Moon: base(<path d="M21 13.5A8.5 8.5 0 0 1 10.5 3a7 7 0 1 0 10.5 10.5Z" />),
  Refresh: base(
    <>
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2" />
      <path d="M3 4v5h5M21 20v-5h-5" />
    </>,
  ),

  // Domain
  Home: base(
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>,
  ),
  BookOpen: base(
    <>
      <path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2V5Z" />
      <path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7V5Z" />
    </>,
  ),
  Book: base(
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    </>,
  ),
  GraduationCap: base(
    <>
      <path d="m2 9 10-5 10 5-10 5L2 9Z" />
      <path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" />
      <path d="M22 9v6" />
    </>,
  ),
  Users: base(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 15a5 5 0 0 1 5.5 5" />
    </>,
  ),
  User: base(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  ),
  UserPlus: base(
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M2 21a8 8 0 0 1 14.5-4.6" />
      <path d="M19 8v6M16 11h6" />
    </>,
  ),
  Calendar: base(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>,
  ),
  Clock: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Award: base(
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8.5 14-1.5 8 5-3 5 3-1.5-8" />
    </>,
  ),
  Certificate: base(
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M7 9h10M7 12.5h6" />
      <path d="M15 17v5l2-1.5 2 1.5v-5" />
    </>,
  ),
  Briefcase: base(
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </>,
  ),
  BarChart: base(
    <>
      <path d="M4 20h16" />
      <rect x="6" y="11" width="3" height="7" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="11" y="6" width="3" height="12" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="16" y="14" width="3" height="4" rx="0.5" fill="currentColor" stroke="none" />
    </>,
  ),
  TrendingUp: base(
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>,
  ),
  Code: base(
    <>
      <path d="m8 8-5 4 5 4" />
      <path d="m16 8 5 4-5 4" />
      <path d="m14 4-4 16" />
    </>,
  ),
  Terminal: base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M12 15h5" />
    </>,
  ),
  FileText: base(
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
      <path d="M14 3v5h5M8 13h8M8 17h8M8 9h2" />
    </>,
  ),
  File: base(
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </>,
  ),
  Image: base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>,
  ),
  Lock: base(
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
  ),
  Unlock: base(
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </>,
  ),
  Star: base(<path d="m12 3 2.8 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.7l-5.7 3 1.1-6.4L2.8 9.8l6.4-.9L12 3Z" />),
  StarFilled: base(<path d="m12 3 2.8 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.7l-5.7 3 1.1-6.4L2.8 9.8l6.4-.9L12 3Z" fill="currentColor" stroke="none" />),
  Heart: base(<path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.5 3.3 5 6.8 5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.5 0 5.6 3.5 4.3 6.7C19.5 16.4 12 21 12 21Z" />),
  Bell: base(
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z" />
      <path d="M10 21h4" />
    </>,
  ),
  MessageCircle: base(<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />),
  MessageSquare: base(<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V5Z" />),
  Bookmark: base(<path d="M6 3h12v18l-6-4-6 4V3Z" />),
  Note: base(
    <>
      <path d="M4 4h16v12l-4 4H4V4Z" />
      <path d="M16 20v-4h4M8 9h8M8 13h5" />
    </>,
  ),
  Highlighter: base(
    <>
      <path d="m9 11 4-4 4 4-4 4-4-4Z" />
      <path d="m6 14 3-3 4 4-3 3H6v-4Z" />
      <path d="M2 21h20" opacity="0.5" />
    </>,
  ),
  Info: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>,
  ),
  AlertTriangle: base(
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </>,
  ),
  AlertCircle: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>,
  ),
  XCircle: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>,
  ),
  Shield: base(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />),
  ShieldCheck: base(
    <>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
  Tag: base(
    <>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <circle cx="8" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  Globe: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>,
  ),
  Mail: base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>,
  ),
  Megaphone: base(
    <>
      <path d="M3 10v4a1 1 0 0 0 1 1h3l8 4V5L7 9H4a1 1 0 0 0-1 1Z" />
      <path d="M18 9a4 4 0 0 1 0 6" />
      <path d="M7 15v5h3" />
    </>,
  ),
  Zap: base(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  Flame: base(<path d="M12 22c4.4 0 7-3 7-6.5 0-3-2-5-3.5-7.5-.5 2-1.5 3-2.5 3.5 0-3-1-6-4-8.5.5 3-1 4.5-2.5 6.5S5 12.5 5 15.5C5 19 7.6 22 12 22Z" />),
  Sparkles: base(
    <>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </>,
  ),
  ClipboardList: base(
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2h6v4H9z" />
      <path d="M9 11h6M9 15h6" />
    </>,
  ),
  ListChecks: base(
    <>
      <path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" />
      <path d="M10 6h11M10 12h11M10 18h11" />
    </>,
  ),
  Layers: base(
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5M3 17l9 5 9-5" />
    </>,
  ),
  Layout: base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </>,
  ),
  Gift: base(
    <>
      <rect x="3" y="9" width="18" height="12" rx="1" />
      <path d="M12 9v12M3 14h18" />
      <path d="M12 9c-2-4-6-4-6-1.5S10 9 12 9Zm0 0c2-4 6-4 6-1.5S14 9 12 9Z" />
    </>,
  ),
  CreditCard: base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>,
  ),
  Receipt: base(
    <>
      <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>,
  ),
  Percent: base(
    <>
      <path d="m19 5-14 14" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>,
  ),
  Ticket: base(
    <>
      <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6H3v2Z" />
      <path d="M13 6v12" strokeDasharray="2 2" />
    </>,
  ),
  MapPin: base(
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>,
  ),
  Building: base(
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" />
    </>,
  ),
  Presentation: base(
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M12 16v3M8 22l4-3 4 3" />
    </>,
  ),
  Radio: base(
    <>
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.5 4.5a10.5 10.5 0 0 0 0 15M19.5 4.5a10.5 10.5 0 0 1 0 15" />
    </>,
  ),
  Send: base(<path d="m21 3-9 18-2-8-8-2 19-8Z" />),
  Palette: base(
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.8-.6-1.2-.6-2 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Z" />
      <circle cx="7.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </>,
  ),
  Sliders: base(
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>,
  ),
  Database: base(
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>,
  ),
  Command: base(<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />),
  Question: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>,
  ),
  Timer: base(
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9 2h6M12 2v3" />
    </>,
  ),
  Trophy: base(
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5a1 1 0 0 0-1 1c0 2.5 1.5 4 4 4M16 6h3a1 1 0 0 1 1 1c0 2.5-1.5 4-4 4" />
      <path d="M12 13v4M8 21h8M10 17h4v4h-4z" />
    </>,
  ),
  Target: base(
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>,
  ),
  Pin: base(
    <>
      <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6Z" />
      <path d="M12 14v7" />
    </>,
  ),
  Handshake: base(
    <>
      <path d="m3 9 4-3 5 3 5-3 4 3" />
      <path d="m12 9-3 3a1.5 1.5 0 0 0 2 2l1-1 3 3a1.5 1.5 0 0 0 2-2l-4-4" />
      <path d="M3 9v6l4 3 3-2M21 9v6l-4 3" />
    </>,
  ),
  Wifi: base(
    <>
      <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>,
  ),
  Camera: base(
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>,
  ),
  Monitor: base(
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>,
  ),
  Smartphone: base(
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>,
  ),
  Inbox: base(
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 14h5l1.5 2h3L15 14h5" />
    </>,
  ),
  Archive: base(
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v12h14V8M10 12h4" />
    </>,
  ),
  Rocket: base(
    <>
      <path d="M14 4c3-1 6-1 6-1s0 3-1 6-6 8-6 8l-3-3s5-5 4-10Z" />
      <path d="M10 14 5 16l2-5M10 14l-1 5 5-2" />
      <circle cx="15" cy="9" r="1.5" />
    </>,
  ),
  Puzzle: base(<path d="M10 3a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v1a2 2 0 1 1-4 0v-1H5a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h3V5a2 2 0 0 1 2-2Z" />),
  Hash: base(<path d="M5 9h14M5 15h14M10 3l-2 18M16 3l-2 18" />),
  Dot: base(<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />),
  /** Sidebar toggle (panel with a left rail). */
  PanelLeft: base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </>,
  ),
} as const;

export type IconName = keyof typeof Icon;

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <Icon.Loader className={`animate-spin-slow ${className}`} />;
}

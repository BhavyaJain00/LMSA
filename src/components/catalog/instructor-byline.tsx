import Link from "next/link";
import { AvatarGroup } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { firstName } from "./format";

export interface BylineUser {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string | null;
}

function NameLink({ user, linked }: { user: BylineUser; linked: boolean }) {
  if (!linked || !user.username) return <span className="font-medium text-ink">{user.name}</span>;
  return (
    <Link href={`/user/${user.username}`} className="relative z-10 font-medium text-ink hover:text-accent hover:underline">
      {user.name}
    </Link>
  );
}

/**
 * Instructor avatars + names: "Maya Chen", "Maya and Daniel",
 * "Maya and 2 others" (Frappe CourseInstructors format).
 */
export async function InstructorByline({
  instructors,
  linked = true,
  size = "xs",
  className,
  prefix,
}: {
  instructors: BylineUser[];
  linked?: boolean;
  size?: "xs" | "sm";
  className?: string;
  prefix?: string;
}) {
  if (!instructors.length) return null;
  const t = await getT("public");
  const [first, second] = instructors;
  let names: React.ReactNode;
  if (instructors.length === 1) {
    names = <NameLink user={first!} linked={linked} />;
  } else if (instructors.length === 2) {
    names = t.rich("shared.byline.two", {
      first: <NameLink key="first" user={{ ...first!, name: firstName(first!.name) }} linked={linked} />,
      second: <NameLink key="second" user={{ ...second!, name: firstName(second!.name) }} linked={linked} />,
    });
  } else {
    names = t.rich("shared.byline.more", {
      first: <NameLink key="first" user={{ ...first!, name: firstName(first!.name) }} linked={linked} />,
      count: instructors.length - 1,
    });
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <AvatarGroup users={instructors} size={size} max={3} />
      <p className="min-w-0 truncate text-sm text-ink-muted">
        {prefix && <span>{prefix} </span>}
        {names}
      </p>
    </div>
  );
}

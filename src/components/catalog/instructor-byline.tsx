import Link from "next/link";
import { AvatarGroup } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
export function InstructorByline({
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
  const [first, second] = instructors;
  let names: React.ReactNode;
  if (instructors.length === 1) {
    names = <NameLink user={first!} linked={linked} />;
  } else if (instructors.length === 2) {
    names = (
      <>
        <NameLink user={{ ...first!, name: firstName(first!.name) }} linked={linked} /> and{" "}
        <NameLink user={{ ...second!, name: firstName(second!.name) }} linked={linked} />
      </>
    );
  } else {
    names = (
      <>
        <NameLink user={{ ...first!, name: firstName(first!.name) }} linked={linked} /> and {instructors.length - 1} others
      </>
    );
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

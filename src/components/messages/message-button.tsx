import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { messageLinkFor } from "@/lib/comms/messages";
import { ButtonLink, type ButtonVariant, type ButtonSize } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/**
 * "Message instructor" button for course pages and profiles. Renders only
 * when the viewer may message this member (messaging on, signed in, and the
 * permission rules allow it); leads to the existing conversation when there
 * is one, otherwise to /messages/new with the member (and course) filled in.
 */
export async function MessageUserButton({
  userId,
  courseId,
  label = "Message",
  variant = "outline",
  size = "sm",
  className,
}: {
  userId: string;
  courseId?: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [viewer, db] = await Promise.all([getCurrentUser(), getDb()]);
  const href = messageLinkFor(db, viewer, userId, courseId);
  if (!href) return null;
  return (
    <ButtonLink href={href} variant={variant} size={size} className={className} leftIcon={<Icon.MessageCircle className="size-4" />} prefetch={false}>
      {label}
    </ButtonLink>
  );
}

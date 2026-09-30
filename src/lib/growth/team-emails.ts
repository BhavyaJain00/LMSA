import "server-only";
import { enqueueEmails, getEmailBrand, type EnqueueEmailInput } from "@/lib/email";
import { firstName, renderEmail, type EmailBlock, type EmailBrand, type RenderedEmail } from "@/lib/email/templates";
import { formatDate } from "@/lib/utils";
import { inviteExpiresAt } from "./teams-shared";

/**
 * Team seat invitation email (growth area). The raw invitation token only
 * ever travels in this email; the store keeps its SHA-256 hash.
 */

export interface TeamInvitation {
  email: string;
  name?: string;
  /** Raw invitation token for the `/join/<token>` link. */
  token: string;
  /** When the invitation was (re)sent, ISO. */
  assignedAt: string;
  /** Account of the invited person, when one exists with this address. */
  userId?: string;
}

export interface TeamInvitationContext {
  teamName: string;
  inviterName: string;
  courseTitles: string[];
}

const MAX_LISTED_COURSES = 8;

export function teamInvitationEmail(brand: EmailBrand, context: TeamInvitationContext, invite: TeamInvitation): RenderedEmail {
  const { teamName, inviterName, courseTitles } = context;
  const listed = courseTitles.slice(0, MAX_LISTED_COURSES);
  if (courseTitles.length > listed.length) listed.push(`and ${courseTitles.length - listed.length} more`);
  const blocks: EmailBlock[] = [
    {
      type: "paragraph",
      text: `${inviterName} reserved a seat for you in the ${teamName} team on ${brand.name}. Accept the invitation to start learning — your seat is already paid for.`,
    },
  ];
  if (listed.length) blocks.push({ type: "paragraph", text: courseTitles.length === 1 ? "Your seat includes:" : "Your seat includes these courses:" }, { type: "list", items: listed });
  blocks.push(
    { type: "button", label: "Accept invitation", url: `/join/${invite.token}`, fallback: true },
    {
      type: "muted",
      text: `This invitation was sent to ${invite.email} and works until ${formatDate(new Date(inviteExpiresAt(invite)).toISOString())}. Sign in or create an account to accept it. If you weren't expecting it, you can ignore this email.`,
    },
  );
  return renderEmail(brand, `${inviterName} invited you to join ${teamName} on ${brand.name}`, {
    preheader: `Your seat in the ${teamName} team is ready.`,
    eyebrow: "Team invitation",
    heading: `Join ${teamName}`,
    greeting: `Hi ${firstName(invite.name)},`,
    blocks,
    signoff: ["Happy learning,", `The ${brand.name} team`],
    footer: { reason: `You received this email because ${inviterName} invited ${invite.email} to a team on ${brand.name}.` },
  });
}

/** Queue one invitation email per invite. Returns how many were accepted by the outbox. */
export async function sendTeamInvitations(context: TeamInvitationContext, invites: readonly TeamInvitation[]): Promise<number> {
  if (!invites.length) return 0;
  const brand = await getEmailBrand();
  const inputs = invites.map((invite): EnqueueEmailInput => {
    const rendered = teamInvitationEmail(brand, context, invite);
    return { to: invite.email, toName: invite.name, userId: invite.userId, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "other" };
  });
  const queued = await enqueueEmails(inputs);
  return queued.filter((m) => m.status !== "failed").length;
}

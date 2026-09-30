import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { getRequestInfo } from "@/lib/auth/request-info";
import { joinAttemptAllowed } from "@/lib/growth/team-checkout";
import { JOIN_PROBLEM_MESSAGES, lookupInvite, type JoinProblem } from "@/lib/growth/teams";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { AcceptInviteForm } from "@/components/growth/team-join";
import { formatDate, pluralize } from "@/lib/utils";

// The address carries a secret: keep it out of search engines and of the Referer header of outgoing links.
export const metadata: Metadata = { title: "Team invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

const PROBLEM_TITLES: Record<JoinProblem, string> = {
  invalid: "This invitation link doesn't work",
  expired: "This invitation has expired",
  revoked: "This invitation was cancelled",
  used: "This invitation was already accepted",
  full: "No free seat right now",
  already_member: "You're already on this team",
  disabled: "Your account can't accept invitations",
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl animate-fade-in items-center py-6">
      <Card className="w-full p-6 sm:p-8">{children}</Card>
    </div>
  );
}

function Notice({ tone, title, children, action }: { tone: "warning" | "success"; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <Shell>
      <div className="text-center">
        <span className={tone === "success" ? "mx-auto flex size-14 items-center justify-center rounded-full bg-success/12 text-success" : "mx-auto flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning"}>
          {tone === "success" ? <Icon.CheckCircle className="size-7" aria-hidden="true" /> : <Icon.AlertTriangle className="size-7" aria-hidden="true" />}
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{children}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>
      </div>
    </Shell>
  );
}

export default async function JoinTeamPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [user, { ip }] = await Promise.all([getCurrentUser(), getRequestInfo()]);
  const home = user ? (
    <ButtonLink href="/team" variant="outline">
      Go to my team
    </ButtonLink>
  ) : (
    <ButtonLink href="/courses" variant="outline">
      Browse courses
    </ButtonLink>
  );

  if (!joinAttemptAllowed(ip)) {
    return (
      <Notice tone="warning" title="Too many attempts" action={home}>
        Invitation links were opened too often from your network. Please wait a few minutes and open your link again.
      </Notice>
    );
  }

  const lookup = await lookupInvite(token);
  if (!lookup.ok) {
    // The member who accepted the invitation opens their link again.
    if (lookup.problem === "used" && user && lookup.memberId === user.id) {
      return (
        <Notice
          tone="success"
          title={`You're on the ${lookup.teamName ?? "team"} team`}
          action={
            <ButtonLink href="/team" rightIcon={<Icon.ArrowRight className="size-4" />}>
              Go to your courses
            </ButtonLink>
          }
        >
          You already accepted this invitation. Your seat is active and the team&apos;s courses are in your account.
        </Notice>
      );
    }
    return (
      <Notice tone="warning" title={PROBLEM_TITLES[lookup.problem]} action={home}>
        {JOIN_PROBLEM_MESSAGES[lookup.problem]}
        {lookup.problem === "used" && !user && " If that was you, sign in to find the team's courses in your account."}
      </Notice>
    );
  }

  const { invite } = lookup;
  const next = encodeURIComponent(`/join/${token}`);
  const otherAccount = !!user && user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <Shell>
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon.Building className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-accent">Team invitation</p>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-ink">Join {invite.team.name}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A seat is reserved for <span className="break-all font-medium text-ink">{invite.email}</span>. It is already paid for: accept it to start learning.
        </p>
      </div>

      <section aria-labelledby="join-courses" className="mt-6">
        <h2 id="join-courses" className="text-sm font-medium text-ink">
          {invite.courses.length === 0 ? "Your seat" : `Your seat includes ${invite.courses.length === 1 ? "this course" : pluralize(invite.courses.length, "course")}`}
        </h2>
        {invite.courses.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">The team&apos;s courses are being set up. You&apos;ll be enrolled as soon as they are added.</p>
        ) : (
          <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {invite.courses.map((course) => (
              <li key={course.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Icon.BookOpen className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                <Link href={`/courses/${course.slug}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                  {course.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 space-y-3">
        {user ? (
          <>
            {otherAccount && (
              <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
                You&apos;re signed in as <span className="break-all font-medium">{user.email}</span>. Accepting gives the seat to this account. If the invitation is meant for another account of
                yours, sign out and open the link again.
              </p>
            )}
            <AcceptInviteForm token={token} label={otherAccount ? `Accept as ${user.name}` : "Accept invitation"} />
          </>
        ) : (
          <>
            <ButtonLink href={`/login?next=${next}`} size="lg" className="w-full" leftIcon={<Icon.LogIn className="size-5" />}>
              Sign in to accept
            </ButtonLink>
            <ButtonLink href={`/register?next=${next}`} size="lg" variant="outline" className="w-full">
              Create an account
            </ButtonLink>
          </>
        )}
        <p className="text-center text-xs text-ink-muted">
          This invitation works until {formatDate(invite.expiresAt)} and can be accepted once. Weren&apos;t expecting it? You can simply ignore it.
        </p>
      </div>
    </Shell>
  );
}

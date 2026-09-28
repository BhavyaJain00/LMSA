import type { ProfileView } from "@/lib/data/profile";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { roleLabels } from "@/lib/config";
import { cn, formatDate, gradientFor } from "@/lib/utils";
import { cardGradients } from "@/lib/config";
import { CoverEditor } from "./cover-editor";
import { SocialLinks } from "./social-icons";

function coverGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return gradientFor(cardGradients[h % cardGradients.length]);
}

const roleTone: Record<string, "accent" | "info" | "success" | "warning" | "dark" | "neutral"> = {
  admin: "dark",
  moderator: "accent",
  course_creator: "info",
  batch_evaluator: "success",
  student: "neutral",
};

/** Cover, avatar, name, headline, roles, social links and the Edit button. */
export function ProfileHeader({ view }: { view: ProfileView }) {
  const { user, isSelf, canEdit, stats } = view;
  const roles = user.roles.filter((r) => r !== "student" || user.roles.length === 1);
  const statItems = [
    { label: stats.enrolled === 1 ? "course" : "courses", value: stats.enrolled },
    { label: "completed", value: stats.completed },
    { label: stats.certificates === 1 ? "certificate" : "certificates", value: stats.certificates },
    { label: stats.badges === 1 ? "badge" : "badges", value: stats.badges },
  ];
  if (stats.teaching > 0) statItems.unshift({ label: "teaching", value: stats.teaching });

  return (
    <header>
      <div className="group relative h-32 overflow-hidden rounded-card bg-surface-2 sm:h-44">
        {user.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.coverImageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className={cn("size-full bg-linear-to-br opacity-90", coverGradient(user.id))} aria-hidden="true" />
        )}
        {canEdit && (
          <div className="absolute right-3 top-3 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <CoverEditor userId={user.id} hasCover={!!user.coverImageUrl} />
          </div>
        )}
      </div>

      <div className="relative px-1 sm:px-6">
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
            <Avatar name={user.name} src={user.avatarUrl} size="2xl" className="size-24 shadow-card ring-4 ring-surface sm:size-28" />
            <div className="min-w-0 pb-1">
              <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{user.name}</h1>
              {user.headline && <p className="mt-0.5 text-base text-ink-muted">{user.headline}</p>}
              <p className="mt-1 text-sm text-ink-faint">@{user.username}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pb-2">
            <SocialLinks socials={user.socials} name={user.name} />
            {canEdit && (
              <ButtonLink href={`/user/${user.username}/edit`} variant={isSelf ? "primary" : "outline"} size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                Edit Profile
              </ButtonLink>
            )}
            {isSelf && (
              <ButtonLink href="/settings" variant="ghost" size="sm" leftIcon={<Icon.Settings className="size-4" />}>
                Settings
              </ButtonLink>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
          {roles.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <Badge key={r} tone={roleTone[r] ?? "neutral"} size="sm">
                  {roleLabels[r] ?? r}
                </Badge>
              ))}
            </span>
          )}
          {user.location && (
            <span className="inline-flex items-center gap-1.5">
              <Icon.MapPin className="size-4 text-ink-faint" />
              {user.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Icon.Calendar className="size-4 text-ink-faint" />
            Joined {formatDate(user.createdAt, { day: undefined })}
          </span>
          {view.canSeeEmail && user.email && (
            <a href={`mailto:${user.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
              <Icon.Mail className="size-4 text-ink-faint" />
              {user.email}
            </a>
          )}
          {!user.enabled && (
            <Badge tone="danger" dot>
              Disabled
            </Badge>
          )}
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {statItems.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{s.value}</dd>
              <span className="text-ink-muted" aria-hidden="true">
                {s.label}
              </span>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

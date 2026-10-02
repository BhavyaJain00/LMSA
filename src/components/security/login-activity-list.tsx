import type { LoginEvent } from "@/lib/types";
import { describeLoginReason, isLoginEventReason, type LoginEventTone } from "@/lib/auth/login-reasons";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { deviceLabel } from "./device-label";
import { LOGIN_REASON_KEYS } from "./login-reason-keys";

const TONE_ICON: Record<LoginEventTone, { icon: keyof typeof Icon; className: string }> = {
  success: { icon: "CheckCircle", className: "bg-success/12 text-success" },
  info: { icon: "Info", className: "bg-info/12 text-info" },
  warning: { icon: "AlertTriangle", className: "bg-warning/15 text-warning" },
  danger: { icon: "XCircle", className: "bg-danger/12 text-danger" },
};

/** A member's recent sign-in attempts (newest first). */
export async function LoginActivityList({ events }: { events: LoginEvent[] }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {events.map((event) => {
        const info = describeLoginReason(event.reason, event.success);
        const tone = TONE_ICON[info.tone];
        const IconCmp = Icon[tone.icon];
        const device = deviceLabel(describeUserAgent(event.userAgent), t);
        const label = isLoginEventReason(event.reason)
          ? t(LOGIN_REASON_KEYS[event.reason])
          : event.success
            ? t("security.reason.ok")
            : event.reason
              ? info.label
              : t("security.reason.failed");
        return (
          <li key={event.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", tone.className)}>
              <IconCmp className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{label}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
                <span>{device}</span>
                {event.ip && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono" dir="ltr">{event.ip}</span>
                  </>
                )}
              </p>
            </div>
            <time dateTime={event.createdAt} title={f.dateTime(event.createdAt)} className="shrink-0 whitespace-nowrap text-xs text-ink-muted">
              {f.relative(event.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

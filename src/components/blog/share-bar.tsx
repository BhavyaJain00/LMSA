import { shareLinks } from "@/lib/seo/blog";
import { CopyButton } from "@/components/developers/copy-button";
import { Icon, type IconName } from "@/components/ui/icons";
import { getT } from "@/i18n/server";

const ICONS: Record<string, IconName> = { x: "Send", linkedin: "Briefcase", facebook: "Users", email: "Mail" };

/**
 * Share links for an article: plain intent URLs (no third-party scripts or
 * tracking), plus a copy-link button. Server Component with one client island.
 */
/** Network names are brands and stay as they are; email gets its own wording. */
const NETWORK_NAMES: Record<string, string> = { x: "X", linkedin: "LinkedIn", facebook: "Facebook" };

export async function ShareBar({ url, title }: { url: string; title: string }) {
  const t = await getT("public");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="me-1 text-sm font-medium text-ink-muted">{t("blog.share.title")}</span>
      {shareLinks(url, title).map((link) => {
        const LinkIcon = Icon[ICONS[link.network] ?? "Link"];
        const name = NETWORK_NAMES[link.network];
        const label = name ? t("blog.share.on", { network: name }) : link.network === "email" ? t("blog.share.email") : link.label;
        return (
          <a
            key={link.network}
            href={link.href}
            target={link.network === "email" ? undefined : "_blank"}
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface-1 text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <LinkIcon className="size-4" aria-hidden="true" />
          </a>
        );
      })}
      <CopyButton value={url} label={t("blog.share.copy")} />
    </div>
  );
}

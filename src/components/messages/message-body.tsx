import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseMessageBody, type InlineNode } from "@/lib/comms/messages-core";

/**
 * Renders a message body in the markdown-lite format of `parseMessageBody`.
 * Every piece is React text, so message content is always escaped; links
 * only point at http(s)/mailto addresses and open in a new tab.
 */
function inline(nodes: InlineNode[], mine: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className={cn("rounded px-1 py-0.5 font-mono text-[0.85em]", mine ? "bg-black/15" : "bg-surface-3")}>
            {n.v}
          </code>
        );
      case "strong":
        return <strong key={i}>{inline(n.c, mine)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c, mine)}</em>;
      case "del":
        return <del key={i}>{inline(n.c, mine)}</del>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn("break-all underline underline-offset-2", mine ? "text-inherit" : "text-accent")}>
            {inline(n.c, mine)}
          </a>
        );
    }
  });
}

export function MessageBody({ body, mine = false, className }: { body: string; mine?: boolean; className?: string }) {
  const blocks = parseMessageBody(body);
  return (
    <div className={cn("space-y-2 break-words text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <p key={i}>{inline(b.c, mine)}</p>;
          case "quote":
            return (
              <blockquote key={i} className={cn("border-l-2 pl-3", mine ? "border-white/50 opacity-90" : "border-border-strong text-ink-muted")}>
                {inline(b.c, mine)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-0.5 pl-5">
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, mine)}</li>
                ))}
              </ul>
            );
          case "pre":
            return (
              <pre key={i} className={cn("max-w-full overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs", mine ? "bg-black/20" : "bg-surface-3")}>
                <code>{b.v}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}

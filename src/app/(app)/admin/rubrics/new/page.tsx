import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { canUseRubrics } from "@/lib/teaching/rubrics";
import { RUBRIC_TEMPLATES, findRubricTemplate, rubricMaxPoints } from "@/lib/teaching/rubric-shared";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { param } from "@/components/assessments/shared";
import { RubricEditor } from "@/components/teaching/rubric-editor";

export const metadata: Metadata = { title: "New rubric" };

export default async function NewRubricPage(props: PageProps<"/admin/rubrics/new">) {
  const user = await requireUser("/admin/rubrics/new");
  if (!canUseRubrics(user)) redirect("/courses");
  const sp = await props.searchParams;
  const template = findRubricTemplate(param(sp.template));
  const choices = [{ key: "", title: "Blank", summary: "Start with one empty criterion." }, ...RUBRIC_TEMPLATES.map((t) => ({ key: t.key, title: t.title, summary: t.summary }))];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Rubrics", href: "/admin/rubrics" }, { label: "New rubric" }]} />}
        title="New rubric"
        description="Describe each criterion and what every level of performance looks like. Points add up automatically."
      />
      <nav aria-label="Start from" className="mb-6">
        <p className="mb-2 text-sm font-medium text-ink">Start from</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {choices.map((c) => {
            const active = (template?.key ?? "") === c.key;
            const href = c.key ? `/admin/rubrics/new?template=${c.key}` : "/admin/rubrics/new";
            const tpl = findRubricTemplate(c.key);
            return (
              <li key={c.key || "blank"}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col rounded-xl border px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    active ? "border-accent bg-accent/8" : "border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    {active && <Icon.Check className="size-3.5 text-accent" aria-hidden="true" />}
                    {c.title}
                  </span>
                  <span className="mt-0.5 text-xs text-ink-muted">
                    {c.summary}
                    {tpl && ` ${tpl.criteria.length} criteria, ${rubricMaxPoints({ criteria: tpl.criteria.map((x, i) => ({ ...x, id: String(i) })) })} pts.`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <RubricEditor
        key={template?.key ?? "blank"}
        canEdit
        initial={{ title: template?.title ?? "", passPercent: template?.passPercent ?? 60, criteria: template?.criteria ?? [] }}
      />
    </div>
  );
}

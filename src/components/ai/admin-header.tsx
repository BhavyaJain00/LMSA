import type { ReactNode } from "react";
import type { AiSiteStatus } from "@/lib/ai/access";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { AiSetupNotice } from "./setup-notice";

/** Header of the AI tutor admin pages: title, section tabs and a setup notice when the tutor isn't ready. */
export function AiAdminHeader({ description, site, isAdmin, actions }: { description: ReactNode; site: AiSiteStatus; isAdmin: boolean; actions?: ReactNode }) {
  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "AI tutor" }]} />}
        title="AI tutor"
        description={description}
        actions={actions}
        className="mb-4"
      />
      {!site.ready && <AiSetupNotice reason={site.enabled ? "no_key" : "site_disabled"} isAdmin={isAdmin} className="mb-4" compact />}
      <Tabs
        className="mb-5"
        items={[
          { label: "Review queue", href: "/admin/ai", icon: <Icon.ListChecks className="size-4" /> },
          { label: "Usage", href: "/admin/ai/usage", icon: <Icon.BarChart className="size-4" /> },
        ]}
      />
    </>
  );
}

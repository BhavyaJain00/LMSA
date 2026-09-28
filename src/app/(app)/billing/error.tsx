"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function BillingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Checkout failed to load" backHref="/courses" backLabel="Browse courses" />;
}

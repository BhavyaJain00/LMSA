"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { saveEmailTrackingAction } from "@/lib/actions/broadcasts";
import { Button } from "@/components/ui/button";
import { FormError, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * The two global tracking switches (Settings → email). Moderators see the
 * current state; only administrators can change it.
 */
export function TrackingSettingsForm({ trackOpens, trackClicks, canEdit }: { trackOpens: boolean; trackClicks: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveEmailTrackingAction, null);
  const [opens, setOpens] = useState(trackOpens);
  const [clicks, setClicks] = useState(trackClicks);
  const { toast } = useToast();
  const dirty = opens !== trackOpens || clicks !== trackClicks;

  useEffect(() => {
    if (state?.ok) toast({ title: state.message ?? "Saved", tone: "success" });
  }, [state, toast]);

  return (
    <form action={action} className="space-y-4">
      <Switch
        name="trackOpens"
        checked={opens}
        disabled={!canEdit || pending}
        onChange={(e) => setOpens(e.target.checked)}
        label="Track opens"
        description="Adds an invisible 1×1 image to broadcasts and sequence emails. Some mail apps block images or load them automatically, so open counts are estimates."
      />
      <Switch
        name="trackClicks"
        checked={clicks}
        disabled={!canEdit || pending}
        onChange={(e) => setClicks(e.target.checked)}
        label="Track link clicks"
        description="Links go through a signed redirect that records the click and forwards to the exact address in the email. Unsubscribe and account links are never tracked."
      />
      {state && !state.ok && <FormError message={state.error} />}
      {canEdit ? (
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            Save tracking settings
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Only administrators can change these settings.</p>
      )}
      <p className="text-xs text-ink-muted">Transactional emails (sign-in links, receipts, notifications) are never tracked. Changes apply to emails queued from now on.</p>
    </form>
  );
}

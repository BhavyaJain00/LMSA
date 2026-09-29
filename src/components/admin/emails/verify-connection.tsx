"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { verifySmtpConnectionAction, type VerifyConnectionResult } from "@/lib/actions/email-settings";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { formatBytes } from "@/lib/utils";

/** Connects to the SMTP server, negotiates TLS and signs in without sending anything. */
export function VerifyConnection({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<VerifyConnectionResult> | null>(null);

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" loading={pending} disabled={disabled} onClick={() => start(async () => setResult(await verifySmtpConnectionAction()))} leftIcon={<Icon.Zap className="size-4" />}>
        Verify connection
      </Button>
      {result && !result.ok && <FormError message={result.error} />}
      {result?.ok && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <p className="font-medium">{result.message}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
            <div>
              <dt className="inline font-medium text-ink">Encryption: </dt>
              <dd className="inline">{result.data.secure ? (result.data.tlsProtocol ?? "TLS") : "none"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-ink">Sign-in: </dt>
              <dd className="inline">{result.data.authMechanism ?? "not required"}</dd>
            </div>
            {result.data.maxMessageSize > 0 && (
              <div>
                <dt className="inline font-medium text-ink">Max message size: </dt>
                <dd className="inline">{formatBytes(result.data.maxMessageSize)}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="inline font-medium text-ink">Server: </dt>
              <dd className="inline break-all">{result.data.greeting}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

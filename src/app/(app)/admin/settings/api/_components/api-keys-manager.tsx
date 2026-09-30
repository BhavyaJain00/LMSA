"use client";

import { useMemo, useState, useTransition } from "react";
import { createApiKeyAction, deleteApiKeyAction, revokeApiKeyAction, type CreatedApiKey } from "@/lib/actions/api-keys";
import { API_SCOPE_IDS, READ_ONLY_SCOPES, SCOPE_GROUPS, describeScope } from "@/lib/api/scopes";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate, relativeTime } from "@/lib/utils";

/** An API key as shown to administrators (never the hash). */
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

type StatusFilter = "active" | "revoked" | "all";

function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={copied ? <Icon.Check className="size-4" /> : <Icon.Copy className="size-4" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copying isn't allowed in this browser. Select the text and copy it instead.");
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Dialog shown once after a key is created: the only time the full key is visible. */
function NewKeyDialog({ created, appUrl, onClose }: { created: CreatedApiKey | null; appUrl: string; onClose: () => void }) {
  const curl = created ? `curl -H "Authorization: Bearer ${created.key}" \\\n  ${appUrl}/api/v1` : "";
  return (
    <Dialog
      open={!!created}
      onClose={onClose}
      title="Copy your new API key"
      description="This is the only time the full key is shown. Store it in your integration's secret settings; if you lose it, revoke it and create a new one."
      size="lg"
      footer={<Button onClick={onClose}>I've stored the key</Button>}
    >
      {created && (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">{created.name}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink" aria-label="API key">
                {created.key}
              </code>
              <CopyButton value={created.key} label="Copy key" />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Test it</p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink">{curl}</pre>
            <div className="mt-2">
              <CopyButton value={curl} label="Copy command" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {created.scopes.map((scope) => (
              <Badge key={scope} tone="outline" size="xs">
                {scope}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: CreatedApiKey) => void }) {
  const [scopes, setScopes] = useState<Set<string>>(() => new Set(READ_ONLY_SCOPES));
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, errors, formError } = useFormAction(createApiKeyAction, {
    toastSuccess: false,
    onSuccess: (result) => {
      onCreated(result.data);
      setScopes(new Set(READ_ONLY_SCOPES));
      setFormKey((k) => k + 1);
    },
  });

  const toggle = (scope: string, on: boolean) =>
    setScopes((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  return (
    <Dialog open={open} onClose={onClose} title="Create an API key" description="Give each integration its own key with only the permissions it needs." size="lg">
      <form key={formKey} onSubmit={onSubmit} noValidate className="space-y-5">
        <Field label="Name" htmlFor="api-key-name" required error={errors.name} hint="Where the key is used, so you know what breaks if you revoke it.">
          <Input id="api-key-name" name="name" maxLength={80} placeholder="e.g. Zapier, HubSpot sync" autoComplete="off" invalid={!!errors.name} required />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-ink">Permissions</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setScopes(new Set(READ_ONLY_SCOPES))}>
              Read only
            </Button>
            <Button size="xs" variant="outline" onClick={() => setScopes(new Set(API_SCOPE_IDS))}>
              Full access
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setScopes(new Set())}>
              Clear
            </Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {SCOPE_GROUPS.map((group) => (
              <div key={group.resource} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{group.resource}</p>
                <div className="space-y-2">
                  {group.scopes.map((scope) => (
                    <Checkbox
                      key={scope.id}
                      id={`scope-${scope.id.replace(":", "-")}`}
                      name="scopes"
                      value={scope.id}
                      checked={scopes.has(scope.id)}
                      onChange={(e) => toggle(scope.id, e.currentTarget.checked)}
                      label={<code className="text-xs">{scope.id}</code>}
                      description={scope.description}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {errors.scopes && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {errors.scopes}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-muted">A write permission includes reading the same data.</p>
        </fieldset>

        {formError && !errors.name && !errors.scopes && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={scopes.size === 0}>
            Create key
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type PendingAction = { kind: "revoke" | "delete"; key: ApiKeyRow } | null;

export function ApiKeysManager({ keys, appUrl }: { keys: ApiKeyRow[]; appUrl: string }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [action, setAction] = useState<PendingAction>(null);
  const [working, startWork] = useTransition();

  const counts = useMemo(() => ({ active: keys.filter((k) => !k.revokedAt).length, revoked: keys.filter((k) => k.revokedAt).length, all: keys.length }), [keys]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return keys.filter((k) => {
      if (status === "active" && k.revokedAt) return false;
      if (status === "revoked" && !k.revokedAt) return false;
      if (!needle) return true;
      return `${k.name} ${k.prefix} ${k.scopes.join(" ")} ${k.createdBy ?? ""}`.toLowerCase().includes(needle);
    });
  }, [keys, query, status]);

  const confirm = () => {
    if (!action) return;
    startWork(async () => {
      const result = action.kind === "revoke" ? await revokeApiKeyAction(action.key.id) : await deleteApiKeyAction(action.key.id);
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
      setAction(null);
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="api-key-search" className="sr-only">
            Search keys
          </label>
          <Input
            id="api-key-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search keys"
            leftAddon={<Icon.Search className="size-4" />}
            className="sm:w-56"
          />
          <SegmentedControl<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: `Active (${counts.active})` },
              { value: "revoked", label: `Revoked (${counts.revoked})` },
              { value: "all", label: `All (${counts.all})` },
            ]}
          />
        </div>
        <Button size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setCreating(true)}>
          Create key
        </Button>
      </div>

      {keys.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            compact
            icon={<Icon.Lock />}
            title="No API keys yet"
            description="Create a key to connect Zapier, your CRM or your own scripts to courses, members, enrollments and payments."
            action={
              <Button size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setCreating(true)}>
                Create your first key
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-muted sm:px-5">No keys match. Try another search or filter.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((key) => (
            <li key={key.id} className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5", key.revokedAt && "opacity-70")}>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{key.name}</span>
                  {key.revokedAt ? (
                    <Badge tone="danger" size="xs">
                      Revoked
                    </Badge>
                  ) : (
                    <Badge tone="success" size="xs" dot>
                      Active
                    </Badge>
                  )}
                </div>
                <code className="block break-all font-mono text-xs text-ink-muted">{key.prefix}_••••••••</code>
                <div className="flex flex-wrap gap-1">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} tone="outline" size="xs" title={describeScope(scope)}>
                      {scope}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-ink-muted">
                  Created {formatDate(key.createdAt)}
                  {key.createdBy ? ` by ${key.createdBy}` : ""} ·{" "}
                  {key.revokedAt ? `revoked ${formatDate(key.revokedAt)}` : key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)}` : "never used"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {key.revokedAt ? (
                  <Button size="sm" variant="ghost" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setAction({ kind: "delete", key })}>
                    Delete
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-danger" leftIcon={<Icon.XCircle className="size-4" />} onClick={() => setAction({ kind: "revoke", key })}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(key) => {
          setCreating(false);
          setStatus("active");
          setCreated(key);
        }}
      />
      <NewKeyDialog created={created} appUrl={appUrl} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={confirm}
        loading={working}
        destructive
        title={action?.kind === "revoke" ? `Revoke “${action.key.name}”?` : `Delete “${action?.key.name ?? ""}”?`}
        description={
          action?.kind === "revoke"
            ? "Requests with this key fail immediately. Integrations using it stop working until you give them a new key. This can't be undone."
            : "The revoked key is removed from this list. Its entries in the audit log are kept."
        }
        confirmLabel={action?.kind === "revoke" ? "Revoke key" : "Delete key"}
      />
    </div>
  );
}

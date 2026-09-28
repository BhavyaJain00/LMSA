"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionResult, MemberType } from "@/lib/types";
import { enrollStudentAction, searchEnrollCandidatesAction } from "@/lib/actions/courses";
import { cn, formatPrice } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { EnrollCandidate } from "./types";

const MEMBER_TYPES: { value: MemberType; label: string; description: string }[] = [
  { value: "student", label: "Student", description: "Counts toward course statistics" },
  { value: "mentor", label: "Mentor", description: "Helps learners; excluded from statistics" },
  { value: "staff", label: "Staff", description: "Team member with access to the content" },
];

/** "Enroll a Student" dialog. Mount with a `key` per opening to reset it. */
export function EnrollStudentDialog({ open, onClose, courseId, paidCertificate }: { open: boolean; onClose: () => void; courseId: string; paidCertificate: boolean }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EnrollCandidate[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [selected, setSelected] = useState<EnrollCandidate | null>(null);
  const [memberType, setMemberType] = useState<MemberType>("student");
  const [purchased, setPurchased] = useState(false);
  const [paymentId, setPaymentId] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const res = await searchEnrollCandidatesAction(courseId, q);
        if (cancelled) return;
        if (res.ok) {
          setResults(res.data);
          setSearchError(null);
        } else {
          setSearchError(res.error);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, courseId]);

  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData): Promise<ActionResult | null> => {
    const result = await enrollStudentAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      toast.success(result.message ?? "Student enrolled successfully");
      onClose();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const shortQuery = query.trim().length < 2;

  return (
    <Dialog open={open} onClose={() => !pending && onClose()} title="Enroll a Student" description="Search members by name or email and add them to this course." size="lg">
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="courseId" value={courseId} />
        {selected && <input type="hidden" name="userId" value={selected.user.id} />}
        <FormError message={state && !state.ok && !errors.userId && !errors.paymentId ? state.error : null} />

        <Field label="Student" htmlFor="enroll-search" required error={errors.userId}>
          {selected ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
              <Avatar name={selected.user.name} src={selected.user.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{selected.user.name}</p>
                <p className="truncate text-xs text-ink-muted">{selected.user.email}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  setPurchased(false);
                  setPaymentId("");
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                id="enroll-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
                autoComplete="off"
                autoFocus
                leftAddon={<Icon.Search className="size-4" />}
                rightAddon={searching ? <Spinner className="size-4" /> : undefined}
                invalid={!!errors.userId}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Matching members">
                {shortQuery ? (
                  <p className="px-3 py-4 text-center text-sm text-ink-muted">Type at least 2 characters to search members.</p>
                ) : searchError ? (
                  <p className="px-3 py-4 text-center text-sm text-danger">{searchError}</p>
                ) : results === null ? (
                  <p className="px-3 py-4 text-center text-sm text-ink-muted">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-ink-muted">No members match “{query.trim()}”.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {results.map((c) => (
                      <li key={c.user.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          disabled={c.enrolled}
                          onClick={() => setSelected(c)}
                          className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors", c.enrolled ? "cursor-not-allowed opacity-60" : "hover:bg-surface-2")}
                        >
                          <Avatar name={c.user.name} src={c.user.avatarUrl} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{c.user.name}</span>
                            <span className="block truncate text-xs text-ink-muted">{c.user.email}</span>
                          </span>
                          {c.enrolled && <Badge tone="success">Enrolled</Badge>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Field>

        <Field label="Member type" htmlFor="enroll-member-type" hint={MEMBER_TYPES.find((m) => m.value === memberType)?.description}>
          <Select id="enroll-member-type" name="memberType" value={memberType} onChange={(e) => setMemberType(e.target.value as MemberType)}>
            {MEMBER_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        {paidCertificate && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <Checkbox
              name="purchasedCertificate"
              id="enroll-purchased"
              checked={purchased}
              onChange={(e) => setPurchased(e.target.checked)}
              label="Purchased Certificate"
              description="The learner already paid for the evaluated certificate."
            />
            {purchased && (
              <Field label="Payment" htmlFor="enroll-payment" required error={errors.paymentId}>
                <Select id="enroll-payment" name="paymentId" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} invalid={!!errors.paymentId} disabled={!selected}>
                  <option value="">{selected ? (selected.payments.length ? "Select payment" : "No paid orders for this course") : "Select a student first"}</option>
                  {selected?.payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.orderId} · {formatPrice(p.amount, p.currency)} · {p.itemType}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!selected} leftIcon={<Icon.UserPlus className="size-4" />}>
            Enroll
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

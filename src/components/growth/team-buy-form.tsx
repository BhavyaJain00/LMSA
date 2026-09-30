"use client";

import { useActionState, useId, useMemo, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { buyMoreSeatsAction, startTeamPurchaseAction } from "@/lib/actions/teams";
import { MAX_SEATS_PER_ORDER, MAX_TEAM_COURSES, TEAM_NAME_MAX, quoteSeats } from "@/lib/growth/teams-shared";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { money } from "@/components/commerce/order-summary";
import { cn, pluralize } from "@/lib/utils";

export interface BuyCourse {
  id: string;
  title: string;
  price: number;
  currency: string;
}

interface Props {
  /** Courses to choose from (new team) or the team's courses (more seats). */
  courses: BuyCourse[];
  /** Set when buying more seats for an existing team: its courses are fixed. */
  team?: { id: string; name: string };
  /** The checkout sells seats online; otherwise only the invoice route is offered. */
  checkoutReady: boolean;
  defaultName?: string;
  defaultSeats?: number;
  preselected?: string[];
}

const SEARCH_THRESHOLD = 8;

/**
 * "For teams" purchase form: company name, number of seats and the courses
 * every seat unlocks, with a live total. The price shown here is indicative;
 * the order is priced again on the server.
 */
export function TeamBuyForm({ courses, team, checkoutReady, defaultName = "", defaultSeats = 5, preselected = [] }: Props) {
  const id = useId();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(team ? buyMoreSeatsAction : startTeamPurchaseAction, null);
  const [name, setName] = useState(defaultName);
  const [seatsText, setSeatsText] = useState(String(defaultSeats));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(team ? courses.map((c) => c.id) : preselected.filter((p) => courses.some((c) => c.id === p))));
  const [query, setQuery] = useState("");

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const seats = /^\d{1,4}$/.test(seatsText.trim()) ? Number(seatsText) : 0;
  const chosen = useMemo(() => courses.filter((c) => selected.has(c.id)), [courses, selected]);
  const currency = chosen[0]?.currency;
  const quoted = quoteSeats(
    chosen.map((c) => ({ ...c, paidCourse: true })),
    seats,
  );
  const unitAmount = chosen.reduce((sum, c) => sum + c.price, 0);
  const visible = query.trim() ? courses.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase())) : courses;

  const toggle = (courseId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else if (next.size < MAX_TEAM_COURSES) next.add(courseId);
      return next;
    });
  const step = (delta: number) => setSeatsText(String(Math.min(MAX_SEATS_PER_ORDER, Math.max(1, (seats || 0) + delta))));

  return (
    <form action={formAction} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {team && <input type="hidden" name="orgId" value={team.id} />}
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title={team ? "How many seats?" : "Your team"} />
          <CardBody className="space-y-4">
            {!team && (
              <Field label="Company or team name" htmlFor={`${id}-name`} required error={errors.name} hint="Shown to the people you invite and on your invoice.">
                <Input
                  id={`${id}-name`}
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  maxLength={TEAM_NAME_MAX}
                  autoComplete="organization"
                  invalid={!!errors.name}
                  required
                />
              </Field>
            )}
            <Field label="Seats" htmlFor={`${id}-seats`} required error={errors.seats} hint={`One seat per person. You can buy more later (up to ${MAX_SEATS_PER_ORDER} per order).`}>
              <div className="flex max-w-56 items-center gap-2">
                <Button variant="outline" size="icon" aria-label="One seat less" onClick={() => step(-1)} disabled={seats <= 1}>
                  <Icon.Minus className="size-4" aria-hidden="true" />
                </Button>
                <Input
                  id={`${id}-seats`}
                  name="seats"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_SEATS_PER_ORDER}
                  step={1}
                  value={seatsText}
                  onChange={(e) => setSeatsText(e.currentTarget.value)}
                  invalid={!!errors.seats}
                  className="text-center tabular-nums"
                  required
                />
                <Button variant="outline" size="icon" aria-label="One seat more" onClick={() => step(1)} disabled={seats >= MAX_SEATS_PER_ORDER}>
                  <Icon.Plus className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={team ? "Included courses" : "Courses for every seat"}
            description={team ? `Every seat in ${team.name} unlocks these courses.` : "Each team member gets access to all the courses you choose."}
          />
          <CardBody className="space-y-3">
            {!team && courses.length > SEARCH_THRESHOLD && (
              <>
                <label htmlFor={`${id}-search`} className="sr-only">
                  Search courses
                </label>
                <Input id={`${id}-search`} type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search courses" leftAddon={<Icon.Search className="size-4" />} />
              </>
            )}
            {errors.courseIds && <FormError message={errors.courseIds} />}
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label={team ? "Included courses" : "Available courses"}>
              {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">No course matches “{query}”.</li>}
              {visible.map((course) => {
                const checked = selected.has(course.id);
                const otherCurrency = !team && !!currency && course.currency !== currency && !checked;
                const inputId = `${id}-course-${course.id}`;
                return (
                  <li key={course.id}>
                    <label htmlFor={inputId} className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", team || otherCurrency ? "cursor-default" : "cursor-pointer hover:bg-surface-2", otherCurrency && "opacity-60")}>
                      {team ? (
                        <Icon.CheckCircle className="size-4 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <input
                          id={inputId}
                          type="checkbox"
                          name="courseIds"
                          value={course.id}
                          checked={checked}
                          disabled={otherCurrency}
                          onChange={() => toggle(course.id)}
                          className="size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{course.title}</span>
                        {otherCurrency && <span className="block text-xs text-ink-muted">Sold in {course.currency}: can&apos;t be combined with {currency} courses</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">{money(course.price, course.currency)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {/* Selected courses hidden by the search still belong to the order. */}
            {!team && chosen.filter((c) => !visible.includes(c)).map((c) => <input key={c.id} type="hidden" name="courseIds" value={c.id} />)}
          </CardBody>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-20">
        <Card>
          <CardHeader title="Order summary" />
          <CardBody className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">
                  {pluralize(chosen.length, "course")} per seat
                </dt>
                <dd className="tabular-nums text-ink">{currency ? money(unitAmount, currency) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Seats</dt>
                <dd className="tabular-nums text-ink">× {seats || 0}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                <dt className="text-ink">Total</dt>
                <dd className="tabular-nums text-ink" aria-live="polite">
                  {quoted.ok ? money(quoted.quote.amount, quoted.quote.currency) : "—"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-ink-muted">Taxes and coupons are applied at checkout. Seats never expire; reassign them whenever your team changes.</p>
            {state && !state.ok && !Object.keys(errors).length && <FormError message={state.error} />}
            {!quoted.ok && chosen.length > 0 && seats > 0 && <FormError message={quoted.error} />}
            <div className="space-y-2">
              {checkoutReady && (
                <Button type="submit" name="mode" value="checkout" className="w-full" loading={pending} disabled={!quoted.ok} rightIcon={<Icon.ArrowRight className="size-4" />}>
                  Continue to checkout
                </Button>
              )}
              <Button type="submit" name="mode" value="invoice" variant={checkoutReady ? "outline" : "primary"} className="w-full" loading={pending && !checkoutReady} disabled={!quoted.ok || pending} leftIcon={<Icon.Receipt className="size-4" />}>
                {checkoutReady ? "Pay by invoice instead" : "Request an invoice"}
              </Button>
            </div>
            <p className="text-xs text-ink-muted">
              {checkoutReady
                ? "Prefer a purchase order or bank transfer? Ask for an invoice and we add your seats as soon as it is paid."
                : "We email you an invoice and add your seats as soon as it is paid."}
            </p>
          </CardBody>
        </Card>
      </aside>
    </form>
  );
}

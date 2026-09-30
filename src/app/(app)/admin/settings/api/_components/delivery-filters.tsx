import { DELIVERY_STATUSES, DELIVERY_STATUS_LABELS, isDeliveryFilterActive, type DeliveryFilter } from "@/lib/webhooks/log";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";

/**
 * Filters of the delivery log. A plain GET form: the filter lives in the
 * URL (so it can be shared and survives a refresh), submitting it goes back
 * to page 1, and it works without JavaScript.
 */
export function DeliveryFilters({ action, filter }: { action: string; filter: DeliveryFilter }) {
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label="Filter deliveries"
      className="grid gap-2 border-b border-border px-4 py-3 sm:grid-cols-2 sm:px-5 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]"
    >
      <Input
        type="search"
        name="q"
        defaultValue={filter.q}
        aria-label="Search deliveries"
        placeholder="Search event id, status code or error"
        maxLength={200}
        leftAddon={<Icon.Search className="size-4" />}
      />
      <Select name="status" defaultValue={filter.status} aria-label="Status">
        <option value="">Any status</option>
        {DELIVERY_STATUSES.map((status) => (
          <option key={status} value={status}>
            {DELIVERY_STATUS_LABELS[status]}
          </option>
        ))}
      </Select>
      <Select name="event" defaultValue={filter.event} aria-label="Event">
        <option value="">Any event</option>
        {WEBHOOK_EVENTS.map((event) => (
          <option key={event.name} value={event.name}>
            {event.name}
          </option>
        ))}
      </Select>
      <Select name="kind" defaultValue={filter.kind} aria-label="Kind of delivery">
        <option value="">Events and tests</option>
        <option value="live">Events only</option>
        <option value="test">Tests only</option>
      </Select>
      <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
        <Button type="submit" variant="outline" leftIcon={<Icon.Filter className="size-4" />}>
          Filter
        </Button>
        {isDeliveryFilterActive(filter) && (
          <ButtonLink href={action} variant="ghost">
            Clear
          </ButtonLink>
        )}
      </div>
    </form>
  );
}

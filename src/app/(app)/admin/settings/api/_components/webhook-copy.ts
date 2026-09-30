/** Confirmation wording shared by the endpoint list and the endpoint page. */

export const DELETE_ENDPOINT_WARNING = "Events are no longer sent to this URL and its delivery log is removed. This can't be undone.";

export function turnOffWarning(pending: number): string {
  const base = "Events are not sent to it until you turn it back on";
  const queue = "Events that happen while it is off are not queued.";
  if (!pending) return `${base}. ${queue}`;
  return `${base}, and the ${pending} ${pending === 1 ? "delivery" : "deliveries"} waiting for a retry ${pending === 1 ? "is" : "are"} cancelled. ${queue}`;
}

/** Why the system switched an endpoint off. */
export function disabledReasonText(reason: string): string {
  return reason === "gone" ? "Switched off automatically: the receiver answered 410 Gone." : "Switched off automatically after a day of failed deliveries.";
}

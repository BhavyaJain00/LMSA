/** In-page anchors of the /developers reference (shared by the server page and the client browser). */

/** Endpoint group ("Courses" → "endpoints-courses"). */
export function tagAnchor(tag: string): string {
  return `endpoints-${tag.toLowerCase()}`;
}

/** Response object in the "Objects" section. */
export function objectAnchor(resource: string): string {
  return `object-${resource}`;
}

/** Webhook event in the event catalog ("payment.paid" → "event-payment-paid"). */
export function eventAnchor(name: string): string {
  return `event-${name.replace(/[^a-z0-9]+/gi, "-")}`;
}

/**
 * Stand-in for the `server-only` package. The real module throws when it is
 * imported outside a React Server Components build; tests run on the server
 * side by definition, so the guard is a no-op here.
 */
export {};

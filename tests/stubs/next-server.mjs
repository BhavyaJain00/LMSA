/**
 * Minimal fake of `next/server` for tests. `after()` runs its task detached on
 * the next tick (what happens outside a request in a real server), errors are
 * logged instead of crashing the test process. `NextResponse` covers the
 * helpers route handlers use most.
 */

export function after(task) {
  setTimeout(() => {
    Promise.resolve()
      .then(() => (typeof task === "function" ? task() : task))
      .catch((error) => console.error("[test after()]", error));
  }, 0);
}

export async function connection() {}

/** The `response.cookies` API, writing `Set-Cookie` headers. */
class ResponseCookies {
  #headers;
  constructor(headers) {
    this.#headers = headers;
  }

  set(nameOrOptions, value, options = {}) {
    const o = typeof nameOrOptions === "string" ? { ...options, name: nameOrOptions, value } : nameOrOptions;
    const parts = [`${o.name}=${encodeURIComponent(o.value ?? "")}`];
    if (o.path) parts.push(`Path=${o.path}`);
    if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
    if (o.httpOnly) parts.push("HttpOnly");
    if (o.secure) parts.push("Secure");
    if (o.sameSite) parts.push(`SameSite=${o.sameSite}`);
    this.#headers.append("set-cookie", parts.join("; "));
    return this;
  }

  get(name) {
    const line = this.#headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
    return line ? { name, value: decodeURIComponent(line.slice(name.length + 1).split(";")[0]) } : undefined;
  }

  delete(name) {
    return this.set({ name, value: "", path: "/", maxAge: 0 });
  }
}

export class NextResponse extends Response {
  constructor(body, init) {
    super(body, init);
    this.cookies = new ResponseCookies(this.headers);
  }

  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }

  /** Like Next: the second argument is a status code or a ResponseInit (status defaults to 307). */
  static redirect(url, init) {
    const options = typeof init === "number" ? { status: init } : (init ?? {});
    const headers = new Headers(options.headers);
    headers.set("location", String(url));
    return new NextResponse(null, { ...options, status: options.status ?? 307, headers });
  }

  static rewrite(url, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-middleware-rewrite", String(url));
    return new NextResponse(null, { ...init, headers });
  }

  static next() {
    return new NextResponse(null, { headers: { "x-middleware-next": "1" } });
  }
}

export const NextRequest = Request;

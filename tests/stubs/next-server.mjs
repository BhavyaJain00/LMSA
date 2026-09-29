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

export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }

  static redirect(url, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }

  static next() {
    return new NextResponse(null, { headers: { "x-middleware-next": "1" } });
  }
}

export const NextRequest = Request;

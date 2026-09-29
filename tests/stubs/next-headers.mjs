/**
 * Minimal fake of `next/headers` for tests.
 *
 * There is one simulated request per test process. Its cookies and headers
 * live on `globalThis.__llTestRequest`, which tests control through
 * `tests/helpers/request.ts` (`resetRequest`, `setRequestCookie`, …).
 * Cookies written with `cookies().set()` are visible to later `get()` calls,
 * like in a Server Action; a `maxAge` of 0 (or an expired date) deletes them.
 */

function state() {
  globalThis.__llTestRequest ??= { cookies: new Map(), headers: new Headers() };
  return globalThis.__llTestRequest;
}

function expired(options) {
  if (options.maxAge !== undefined && Number(options.maxAge) <= 0) return true;
  if (options.expires !== undefined) {
    const at = options.expires instanceof Date ? options.expires.getTime() : Number(options.expires);
    if (Number.isFinite(at) && at <= Date.now()) return true;
  }
  return false;
}

class RequestCookies {
  get(name) {
    const key = typeof name === "object" ? name.name : name;
    const value = state().cookies.get(key);
    return value === undefined ? undefined : { name: key, value };
  }

  getAll(name) {
    const all = [...state().cookies].map(([key, value]) => ({ name: key, value }));
    return name === undefined ? all : all.filter((c) => c.name === name);
  }

  has(name) {
    return state().cookies.has(name);
  }

  set(nameOrOptions, value, options = {}) {
    const opts = typeof nameOrOptions === "object" ? nameOrOptions : { ...options, name: nameOrOptions, value };
    if (expired(opts)) state().cookies.delete(opts.name);
    else state().cookies.set(opts.name, String(opts.value ?? ""));
    return this;
  }

  delete(nameOrOptions) {
    state().cookies.delete(typeof nameOrOptions === "object" ? nameOrOptions.name : nameOrOptions);
    return this;
  }

  get size() {
    return state().cookies.size;
  }

  toString() {
    return [...state().cookies].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("; ");
  }
}

export async function cookies() {
  return new RequestCookies();
}

export async function headers() {
  return state().headers;
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}

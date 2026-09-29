/**
 * Read a small request body without trusting its size: the Content-Length is
 * checked first and the stream is read with a byte cap, so an oversized (or
 * chunked, length-less) body is rejected after at most `maxBytes + 1` bytes
 * instead of being buffered whole like `request.text()` would.
 *
 * Pure module (web APIs only) so it can be unit tested.
 */
export type LimitedBody = { ok: true; text: string } | { ok: false; status: 400 | 413 };

export async function readLimitedText(request: Request, maxBytes: number): Promise<LimitedBody> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d{1,15}$/.test(length.trim())) return { ok: false, status: 400 };
    if (Number(length) > maxBytes) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop reading: only a client that lied about (or omitted) the length gets here.
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/**
 * Minimal Server-Sent Events codec (client-safe, pure).
 *
 * Used twice: on the server to read the Anthropic Messages stream, and in the
 * browser to read the tutor's own `/api/ai/chat` stream.
 */

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental parser: feed decoded text with `push()` as it arrives, call
 * `end()` when the stream closes. Handles \n, \r\n and \r line endings,
 * multi-line `data:` fields and comments.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length) onMessage({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") return dispatch();
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      const re = /\r\n|\r|\n/g;
      let start = 0;
      while ((match = re.exec(buffer))) {
        // A trailing "\r" may be the first half of "\r\n": wait for more input.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        line(buffer.slice(start, match.index));
        start = match.index + match[0].length;
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer) line(buffer);
      buffer = "";
      dispatch();
    },
  };
}

/** Encode one SSE message with a JSON payload. */
export function encodeSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

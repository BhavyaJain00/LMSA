import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CRLF,
  buildMimeMessage,
  chooseEncoding,
  chunkUtf8,
  createMessageId,
  decodeQuotedPrintable,
  decodeWords,
  domainOf,
  encodeBase64Lines,
  encodeQuotedPrintable,
  encodeWords,
  foldHeader,
  formatAddress,
  formatRfc5322Date,
  isPrintableAscii,
  isSafeAddress,
  needsSmtpUtf8,
  parseAddress,
  sanitizeHeaderValue,
  toCrlf,
  unfoldHeader,
} from "@/lib/email/mime";

const SAMPLES = [
  "",
  "plain ascii",
  "Grüße aus Köln — €5 ✓",
  "日本語のテキスト",
  "emoji 🚀🎉 and ZWJ 👩‍💻",
  "=?UTF-8?B?not really?=",
  "tabs\tand  double  spaces ",
  "x".repeat(300),
  `${"é".repeat(100)} ${"a".repeat(70)}= end=`,
];

/** Split a raw message into unfolded headers and the body. */
function parseMessage(raw: string): { headers: Map<string, string>; body: string } {
  const split = raw.indexOf(`${CRLF}${CRLF}`);
  const headerBlock = unfoldHeader(raw.slice(0, split));
  const headers = new Map<string, string>();
  for (const line of headerBlock.split(CRLF)) {
    const colon = line.indexOf(":");
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body: raw.slice(split + 4) };
}

function decodePart(part: string): { contentType: string; content: string } {
  const { headers, body } = parseMessage(part);
  const encoding = headers.get("content-transfer-encoding");
  const content = encoding === "base64" ? Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") : decodeQuotedPrintable(body);
  return { contentType: headers.get("content-type") ?? "", content };
}

describe("header values", () => {
  it("detects printable ASCII", () => {
    assert.equal(isPrintableAscii("Hello, World! ~"), true);
    assert.equal(isPrintableAscii("tab\there"), false);
    assert.equal(isPrintableAscii("café"), false);
  });

  it("strips CR/LF and control characters (header injection)", () => {
    assert.equal(sanitizeHeaderValue("Hello\r\nBcc: evil@example.com"), "Hello Bcc: evil@example.com");
    assert.equal(sanitizeHeaderValue("  a\t\tb \u0000 c\u007f  "), "a b c");
    assert.equal(toCrlf("a\nb\rc\r\nd"), "a\r\nb\r\nc\r\nd");
  });

  it("splits UTF-8 into byte-bounded chunks without breaking characters", () => {
    for (const sample of SAMPLES) {
      const chunks = chunkUtf8(sample, 45);
      assert.equal(chunks.join(""), sample);
      for (const chunk of chunks) {
        assert.ok(Buffer.byteLength(chunk, "utf8") <= 45);
        assert.ok(!Buffer.from(chunk, "utf8").toString("utf8").includes("�") || chunk.includes("�"));
      }
    }
  });
});

describe("RFC 2047 encoded-words", () => {
  it("leaves printable ASCII as is", () => {
    assert.equal(encodeWords("Your course starts tomorrow"), "Your course starts tomorrow");
  });

  it("encodes non-ASCII text in words of at most 75 characters that decode back", () => {
    for (const sample of SAMPLES) {
      const encoded = encodeWords(sample);
      if (!isPrintableAscii(sanitizeHeaderValue(sample))) {
        for (const word of encoded.split(" ")) {
          assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
          assert.ok(word.length <= 75, word);
        }
      }
      assert.equal(decodeWords(encoded), sanitizeHeaderValue(sample));
    }
  });

  it("encodes ASCII text that would otherwise look like an encoded-word", () => {
    const tricky = "Use =?UTF-8?B?QWRtaW4=?= in headers";
    assert.notEqual(encodeWords(tricky), tricky);
    assert.equal(decodeWords(encodeWords(tricky)), tricky);
    const address = formatAddress({ address: "ada@example.com", name: "=?UTF-8?B?QWRtaW4=?=" });
    assert.equal(decodeWords(address), "=?UTF-8?B?QWRtaW4=?= <ada@example.com>");
  });

  it("decodes Q encoding and joins adjacent words", () => {
    assert.equal(decodeWords("=?UTF-8?Q?Caf=C3=A9_au_lait?="), "Café au lait");
    assert.equal(decodeWords("=?utf-8?q?a?= =?utf-8?q?b?="), "ab");
    assert.equal(decodeWords("Re: =?UTF-8?B?w7w=?= plain"), "Re: ü plain");
  });
});

describe("addresses", () => {
  it("validates envelope addresses strictly", () => {
    for (const ok of ["ada@example.com", "a.b+tag@sub.example.co.uk", "x_y-z@ex-ample.io"]) assert.equal(isSafeAddress(ok), true, ok);
    for (const bad of [
      "",
      "no-at-sign",
      "a@b",
      "a b@example.com",
      "a@b..com",
      ".a@example.com",
      "a.@example.com",
      "a..b@example.com",
      "a@-example.com",
      "<a@example.com>",
      "a@example.com\r\nBcc: x@y.z",
      "a@example.com,b@example.com",
      `${"a".repeat(65)}@example.com`,
      `a@${"b".repeat(250)}.com`,
    ]) {
      assert.equal(isSafeAddress(bad), false, bad);
    }
    assert.equal(needsSmtpUtf8("jörg@example.com"), true);
    assert.equal(needsSmtpUtf8("jorg@example.com"), false);
  });

  it("parses display names", () => {
    assert.deepEqual(parseAddress("Ada Lovelace <ada@example.com>"), { address: "ada@example.com", name: "Ada Lovelace" });
    assert.deepEqual(parseAddress('"Lovelace, Ada" <ada@example.com>'), { address: "ada@example.com", name: "Lovelace, Ada" });
    assert.deepEqual(parseAddress('"Say \\"hi\\"" <ada@example.com>'), { address: "ada@example.com", name: 'Say "hi"' });
    assert.deepEqual(parseAddress("  ada@example.com "), { address: "ada@example.com" });
    assert.deepEqual(parseAddress("<ada@example.com>"), { address: "ada@example.com" });
    for (const bad of ["", "Ada", "Ada <not-an-address>", "Ada <ada@example.com>\r\nBcc: evil@example.com", "a@b"]) assert.equal(parseAddress(bad), null, bad);
  });

  it("formats display names safely", () => {
    assert.equal(formatAddress({ address: "ada@example.com" }), "ada@example.com");
    assert.equal(formatAddress({ address: "ada@example.com", name: "Ada" }), "Ada <ada@example.com>");
    assert.equal(formatAddress({ address: "ada@example.com", name: 'Lovelace, "Ada"' }), '"Lovelace, \\"Ada\\"" <ada@example.com>');
    const encoded = formatAddress({ address: "jo@example.com", name: "Jörg Müller" });
    assert.match(encoded, /^=\?UTF-8\?B\?.+\?= <jo@example\.com>$/);
    assert.equal(decodeWords(encoded), "Jörg Müller <jo@example.com>");
    assert.equal(formatAddress({ address: "ada@example.com", name: "Ada\r\nBcc: x@y.z" }), '"Ada Bcc: x@y.z" <ada@example.com>');
  });
});

describe("header folding", () => {
  it("keeps short headers on one line", () => {
    assert.equal(foldHeader("Subject", "Hello"), "Subject: Hello");
  });

  it("folds long headers at whitespace to 78 characters and unfolds exactly", () => {
    const value = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const folded = foldHeader("Subject", value);
    const lines = folded.split(CRLF);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 78, line);
    for (const line of lines.slice(1)) assert.match(line, /^ \S/);
    assert.equal(unfoldHeader(folded), `Subject: ${value}`);
  });

  it("never folds right after the header name and leaves unbreakable values intact", () => {
    const url = `https://example.com/${"x".repeat(120)}`;
    assert.equal(foldHeader("List-Unsubscribe", `<${url}>`), `List-Unsubscribe: <${url}>`);
    const mixed = foldHeader("X-Test", `${"a".repeat(90)} tail`);
    assert.equal(mixed, `X-Test: ${"a".repeat(90)}${CRLF} tail`);
  });
});

describe("quoted-printable", () => {
  it("escapes '=', non-ASCII bytes and trailing whitespace", () => {
    assert.equal(encodeQuotedPrintable("a=b"), "a=3Db");
    assert.equal(encodeQuotedPrintable("café"), "caf=C3=A9");
    assert.equal(encodeQuotedPrintable("trailing space \nand tab\t"), "trailing space=20\r\nand tab=09");
    assert.equal(encodeQuotedPrintable("From the team"), "=46rom the team");
    assert.equal(encodeQuotedPrintable(".leading dot"), ".leading dot");
  });

  it("soft-wraps at 76 characters without splitting escapes", () => {
    const encoded = encodeQuotedPrintable(`${"é".repeat(60)}${"x".repeat(100)}`);
    for (const line of encoded.split(CRLF)) {
      assert.ok(line.length <= 76, `${line.length}: ${line}`);
      assert.ok(!/=[0-9A-F]?$/.test(line.slice(0, -1)) || line.endsWith("="), "escape split across a soft break");
      assert.ok(!/=.?$/.test(line) || line.endsWith("=") || /=[0-9A-F]{2}$/.test(line));
    }
  });

  it("round-trips arbitrary text", () => {
    for (const sample of [...SAMPLES, "line1\nline2\r\nline3\n\n", "a".repeat(76), "b".repeat(75) + "=", " ".repeat(80), "x\t".repeat(50)]) {
      assert.equal(decodeQuotedPrintable(encodeQuotedPrintable(sample)), sample.replace(/\r\n/g, "\n"), JSON.stringify(sample.slice(0, 20)));
    }
  });

  it("decodes soft breaks and lower-case hex", () => {
    assert.equal(decodeQuotedPrintable("caf=c3=a9=\r\n au=\nlait"), "café aulait");
  });
});

describe("body encodings", () => {
  it("wraps base64 at 76 characters", () => {
    const text = "日本語".repeat(40);
    const encoded = encodeBase64Lines(text);
    for (const line of encoded.split(CRLF)) assert.ok(line.length <= 76);
    assert.equal(Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8"), text);
  });

  it("chooses quoted-printable for mostly ASCII and base64 otherwise", () => {
    assert.equal(chooseEncoding(""), "quoted-printable");
    assert.equal(chooseEncoding("Hello Ada, your certificate is ready."), "quoted-printable");
    assert.equal(chooseEncoding("日本語のメッセージです。よろしくお願いします。"), "base64");
  });
});

describe("dates and ids", () => {
  it("formats RFC 5322 dates in UTC", () => {
    assert.equal(formatRfc5322Date(new Date(Date.UTC(2026, 8, 29, 10, 4, 5))), "Tue, 29 Sep 2026 10:04:05 +0000");
    assert.equal(formatRfc5322Date(new Date(Date.UTC(2027, 0, 3, 0, 0, 0))), "Sun, 03 Jan 2027 00:00:00 +0000");
  });

  it("creates unique message ids for a safe domain", () => {
    const id = createMessageId("lms.example.com");
    assert.match(id, /^<[0-9a-z]+\.[0-9a-f]{24}@lms\.example\.com>$/);
    assert.notEqual(createMessageId("lms.example.com"), id);
    assert.match(createMessageId("bad domain>"), /@localhost>$/);
    assert.equal(domainOf("Ada@Example.COM"), "example.com");
    assert.equal(domainOf("nodomain"), "localhost");
  });
});

describe("buildMimeMessage", () => {
  const base = {
    from: { address: "no-reply@lms.test", name: "LearnLoop" },
    to: [{ address: "ada@example.com", name: "Ada Lovelace" }],
    subject: "Your certificate is ready ✓",
    text: "Hi Ada,\n\nYour certificate is ready.\n.\nBye",
    html: "<p>Hi Ada,</p><p>Your certificate is <b>ready</b> — ünïcødé.</p>",
    messageId: "<abc.123@lms.test>",
    date: new Date(Date.UTC(2026, 8, 29, 10, 4, 5)),
  };

  it("requires a recipient", () => {
    assert.throws(() => buildMimeMessage({ ...base, to: [] }), /at least one recipient/);
  });

  it("builds a multipart/alternative message with decodable parts", () => {
    const built = buildMimeMessage({ ...base, cc: [{ address: "cc@example.com" }], replyTo: { address: "help@lms.test", name: "Help desk" } });
    assert.equal(built.messageId, "<abc.123@lms.test>");
    assert.ok(!/[^\r]\n/.test(built.raw), "no bare LF");
    assert.ok(built.raw.split(CRLF).every((line) => line.length <= 998));

    const { headers, body } = parseMessage(built.raw);
    assert.equal(headers.get("from"), "LearnLoop <no-reply@lms.test>");
    assert.equal(headers.get("to"), "Ada Lovelace <ada@example.com>");
    assert.equal(headers.get("cc"), "cc@example.com");
    assert.equal(headers.get("reply-to"), "Help desk <help@lms.test>");
    assert.equal(decodeWords(headers.get("subject")!), base.subject);
    assert.equal(headers.get("date"), "Tue, 29 Sep 2026 10:04:05 +0000");
    assert.equal(headers.get("message-id"), "<abc.123@lms.test>");
    assert.equal(headers.get("mime-version"), "1.0");
    const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type")!)?.[1];
    assert.ok(boundary && headers.get("content-type")!.startsWith("multipart/alternative"));

    const parts = body.split(`--${boundary}`);
    assert.equal(parts.length, 4);
    assert.equal(parts[3]!.trim(), "--");
    const text = decodePart(parts[1]!.replace(/^\r\n/, "").replace(/\r\n$/, ""));
    const html = decodePart(parts[2]!.replace(/^\r\n/, "").replace(/\r\n$/, ""));
    assert.equal(text.contentType, "text/plain; charset=utf-8");
    assert.equal(text.content, base.text);
    assert.equal(html.contentType, "text/html; charset=utf-8");
    assert.equal(html.content, base.html);
  });

  it("builds a single-part text message", () => {
    const built = buildMimeMessage({ ...base, html: undefined, text: "日本語のメッセージです。" });
    const { headers, body } = parseMessage(built.raw);
    assert.equal(headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(headers.get("content-transfer-encoding"), "base64");
    assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "日本語のメッセージです。");
  });

  it("cannot be tricked into extra headers", () => {
    const built = buildMimeMessage({
      ...base,
      subject: "Hello\r\nBcc: evil@example.com",
      to: [{ address: "ada@example.com", name: "Ada\r\nBcc: evil@example.com" }],
      headers: {
        "X-Campaign": "spring\r\nBcc: evil@example.com",
        Bcc: "evil@example.com",
        "Content-Type": "text/html",
        "Bad Name": "x",
        "X-Empty": "   ",
        "X-Unicode": "Grüße",
      },
    });
    const lines = built.raw.slice(0, built.raw.indexOf(`${CRLF}${CRLF}`)).split(CRLF);
    assert.ok(!lines.some((l) => /^bcc:/i.test(l)));
    assert.equal(lines.filter((l) => /^content-type:/i.test(l)).length, 1);
    const { headers } = parseMessage(built.raw);
    assert.equal(headers.get("x-campaign"), "spring Bcc: evil@example.com");
    assert.equal(headers.has("bad name"), false);
    assert.equal(headers.has("x-empty"), false);
    assert.equal(decodeWords(headers.get("x-unicode")!), "Grüße");
    assert.equal(decodeWords(headers.get("subject")!), "Hello Bcc: evil@example.com");
  });

  it("generates a Message-ID from the sender domain when none is given", () => {
    const built = buildMimeMessage({ ...base, messageId: undefined });
    assert.match(built.messageId, /@lms\.test>$/);
  });
});

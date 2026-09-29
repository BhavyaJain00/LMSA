import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplyParser,
  SmtpConnection,
  SmtpError,
  dotStuff,
  dotUnstuff,
  ehloName,
  isLoopbackHost,
  isSmtpError,
  parseEhloCapabilities,
  parseReplies,
  parseReplyLine,
  sendMailOnce,
  verifySmtp,
  type SmtpClientOptions,
} from "@/lib/email/smtp";
import { buildMimeMessage } from "@/lib/email/mime";
import { closedPort, startFakeSmtpServer, type FakeSmtpServer } from "../helpers/smtp-server";

describe("reply parsing", () => {
  it("parses single reply lines", () => {
    assert.deepEqual(parseReplyLine("250-SIZE 1000"), { code: 250, last: false, text: "SIZE 1000" });
    assert.deepEqual(parseReplyLine("250 OK"), { code: 250, last: true, text: "OK" });
    assert.deepEqual(parseReplyLine("354"), { code: 354, last: true, text: "" });
    for (const bad of ["", "abc", "25 short", "600 bad class", "2500 too long", "250_x"]) assert.equal(parseReplyLine(bad), null, bad);
  });

  it("assembles multi-line replies across arbitrary chunk boundaries", () => {
    const transcript = "250-mail.example.com Hello\r\n250-SIZE 35882577\r\n250 AUTH PLAIN\r\n550 5.1.1 No such user\r\n";
    for (let split = 1; split < transcript.length; split += 3) {
      const parser = new ReplyParser();
      const replies = [...parser.push(transcript.slice(0, split)), ...parser.push(transcript.slice(split))];
      assert.equal(replies.length, 2, `split at ${split}`);
      assert.deepEqual(replies[0], { code: 250, enhancedCode: undefined, lines: ["mail.example.com Hello", "SIZE 35882577", "AUTH PLAIN"], text: "mail.example.com Hello\nSIZE 35882577\nAUTH PLAIN" });
      assert.equal(replies[1]!.enhancedCode, "5.1.1");
      assert.equal(parser.hasPendingData(), false);
    }
  });

  it("tolerates bare LF and keeps partial lines buffered", () => {
    const { replies, rest } = parseReplies("220 ready\n250-a\r\n250 b\r\n354 go");
    assert.deepEqual(replies.map((r) => r.code), [220, 250]);
    assert.equal(rest, "354 go");
    const parser = new ReplyParser();
    parser.push("250-partial\r\n");
    assert.equal(parser.hasPendingData(), true);
    parser.reset();
    assert.equal(parser.hasPendingData(), false);
  });

  it("throws protocol errors for malformed or inconsistent replies", () => {
    assert.throws(() => new ReplyParser().push("hello there\r\n"), (e: unknown) => isSmtpError(e) && e.phase === "protocol");
    assert.throws(() => new ReplyParser().push("250-a\r\n251 b\r\n"), /Inconsistent/);
    assert.throws(() => new ReplyParser(16).push("250 this line never ends and keeps going"), /overlong/);
  });

  it("parses EHLO capabilities, including the legacy AUTH= form", () => {
    const { replies } = parseReplies(
      "250-mail.example.com Hello\r\n250-SIZE 35882577\r\n250-8BITMIME\r\n250-AUTH LOGIN PLAIN xoauth2\r\n250-AUTH=LOGIN PLAIN\r\n250-STARTTLS\r\n250 SMTPUTF8\r\n",
    );
    const caps = parseEhloCapabilities(replies[0]!);
    assert.deepEqual(caps.get("AUTH"), ["LOGIN", "PLAIN", "XOAUTH2"]);
    assert.deepEqual(caps.get("SIZE"), ["35882577"]);
    assert.deepEqual(caps.get("STARTTLS"), []);
    assert.equal(caps.has("SMTPUTF8"), true);
    assert.equal(caps.has("MAIL.EXAMPLE.COM"), false);
  });
});

describe("DATA transparency", () => {
  it("doubles leading dots and normalises line endings", () => {
    assert.equal(dotStuff(".hidden\n..two\nplain. dot\r\n.\rend"), "..hidden\r\n...two\r\nplain. dot\r\n..\r\nend\r\n");
    assert.equal(dotStuff("ends with crlf\r\n"), "ends with crlf\r\n");
    assert.equal(dotStuff(""), "\r\n");
  });

  it("is reversed by the receiving side", () => {
    for (const text of [".a\r\n.\r\n..b\r\nc.\r\n", "no dots\r\n", "\r\n.\r\n"]) assert.equal(dotUnstuff(dotStuff(text)), text);
  });
});

describe("helpers", () => {
  it("recognises loopback hosts", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "127.8.9.10", "::1", "[::1]", "mail.localhost"]) assert.equal(isLoopbackHost(h), true, h);
    for (const h of ["example.com", "10.0.0.1", "localhost.example.com", "128.0.0.1"]) assert.equal(isLoopbackHost(h), false, h);
  });

  it("builds EHLO names", () => {
    assert.equal(ehloName("Mail.Example.COM"), "mail.example.com");
    assert.equal(ehloName("192.0.2.1"), "[192.0.2.1]");
    assert.equal(ehloName("2001:db8::1"), "[IPv6:2001:db8::1]");
    assert.equal(ehloName("bad host!"), "localhost");
    assert.equal(ehloName(undefined), "localhost");
  });

  it("classifies errors", () => {
    const permanent = new SmtpError("no", { phase: "rcpt", transient: false, scope: "message", code: 550 });
    assert.equal(permanent.permanent, true);
    assert.equal(permanent.name, "SmtpError");
    assert.equal(isSmtpError(permanent), true);
    assert.equal(isSmtpError(new Error("x")), false);
  });
});

describe("SMTP client against a fake server", () => {
  const servers: FakeSmtpServer[] = [];
  after(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  async function server(options: Parameters<typeof startFakeSmtpServer>[0] = {}) {
    const s = await startFakeSmtpServer(options);
    servers.push(s);
    return s;
  }

  const client = (s: FakeSmtpServer, extra: Partial<SmtpClientOptions> = {}): SmtpClientOptions => ({
    host: s.host,
    port: s.port,
    secure: false,
    auth: { user: "mailer", pass: "s3cret-pass" },
    clientName: "lms.test",
    commandTimeoutMs: 5_000,
    greetingTimeoutMs: 5_000,
    ...extra,
  });

  const message = () =>
    buildMimeMessage({
      from: { address: "no-reply@lms.test", name: "LearnLoop" },
      to: [{ address: "ada@example.com" }],
      subject: "Welcome ✓",
      text: "Hello Ada,\n.\n.leading dot line\nBye",
      html: "<p>Hello Ada</p>",
      messageId: "<test.1@lms.test>",
      date: new Date(Date.UTC(2026, 0, 1)),
    }).raw;

  it("authenticates, sends with per-recipient results and delivers the exact message", async () => {
    const s = await server();
    const log: string[] = [];
    const raw = message();
    const result = await sendMailOnce(client(s, { logger: (dir, line) => log.push(`${dir} ${line}`) }), { from: "no-reply@lms.test", to: ["ada@example.com", "reject@example.com", "ada@example.com"] }, raw);
    assert.deepEqual(result.accepted, ["ada@example.com"]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]!.code, 550);
    assert.equal(result.rejected[0]!.enhancedCode, "5.1.1");
    assert.equal(result.code, 250);
    assert.match(result.response, /queued as ABC123/);

    const received = s.messages[0]!;
    assert.equal(received.from, "no-reply@lms.test");
    assert.deepEqual(received.to, ["ada@example.com"]);
    assert.equal(received.data, raw.endsWith("\r\n") ? raw : `${raw}\r\n`);
    assert.ok(received.mailParams.includes(`SIZE=${Buffer.byteLength(dotStuff(raw))}`));
    assert.ok(s.commands.includes("EHLO lms.test"));
    assert.equal(s.commands.at(-1), "QUIT");

    const transcript = log.join("\n");
    assert.ok(transcript.includes("C AUTH PLAIN ********"));
    assert.ok(!transcript.includes("s3cret-pass"));
    assert.ok(!transcript.includes(Buffer.from("\u0000mailer\u0000s3cret-pass").toString("base64")));
  });

  it("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    const s = await server({ capabilities: ["AUTH LOGIN", "SIZE 1000000"] });
    const info = await verifySmtp(client(s));
    assert.equal(info.authMechanism, "LOGIN");
    assert.equal(info.secure, false);
    assert.equal(info.maxMessageSize, 1000000);
    assert.ok(info.capabilities.includes("AUTH LOGIN"));
    assert.match(info.greeting, /fake\.test/);
  });

  it("reports wrong credentials as a permanent authentication error", async () => {
    const s = await server();
    await assert.rejects(SmtpConnection.connect(client(s, { auth: { user: "mailer", pass: "wrong" } })), (e: unknown) => {
      assert.ok(isSmtpError(e));
      assert.equal(e.phase, "auth");
      assert.equal(e.code, 535);
      assert.equal(e.transient, false);
      assert.match(e.message, /Check SMTP_USER and SMTP_PASS/);
      return true;
    });
  });

  it("reuses one session for several messages", async () => {
    const s = await server();
    const conn = await SmtpConnection.connect(client(s));
    await conn.sendMail({ from: "no-reply@lms.test", to: ["a@example.com"] }, message());
    await conn.sendMail({ from: "no-reply@lms.test", to: ["b@example.com"] }, message());
    await conn.quit();
    assert.equal(s.messages.length, 2);
    assert.equal(s.commands.filter((c) => c.startsWith("EHLO")).length, 1);
    assert.equal(conn.isOpen, false);
  });

  it("fails the message when every recipient is refused (transient if any 4xx)", async () => {
    const s = await server();
    const conn = await SmtpConnection.connect(client(s));
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: ["reject@example.com"] }, message()), (e: unknown) => {
      assert.ok(isSmtpError(e));
      assert.equal(e.phase, "rcpt");
      assert.equal(e.scope, "message");
      assert.equal(e.transient, false);
      return true;
    });
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: ["reject@example.com", "busy@example.com"] }, message()), (e: unknown) => isSmtpError(e) && e.transient);
    // The session survives (RSET) and can still deliver.
    const ok = await conn.sendMail({ from: "no-reply@lms.test", to: ["c@example.com"] }, message());
    assert.deepEqual(ok.accepted, ["c@example.com"]);
    await conn.quit();
  });

  it("treats 421 at RCPT as a connection problem", async () => {
    const s = await server({ rcptReply: () => "421 4.3.2 Service shutting down" });
    await assert.rejects(sendMailOnce(client(s), { from: "no-reply@lms.test", to: ["a@example.com"] }, message()), (e: unknown) => isSmtpError(e) && e.code === 421 && e.transient);
  });

  it("validates the envelope before talking to the server", async () => {
    const s = await server({ capabilities: ["SIZE 100", "AUTH PLAIN"] });
    const conn = await SmtpConnection.connect(client(s));
    await assert.rejects(conn.sendMail({ from: "bad address", to: ["a@example.com"] }, "x"), /Invalid sender/);
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: ["a@example.com>\r\nRCPT TO:<b@example.com"] }, "x"), /Invalid recipient/);
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: [" "] }, "x"), /no recipients/);
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: ["a@example.com"] }, "x".repeat(500)), (e: unknown) => isSmtpError(e) && e.code === 552);
    await assert.rejects(conn.sendMail({ from: "no-reply@lms.test", to: ["jörg@exämple.com"] }, "x"), /SMTPUTF8/);
    await conn.quit();
    assert.ok(!s.commands.some((c) => c.startsWith("MAIL FROM")));
  });

  it("refuses to authenticate in clear text when TLS is required but not offered", async () => {
    const s = await server();
    await assert.rejects(SmtpConnection.connect(client(s, { requireTls: true })), /does not offer STARTTLS/);
    assert.ok(!s.commands.some((c) => c.startsWith("AUTH")));
  });

  it("rejects data pipelined after the STARTTLS reply (command injection)", async () => {
    const s = await server({ capabilities: ["STARTTLS", "AUTH PLAIN"], startTlsReply: "220 2.0.0 Ready to start TLS\r\n250 injected" });
    await assert.rejects(SmtpConnection.connect(client(s)), /Unexpected data received before the TLS handshake/);
  });

  it("falls back to HELO for servers without EHLO", async () => {
    const s = await server({ rejectEhlo: true });
    const conn = await SmtpConnection.connect(client(s, { auth: undefined }));
    assert.equal(conn.capabilities.size, 0);
    await conn.sendMail({ from: "no-reply@lms.test", to: ["a@example.com"] }, message());
    await conn.quit();
    assert.ok(s.commands.includes("HELO lms.test"));
    assert.equal(s.messages.length, 1);
  });

  it("reports connection failures and timeouts as transient", async () => {
    const port = await closedPort();
    await assert.rejects(SmtpConnection.connect({ host: "127.0.0.1", port, secure: false, connectionTimeoutMs: 2_000 }), (e: unknown) => isSmtpError(e) && e.phase === "connect" && e.transient);
    const silent = await server({ greeting: null });
    await assert.rejects(SmtpConnection.connect(client(silent, { greetingTimeoutMs: 150 })), (e: unknown) => isSmtpError(e) && e.phase === "greeting" && /Timed out/.test(e.message));
    await assert.rejects(SmtpConnection.connect({ host: "", port: 25, secure: false }), /No SMTP host/);
    await assert.rejects(SmtpConnection.connect({ host: "127.0.0.1", port: 70000, secure: false }), /Invalid SMTP port/);
  });
});

/**
 * A scriptable fake SMTP server on 127.0.0.1 for exercising the hand-written
 * client in `src/lib/email/smtp.ts` end to end (plain TCP; loopback hosts
 * are allowed to authenticate without TLS).
 *
 * Default behaviour: greets, answers EHLO with the configured capabilities,
 * accepts AUTH PLAIN / AUTH LOGIN for `user` / `pass`, rejects recipients
 * containing "reject" (550 5.1.1) and "busy" (451 4.3.0), takes DATA, RSET
 * and QUIT. Every received message is recorded (dot-unstuffed).
 */
import net from "node:net";
import type { AddressInfo } from "node:net";

export interface ReceivedMessage {
  from: string;
  mailParams: string[];
  to: string[];
  /** Message content as received after DATA, dot-unstuffed, CRLF line endings. */
  data: string;
}

export interface FakeSmtpOptions {
  greeting?: string | null;
  capabilities?: string[];
  user?: string;
  pass?: string;
  /** Reply to EHLO with 502 so the client has to fall back to HELO. */
  rejectEhlo?: boolean;
  /** Raw text sent in reply to STARTTLS (the server never really upgrades). */
  startTlsReply?: string;
  /** Override the reply to RCPT TO for an address. */
  rcptReply?: (address: string) => string | null;
}

export interface FakeSmtpServer {
  port: number;
  host: string;
  messages: ReceivedMessage[];
  /** Every command line received, in order. */
  commands: string[];
  close(): Promise<void>;
}

const DEFAULT_CAPS = ["SIZE 1048576", "8BITMIME", "AUTH PLAIN LOGIN", "SMTPUTF8", "ENHANCEDSTATUSCODES"];

export async function startFakeSmtpServer(options: FakeSmtpOptions = {}): Promise<FakeSmtpServer> {
  const user = options.user ?? "mailer";
  const pass = options.pass ?? "s3cret-pass";
  const messages: ReceivedMessage[] = [];
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setEncoding("utf8");
    const send = (text: string) => {
      if (!socket.destroyed) socket.write(text.endsWith("\r\n") ? text : `${text}\r\n`);
    };

    let buffer = "";
    let mode: "command" | "data" | "auth-login-user" | "auth-login-pass" | "auth-plain" = "command";
    let loginUser = "";
    let current: ReceivedMessage | null = null;
    let dataLines: string[] = [];

    const checkPlain = (token: string) => {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      send(decoded === `\u0000${user}\u0000${pass}` ? "235 2.7.0 Authentication successful" : "535 5.7.8 Authentication credentials invalid");
    };

    const handle = (line: string) => {
      if (mode === "data") {
        if (line === ".") {
          current!.data = dataLines.map((l) => (l.startsWith(".") ? l.slice(1) : l)).join("\r\n") + "\r\n";
          messages.push(current!);
          current = null;
          dataLines = [];
          mode = "command";
          send("250 2.0.0 Ok: queued as ABC123");
        } else {
          dataLines.push(line);
        }
        return;
      }
      commands.push(line);
      if (mode === "auth-plain") {
        mode = "command";
        checkPlain(line);
        return;
      }
      if (mode === "auth-login-user") {
        loginUser = Buffer.from(line, "base64").toString("utf8");
        mode = "auth-login-pass";
        send(`334 ${Buffer.from("Password:").toString("base64")}`);
        return;
      }
      if (mode === "auth-login-pass") {
        mode = "command";
        const password = Buffer.from(line, "base64").toString("utf8");
        send(loginUser === user && password === pass ? "235 2.7.0 Authentication successful" : "535 5.7.8 Authentication credentials invalid");
        return;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO ")) {
        if (options.rejectEhlo) return send("502 5.5.2 Command not recognized");
        const caps = options.capabilities ?? DEFAULT_CAPS;
        const lines = ["fake.test greets you", ...caps];
        return send(lines.map((l, i) => `250${i === lines.length - 1 ? " " : "-"}${l}`).join("\r\n"));
      }
      if (upper.startsWith("HELO ")) return send("250 fake.test");
      if (upper === "STARTTLS") return send(options.startTlsReply ?? "454 4.7.0 TLS not available");
      if (upper.startsWith("AUTH PLAIN")) {
        const token = line.slice("AUTH PLAIN".length).trim();
        if (!token) {
          mode = "auth-plain";
          return send("334 ");
        }
        return checkPlain(token);
      }
      if (upper === "AUTH LOGIN") {
        mode = "auth-login-user";
        return send(`334 ${Buffer.from("Username:").toString("base64")}`);
      }
      if (upper.startsWith("MAIL FROM:")) {
        const m = /^MAIL FROM:<([^>]*)>(.*)$/i.exec(line);
        current = { from: m?.[1] ?? "", mailParams: (m?.[2] ?? "").trim().split(/\s+/).filter(Boolean), to: [], data: "" };
        return send("250 2.1.0 Ok");
      }
      if (upper.startsWith("RCPT TO:")) {
        const address = /^RCPT TO:<([^>]*)>/i.exec(line)?.[1] ?? "";
        const custom = options.rcptReply?.(address);
        if (custom) return send(custom);
        if (address.includes("reject")) return send("550 5.1.1 <" + address + ">: Recipient address rejected: User unknown");
        if (address.includes("busy")) return send("451 4.3.0 Mailbox busy, try again later");
        current?.to.push(address);
        return send("250 2.1.5 Ok");
      }
      if (upper === "DATA") {
        mode = "data";
        return send("354 End data with <CR><LF>.<CR><LF>");
      }
      if (upper === "RSET") {
        current = null;
        return send("250 2.0.0 Ok");
      }
      if (upper === "NOOP") return send("250 2.0.0 Ok");
      if (upper === "QUIT") {
        send("221 2.0.0 Bye");
        socket.end();
        return;
      }
      send("500 5.5.2 Unknown command");
    };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handle(line);
      }
    });

    if (options.greeting !== null) send(options.greeting ?? "220 fake.test ESMTP ready");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    host: "127.0.0.1",
    messages,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port on 127.0.0.1 that nothing listens on (bound, then released). */
export async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  message_id: string;
}
export interface MailResult {
  accepted: boolean;
  provider_message_id: string;
}
export interface MailAdapter {
  send(msg: MailMessage): Promise<MailResult>;
}

export class MailError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${redact(detail)}` : code);
    this.name = "MailError";
  }
}

/** Strip URLs (may carry tokens), token= params and long base64url blobs from text. */
export function redact(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/token=[^\s&"']+/gi, "token=[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "mailpit", "::1"]);
export function isLocalCapture(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap76 = (s: string) => (s.match(/.{1,76}/g) ?? [""]).join("\r\n");

/** RFC 2047 UTF-8 base64 encoded-word(s); each word <= 75 chars, split on char boundaries. */
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let cur = "";
  for (const ch of Array.from(value)) {
    if (Buffer.byteLength(cur + ch, "utf8") > 42) {
      words.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join("\r\n ");
}

function assertNoCrlf(v: string, field: string) {
  if (/[\r\n]/.test(v)) throw new MailError("mail_header_injection", field);
}

export function buildMimeMessage(
  msg: MailMessage,
  from: string,
  now: Date = new Date(),
  boundary = `liwan_${randomUUID().replace(/-/g, "")}`,
): string {
  assertNoCrlf(msg.to, "to");
  assertNoCrlf(from, "from");
  assertNoCrlf(msg.subject, "subject");
  assertNoCrlf(msg.message_id, "message_id");
  const mid = msg.message_id.replace(/^<|>$/g, "");
  const headers = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${mid}>`,
    `MIME-Version: 1.0`,
  ];
  const textPart = (type: string, body: string) =>
    `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}\r\n`;
  let body: string;
  if (msg.html !== undefined) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body =
      `--${boundary}\r\n${textPart("text/plain", msg.text)}` +
      `--${boundary}\r\n${textPart("text/html", msg.html)}` +
      `--${boundary}--\r\n`;
  } else {
    headers.push(`Content-Type: text/plain; charset=UTF-8`, `Content-Transfer-Encoding: base64`);
    body = `${wrap76(b64(msg.text))}\r\n`;
  }
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** Dot-stuff and terminate for the SMTP DATA phase. */
export function dotStuff(data: string): string {
  const normalized = data.replace(/\r?\n/g, "\r\n");
  const stuffed = normalized.replace(/(^|\r\n)\./g, "$1..");
  return stuffed.endsWith("\r\n") ? `${stuffed}.\r\n` : `${stuffed}\r\n.\r\n`;
}

function bareAddress(a: string): string {
  const m = /<([^>]+)>/.exec(a);
  return (m ? m[1] : a).trim();
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  requireTls: boolean;
  timeoutMs?: number;
}

interface Reply {
  code: number;
  lines: string[];
}

export class SmtpMailAdapter implements MailAdapter {
  constructor(private readonly cfg: SmtpConfig) {}

  async send(msg: MailMessage): Promise<MailResult> {
    const mime = buildMimeMessage(msg, this.cfg.from);
    const timeout = this.cfg.timeoutMs ?? 15000;
    let socket: net.Socket = net.connect({ host: this.cfg.host, port: this.cfg.port });
    let buf = "";
    let pending: ((e?: Error) => void) | null = null;
    let failure: Error | null = null;
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      pending?.();
    };
    const attach = (s: net.Socket) => {
      s.on("data", onData);
      s.on("error", (e) => {
        failure = new MailError("mail_connection_error", e.message);
        pending?.();
      });
      s.on("close", () => {
        failure ??= new MailError("mail_connection_closed");
        pending?.();
      });
    };
    attach(socket);

    const readReply = (): Promise<Reply> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          reject(new MailError("mail_timeout"));
        }, timeout);
        const check = () => {
          const lines = buf.split("\r\n");
          // complete reply: a line "ddd " (space) followed by terminator
          for (let i = 0; i < lines.length - 1; i++) {
            if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
              const used = lines.slice(0, i + 1);
              buf = lines.slice(i + 1).join("\r\n");
              clearTimeout(timer);
              pending = null;
              resolve({ code: Number(used[i].slice(0, 3)), lines: used });
              return;
            }
          }
          if (failure) {
            clearTimeout(timer);
            pending = null;
            reject(failure);
          }
        };
        pending = check;
        check();
      });
    const write = (s: string) => socket.write(s);
    const cmd = async (line: string, ok: number[]): Promise<Reply> => {
      write(`${line}\r\n`);
      return expect(await readReply(), ok);
    };
    const expect = (r: Reply, ok: number[]): Reply => {
      if (!ok.includes(r.code)) throw new MailError("mail_smtp_rejected", `${r.code} ${r.lines[r.lines.length - 1]?.slice(4) ?? ""}`);
      return r;
    };
    const ehloName = "liwan.local";

    try {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new MailError("mail_timeout")), timeout);
        socket.once("connect", () => {
          clearTimeout(t);
          res();
        });
        socket.once("error", (e) => {
          clearTimeout(t);
          rej(new MailError("mail_connection_error", e.message));
        });
      });
      expect(await readReply(), [220]);
      let ehlo = await cmd(`EHLO ${ehloName}`, [250]);
      const caps = () => ehlo.lines.map((l) => l.slice(4).toUpperCase());
      if (caps().includes("STARTTLS")) {
        if (this.cfg.requireTls || !isLocalCapture(this.cfg.host)) {
          await cmd("STARTTLS", [220]);
          socket.removeAllListeners("data");
          const plain = socket;
          const secure = tls.connect({ socket: plain, servername: net.isIP(this.cfg.host) ? undefined : this.cfg.host });
          await new Promise<void>((res, rej) => {
            secure.once("secureConnect", () => res());
            secure.once("error", (e) => rej(new MailError("mail_tls_error", e.message)));
          });
          socket = secure;
          buf = "";
          attach(socket);
          ehlo = await cmd(`EHLO ${ehloName}`, [250]);
        }
      } else if (this.cfg.requireTls) {
        throw new MailError("mail_tls_unavailable");
      }
      if (this.cfg.user && this.cfg.password !== undefined) {
        const mech = caps().find((c) => c.startsWith("AUTH "))?.slice(5).split(" ") ?? [];
        if (mech.includes("PLAIN")) {
          await cmd(`AUTH PLAIN ${b64(`\0${this.cfg.user}\0${this.cfg.password}`)}`, [235]);
        } else if (mech.includes("LOGIN")) {
          await cmd("AUTH LOGIN", [334]);
          await cmd(b64(this.cfg.user), [334]);
          await cmd(b64(this.cfg.password), [235]);
        } else {
          throw new MailError("mail_auth_unsupported");
        }
      }
      await cmd(`MAIL FROM:<${bareAddress(this.cfg.from)}>`, [250]);
      await cmd(`RCPT TO:<${bareAddress(msg.to)}>`, [250, 251]);
      await cmd("DATA", [354]);
      write(dotStuff(mime));
      const done = expect(await readReply(), [250]);
      try {
        await cmd("QUIT", [221]);
      } catch {
        /* ignore QUIT failures after acceptance */
      }
      const queued = /(?:queued as|id)\s+(\S+)/i.exec(done.lines[done.lines.length - 1] ?? "");
      return { accepted: true, provider_message_id: queued?.[1] ?? msg.message_id };
    } catch (e) {
      if (e instanceof MailError) throw e;
      throw new MailError("mail_send_failed", e instanceof Error ? e.message : String(e));
    } finally {
      socket.destroy();
    }
  }
}

class DisabledMailAdapter implements MailAdapter {
  async send(): Promise<MailResult> {
    throw new MailError("mail_disabled");
  }
}

export function mailAdapterFromEnv(env: Record<string, string | undefined>): MailAdapter {
  const mode = env.LIWAN_MAIL_MODE ?? "smtp";
  if (mode === "disabled") return new DisabledMailAdapter();
  if (mode !== "smtp") throw new MailError("mail_not_configured", "unknown LIWAN_MAIL_MODE");
  const host = env.LIWAN_MAIL_SMTP_HOST;
  const portRaw = env.LIWAN_MAIL_SMTP_PORT;
  const from = env.LIWAN_MAIL_FROM;
  if (!host || !portRaw || !from) throw new MailError("mail_not_configured");
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new MailError("mail_not_configured", "invalid port");
  const tlsRaw = env.LIWAN_MAIL_REQUIRE_TLS;
  const requireTls = tlsRaw === undefined || tlsRaw === "" ? !isLocalCapture(host) : !/^(0|false|no)$/i.test(tlsRaw);
  const user = env.LIWAN_MAIL_SMTP_USER || undefined;
  const password = env.LIWAN_MAIL_SMTP_PASSWORD || undefined;
  if ((user && !password) || (!user && password)) throw new MailError("mail_not_configured", "incomplete credentials");
  return new SmtpMailAdapter({ host, port, user, password, from, requireTls });
}

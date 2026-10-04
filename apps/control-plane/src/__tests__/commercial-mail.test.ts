import { describe, expect, it } from "vitest";
import {
  MailError,
  SmtpMailAdapter,
  buildMimeMessage,
  dotStuff,
  encodeHeaderWord,
  isLocalCapture,
  mailAdapterFromEnv,
  redact,
} from "../commercial/mail-adapter.js";
import {
  buildInvitationUrl,
  createInvitationToken,
  hashToken,
  invitationExpiry,
  isInvitationExpired,
  renderInvitationEmail,
  verifyToken,
} from "../commercial/invitation-tokens.js";

describe("mime", () => {
  it("encodes Arabic subject as RFC 2047 base64 and builds multipart", () => {
    const subj = "دعوة للانضمام إلى شركة الاختبار الطويلة جدا لتتجاوز حد الكلمة المشفرة";
    const enc = encodeHeaderWord(subj);
    const words = enc.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded = words.map((w) => Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(w)![1], "base64").toString("utf8")).join("");
    expect(decoded).toBe(subj);
    expect(encodeHeaderWord("Plain")).toBe("Plain");
    const m = buildMimeMessage(
      { to: "a@x.test", subject: "دعوة", text: "نص", html: "<p>x</p>", message_id: "id1@nasq" },
      "Nasq <no-reply@nasq.test>",
      new Date("2026-01-02T03:04:05Z"),
      "B",
    );
    expect(m).toContain("Message-ID: <id1@nasq>\r\n");
    expect(m).toContain("MIME-Version: 1.0\r\n");
    expect(m).toContain('multipart/alternative; boundary="B"');
    expect(m).toContain("Date: Fri, 02 Jan 2026 03:04:05 +0000");
    expect(m).not.toMatch(/[^\r]\n/);
    expect(m.endsWith("--B--\r\n")).toBe(true);
  });
  it("rejects header injection", () => {
    expect(() => buildMimeMessage({ to: "a@x\r\nBcc: z", subject: "s", text: "t", message_id: "i" }, "f@x")).toThrow(MailError);
  });
  it("dot-stuffs and terminates", () => {
    expect(dotStuff("a\r\n.b\r\n..c\r\n")).toBe("a\r\n..b\r\n...c\r\n.\r\n");
    expect(dotStuff(".x")).toBe("..x\r\n.\r\n");
  });
  it("redacts urls and tokens", () => {
    expect(redact("fail https://a.test/invite/accept?token=abc123 now")).not.toContain("abc123");
    expect(new MailError("x", "token=SECRET1").message).not.toContain("SECRET1");
  });
});

describe("tokens", () => {
  it("hashes and verifies", () => {
    const { token, token_hash } = createInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token_hash).toBe(hashToken(token));
    expect(token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyToken(token, token_hash)).toBe(true);
    expect(verifyToken(token + "x", token_hash)).toBe(false);
    expect(verifyToken(token, "short")).toBe(false);
    expect(createInvitationToken().token).not.toBe(token);
  });
  it("url allowlist", () => {
    expect(buildInvitationUrl("https://app.nasq.sa", "t k")).toBe("https://app.nasq.sa/invite/accept?token=t%20k");
    expect(buildInvitationUrl("http://localhost:3000", "t")).toContain("localhost:3000/invite/accept");
    expect(buildInvitationUrl("http://acme.test", "t")).toContain("acme.test");
    expect(() => buildInvitationUrl("http://evil.com", "t")).toThrow();
    expect(() => buildInvitationUrl("javascript:alert(1)", "t")).toThrow();
    expect(() => buildInvitationUrl("not a url", "t")).toThrow();
  });
  it("expiry", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const e = invitationExpiry(3600, now);
    expect(e.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(isInvitationExpired(e, now)).toBe(false);
    expect(isInvitationExpired(e, e)).toBe(true);
    expect(() => invitationExpiry(0)).toThrow();
  });
  it("template is bilingual and escapes", () => {
    const t = renderInvitationEmail({ companyName: `<b>"Acme"</b>`, url: "https://a.test/x?a=1&b=2" });
    expect(t.html).not.toContain("<b>");
    expect(t.html).toContain("&lt;b&gt;");
    expect(t.html).toContain("a=1&amp;b=2");
    expect(t.text.indexOf("دعوتك")).toBeLessThan(t.text.indexOf("invited"));
    expect(t.subject).toContain("Invitation");
  });
});

describe("env factory", () => {
  it("fails closed when unconfigured", () => {
    expect(() => mailAdapterFromEnv({})).toThrow(/mail_not_configured/);
    expect(() => mailAdapterFromEnv({ NASQ_MAIL_SMTP_HOST: "h" })).toThrow(/mail_not_configured/);
    expect(() => mailAdapterFromEnv({ NASQ_MAIL_SMTP_HOST: "h", NASQ_MAIL_SMTP_PORT: "25", NASQ_MAIL_FROM: "f@x", NASQ_MAIL_SMTP_USER: "u" })).toThrow(/mail_not_configured/);
  });
  it("builds adapters", () => {
    const a = mailAdapterFromEnv({ NASQ_MAIL_SMTP_HOST: "127.0.0.1", NASQ_MAIL_SMTP_PORT: "55425", NASQ_MAIL_FROM: "n@x.test" });
    expect(a).toBeInstanceOf(SmtpMailAdapter);
    expect((a as any).cfg.requireTls).toBe(false);
    const b = mailAdapterFromEnv({ NASQ_MAIL_SMTP_HOST: "smtp.example.com", NASQ_MAIL_SMTP_PORT: "587", NASQ_MAIL_FROM: "n@x.test" });
    expect((b as any).cfg.requireTls).toBe(true);
    const c = mailAdapterFromEnv({ NASQ_MAIL_MODE: "disabled" });
    return expect(c.send({ to: "a@b", subject: "s", text: "t", message_id: "m" })).rejects.toThrow(/mail_disabled/);
  });
  it("isLocalCapture", () => {
    expect(isLocalCapture("mailpit")).toBe(true);
    expect(isLocalCapture("localhost")).toBe(true);
    expect(isLocalCapture("smtp.example.com")).toBe(false);
  });
});

const SMTP = process.env.NASQ_MAILPIT_SMTP_PORT;
const API = process.env.NASQ_MAILPIT_API_PORT;
describe.skipIf(!SMTP || !API)("mailpit integration (local capture, not external delivery)", () => {
  it("delivers Arabic invitation", async () => {
    const adapter = mailAdapterFromEnv({
      NASQ_MAIL_SMTP_HOST: "127.0.0.1",
      NASQ_MAIL_SMTP_PORT: SMTP,
      NASQ_MAIL_FROM: "نسق <no-reply@nasq.test>".replace("نسق", "Nasq"),
    });
    const { token } = createInvitationToken();
    const url = buildInvitationUrl("http://admin.nasq.test", token);
    const tpl = renderInvitationEmail({ companyName: "شركة الاختبار", url });
    const to = `admin-${Date.now()}@acme.test`;
    const res = await adapter.send({ to, ...tpl, message_id: `inv-${Date.now()}@nasq.test` });
    expect(res.accepted).toBe(true);
    const base = `http://127.0.0.1:${API}/api/v1`;
    const list = (await (await fetch(`${base}/messages`)).json()) as any;
    const hit = list.messages.find((m: any) => m.To.some((t: any) => t.Address === to));
    expect(hit).toBeTruthy();
    const full = (await (await fetch(`${base}/message/${hit.ID}`)).json()) as any;
    expect(full.Subject).toBe(tpl.subject);
    expect(full.Subject).toContain("شركة الاختبار");
    expect(full.To[0].Address).toBe(to);
    expect(full.Text).toContain(url);
    expect(full.HTML).toContain(url.replace(/&/g, "&amp;"));
  });
});

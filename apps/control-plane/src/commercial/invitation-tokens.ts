import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens. Only sha256(token) (hex) is persisted (column token_hash).
 * Single use: the DB layer must consume atomically, e.g.
 *   UPDATE invitations SET consumed_at = now()
 *   WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING ...
 * Zero rows => invalid/used/expired. The raw token is never stored or logged.
 */
export function createInvitationToken(): { token: string; token_hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, token_hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyToken(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "utf8");
  const b = Buffer.from(String(storedHash), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Caller supplies ttl seconds; no hidden default. */
export function invitationExpiry(ttlSeconds: number, now: Date = new Date()): Date {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("invitation_ttl_invalid");
  }
  return new Date(now.getTime() + ttlSeconds * 1000);
}

export function isInvitationExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export function isAllowedInvitationOrigin(origin: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hostname.includes("*")) return false;
  const host = u.hostname;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") {
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".test") || host.endsWith(".localhost");
  }
  return false;
}

export function buildInvitationUrl(origin: string, token: string): string {
  if (!isAllowedInvitationOrigin(origin)) throw new Error("invitation_origin_not_allowed");
  const u = new URL(origin);
  return `${u.origin}/invite/accept?token=${encodeURIComponent(token)}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderInvitationEmail(input: { companyName: string; url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { companyName, url } = input;
  const subject = `دعوة للانضمام إلى ${companyName} على ليوان | Invitation to join ${companyName} on LiwanOS`;
  const text = [
    `تمت دعوتك لإدارة ${companyName} على ليوان.`,
    `افتح الرابط التالي لقبول الدعوة:`,
    url,
    "",
    "---",
    `You have been invited to administer ${companyName} on LiwanOS.`,
    `Open this link to accept the invitation:`,
    url,
    "",
  ].join("\r\n");
  const c = escapeHtml(companyName);
  const u = escapeHtml(url);
  const html =
    `<div dir="rtl" lang="ar"><p>تمت دعوتك لإدارة <strong>${c}</strong> على ليوان.</p>` +
    `<p><a href="${u}">قبول الدعوة</a></p></div><hr>` +
    `<div dir="ltr" lang="en"><p>You have been invited to administer <strong>${c}</strong> on LiwanOS.</p>` +
    `<p><a href="${u}">Accept the invitation</a></p></div>`;
  return { subject, text, html };
}

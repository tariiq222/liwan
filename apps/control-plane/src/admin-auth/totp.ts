import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { base32 } from './crypto.js'

export const newTotpSecret = (): Buffer => randomBytes(20)
export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / 30)
export function totpAt(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return String(code).padStart(digits, '0')
}
export function checkTotp(secret: Buffer, code: string, nowMs: number, lastStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const now = totpStep(nowMs)
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step
  }
  return null
}
export const totpUri = (secret: Buffer, email: string): string =>
  `otpauth://totp/${encodeURIComponent(`LiwanOS:${email}`)}?secret=${base32(secret).toUpperCase()}&issuer=LiwanOS&algorithm=SHA1&digits=6&period=30`

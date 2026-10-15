import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const newToken = (): string => randomBytes(32).toString('base64url')
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
const boxKey = (key: Buffer) => createHash('sha256').update(key).digest()
export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(key), iv, { authTagLength: 16 })
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}
export function open(key: Buffer, box: Buffer): Buffer {
  if (box.length < 28) throw new Error('sealed box too short')
  const decipher = createDecipheriv('aes-256-gcm', boxKey(key), box.subarray(0, 12), { authTagLength: 16 })
  decipher.setAuthTag(box.subarray(12, 28))
  return Buffer.concat([decipher.update(box.subarray(28)), decipher.final()])
}
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
export function base32(bytes: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function newRecoveryCodes(): string[] {
  const codes = new Set<string>()
  while (codes.size < 10) { const raw = base32(randomBytes(8)).slice(0, 12); codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`) }
  return [...codes]
}

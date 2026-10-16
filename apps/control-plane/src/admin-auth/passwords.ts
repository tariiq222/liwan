import { hash, verify, Algorithm } from '@node-rs/argon2'

export const passwordAcceptable = (p: string): boolean => typeof p === 'string' && p.length >= 12 && p.length <= 256
export const hashPassword = (p: string): Promise<string> => hash(p, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
export async function verifyPassword(stored: string, p: string): Promise<boolean> {
  try { return await verify(stored, p) } catch { return false }
}

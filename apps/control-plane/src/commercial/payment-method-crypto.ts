import { createHmac } from 'node:crypto'
import { open, seal } from '../admin-auth/crypto.js'

export type PaymentMethodKey = { id: string; secret: Buffer }
type MethodIdentity = { id: string; subscription_id: string; provider: string }
type SealedMethod = MethodIdentity & { key_id: string; token_ciphertext: Buffer }

export function paymentMethodKeyFromEnv(env: Record<string, string | undefined>): PaymentMethodKey | null {
  const id = env.LIWAN_PAYMENT_METHOD_KEY_ID
  const encoded = env.LIWAN_PAYMENT_METHOD_KEY
  if (!id || !/^[A-Za-z0-9._-]{1,64}$/.test(id) || !encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null
  const secret = Buffer.from(encoded, 'base64url')
  return secret.length === 32 && secret.toString('base64url') === encoded ? { id, secret } : null
}

const aad = (method: MethodIdentity) => Buffer.from(`stored-payment|subscription:${method.subscription_id}|provider:${method.provider}|method:${method.id}`)
export const sealMethodToken = (key: PaymentMethodKey, method: MethodIdentity, token: string) => seal(key.secret, Buffer.from(token), aad(method))

export function openMethodToken(key: PaymentMethodKey, method: SealedMethod) {
  if (key.id !== method.key_id) throw new Error('stored_payment_key_unavailable')
  try { return open(key.secret, method.token_ciphertext, aad(method)).toString('utf8') }
  catch { throw new Error('stored_payment_ciphertext_invalid') }
}

export const simulatorMethodSigningKey = (key: PaymentMethodKey) =>
  createHmac('sha256', key.secret).update('liwan|simulator-stored-method|v1').digest()

import { signServiceRequest } from '@nasq/commercial-contracts/server'

export function signVendorForward(input: { method: string; path: string; rawBody?: string; actor: number; issuer: string; key: string }) {
  return signServiceRequest({ method: input.method, path: input.path, body: input.rawBody, actor: input.actor, issuer: input.issuer, key: input.key })
}

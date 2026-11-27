import { z } from 'zod'
import { TelephonyExtensionNumberSchema } from './extension'

export const TelephonyIceServerSchema = z.strictObject({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().min(1).optional(),
  credential: z.string().min(1).optional(),
})

export const TelephonySessionSchema = z.strictObject({
  wsUrl: z.string().regex(/^wss?:\/\/.+/, 'a ws:// or wss:// URL'),
  extension: TelephonyExtensionNumberSchema,
  authUsername: z.string().min(1).max(64),
  password: z.string().min(1),
  iceServers: z.array(TelephonyIceServerSchema),
  expiresInSeconds: z.number().int().min(1).max(120),
})

export const TelephonySessionRevokeSchema = z.strictObject({
  revoked: z.boolean(),
})

export type TelephonyIceServer = z.infer<typeof TelephonyIceServerSchema>
export type TelephonySession = z.infer<typeof TelephonySessionSchema>
export type TelephonySessionRevoke = z.infer<typeof TelephonySessionRevokeSchema>

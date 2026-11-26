import { z } from 'zod'
import {
  TelephonyCollectionSchema,
  TelephonyDateTimeSchema,
  TelephonyIdSchema,
  TelephonyNumberSchema,
  TelephonyRefSchema,
} from './shared'

export const TelephonyCallDirectionSchema = z.enum(['in', 'out', 'internal'])
export const TelephonyCallStateSchema = z.enum(['ringing', 'answered', 'missed', 'rejected', 'failed', 'ended'])
export const TelephonyRecordingStateSchema = z.enum(['none', 'pending', 'available', 'expired'])

/**
 * One call of the log. `linkedid` is Asterisk's key of the call, so the record is created and updated by it and never
 * matched by time. `durationSeconds` is computed from the times and stays null until the call ends. `remoteNumber` is
 * the other party in E.164, and null for an internal call whose other party is an extension.
 */
export const TelephonyCallSchema = z.strictObject({
  id: TelephonyIdSchema,
  linkedid: z.string().min(1),
  direction: TelephonyCallDirectionSchema,
  state: TelephonyCallStateSchema,
  remoteNumber: TelephonyNumberSchema.nullable(),
  partner: TelephonyRefSchema.nullable(),
  user: TelephonyRefSchema.nullable(),
  extension: TelephonyRefSchema.nullable(),
  queue: z.string().nullable(),
  startedAt: TelephonyDateTimeSchema,
  answeredAt: TelephonyDateTimeSchema.nullable(),
  endedAt: TelephonyDateTimeSchema.nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  recordingState: TelephonyRecordingStateSchema,
  companyId: TelephonyIdSchema,
})

export const TelephonyCallListSchema = TelephonyCollectionSchema(TelephonyCallSchema)

export type TelephonyCallDirection = z.infer<typeof TelephonyCallDirectionSchema>
export type TelephonyCallState = z.infer<typeof TelephonyCallStateSchema>
export type TelephonyRecordingState = z.infer<typeof TelephonyRecordingStateSchema>
export type TelephonyCall = z.infer<typeof TelephonyCallSchema>
export type TelephonyCallList = z.infer<typeof TelephonyCallListSchema>

/** The detail shape adds whether this user may listen; the list never carries it. */
export const TelephonyCallDetailSchema = TelephonyCallSchema.extend({
  canListen: z.boolean(),
})

export type TelephonyCallDetail = z.infer<typeof TelephonyCallDetailSchema>

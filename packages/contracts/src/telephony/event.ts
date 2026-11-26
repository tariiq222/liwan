import { z } from 'zod'

/**
 * The body `pbx-agent` posts to `POST /api/v1/telephony/events` (design 4.5).
 *
 * The agent builds one envelope for both the live stream and the reconciliation pass, so a recovered call and a live
 * one are described the same way. `event_id` is assigned when the event enters the agent's durable queue and never
 * changes on a retry: the route is idempotent on it. Numbers travel raw; E164 normalisation belongs to Odoo, which
 * owns the contact matching.
 */
export const TelephonyEventSourceSchema = z.enum(['ari', 'cel'])

export const TelephonyEventCallStateSchema = z.enum([
  'ringing',
  'answered',
  'ended',
  'missed',
  'rejected',
  'failed',
])

export const TelephonyEventCallSchema = z
  .strictObject({
    linkedid: z.string().min(1).max(64),
    uniqueid: z.string().min(1).max(64),
    channel: z.string().max(128).nullable(),
    direction: z.enum(['in', 'out', 'internal']),
    caller_number: z.string().max(32).nullable(),
    connected_number: z.string().max(32).nullable(),
    dialed_exten: z.string().max(32).nullable(),
    state: TelephonyEventCallStateSchema,
    started_at: z.string().datetime({ offset: false }).nullable(),
    answered_at: z.string().datetime({ offset: false }).nullable(),
    ended_at: z.string().datetime({ offset: false }).nullable(),
  })
  .describe('One channel\'s transition as the agent saw it')

export const TelephonyEventSchema = z
  .strictObject({
    event_id: z.string().min(1).max(64),
    database: z.string().min(1).max(64),
    occurred_at: z.string().datetime({ offset: false }),
    source: TelephonyEventSourceSchema,
    reconciled: z.boolean(),
    call: TelephonyEventCallSchema,
  })
  .describe('One event of the machine route')

export type TelephonyEvent = z.infer<typeof TelephonyEventSchema>
export type TelephonyEventCall = z.infer<typeof TelephonyEventCallSchema>

import { z } from 'zod'

export const IntegrationKindSchema = z.enum(['zatca', 'bank'])
export const IntegrationStateSchema = z.enum(['not_configured', 'pending', 'connected', 'error'])

/** Status of one live link. Status only: the wire shape carries no credential. */
export const IntegrationConnectionSchema = z.object({
  id: z.number().int().positive(),
  kind: IntegrationKindSchema,
  provider: z.string().min(1),
  state: IntegrationStateSchema,
  last_checked: z.string().nullable(),
  status_message: z.string(),
}).strict()

export const IntegrationConnectionListSchema = z.object({
  items: z.array(IntegrationConnectionSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type IntegrationKind = z.infer<typeof IntegrationKindSchema>
export type IntegrationState = z.infer<typeof IntegrationStateSchema>
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>
export type IntegrationConnectionList = z.infer<typeof IntegrationConnectionListSchema>

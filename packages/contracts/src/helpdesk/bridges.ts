import { z } from 'zod'

// The conversation bridge (odoo-addons/liwan_helpdesk_inbox): the tickets raised from a customer conversation.
// `GET` and `POST /inbox/conversations/<id>/tickets` answer `ConversationTicketListSchema` and `ConversationTicketSchema`.

/** A ticket raised from a conversation; the list is the caller's desk visibility, not every ticket of the conversation. */
export const ConversationTicketSchema = z.strictObject({
  id: z.number().int().positive(),
  number: z.string(),
  subject: z.string(),
  stage: z.strictObject({ id: z.number().int().positive(), name: z.string(), closed: z.boolean() }),
  created_at: z.string().nullable(),
})

export const ConversationTicketListSchema = z.strictObject({
  items: z.array(ConversationTicketSchema),
  total: z.number().int().nonnegative(),
})

/** `POST /inbox/conversations/<id>/tickets`: every field is optional; the subject and description default from the conversation. */
export const ConversationTicketCreateSchema = z.strictObject({
  subject: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  team_id: z.number().int().positive().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category_id: z.number().int().positive().optional(),
  type_id: z.number().int().positive().optional(),
})

export type ConversationTicket = z.infer<typeof ConversationTicketSchema>
export type ConversationTicketList = z.infer<typeof ConversationTicketListSchema>
export type ConversationTicketCreate = z.infer<typeof ConversationTicketCreateSchema>

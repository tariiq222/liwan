import { z } from 'zod'

/** What deleting a message does: keep a «message deleted» row (text and files cleared), or remove it for everyone. */
export const ChatMessageDeleteModeSchema = z.enum(['placeholder', 'permanent'])
export type ChatMessageDeleteMode = z.infer<typeof ChatMessageDeleteModeSchema>

const ChatSettingsValuesSchema = z.strictObject({ message_delete_mode: ChatMessageDeleteModeSchema })

/** `GET`/`PATCH /api/v1/chat/settings`: the company's values, the stated defaults, the allowed options and the revision. */
export const ChatSettingsSchema = z.strictObject({
  values: ChatSettingsValuesSchema,
  defaults: ChatSettingsValuesSchema,
  options: z.strictObject({ message_delete_mode: z.array(ChatMessageDeleteModeSchema) }),
  revision: z.number().int().min(0),
})
export type ChatSettings = z.infer<typeof ChatSettingsSchema>

/** One PATCH carries the revision the draft was made from; a stale revision answers 409. */
export const ChatSettingsPatchSchema = z.strictObject({
  revision: z.number().int().min(0),
  values: ChatSettingsValuesSchema,
})
export type ChatSettingsPatch = z.infer<typeof ChatSettingsPatchSchema>

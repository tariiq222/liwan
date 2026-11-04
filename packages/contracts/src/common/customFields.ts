import { z } from 'zod'

// The company's custom fields, as the API exposes Odoo's native properties engine: a definition of
// typed, labelled fields owned by the company, and the values one record carries for them. Nothing
// here names an application.

export const CustomFieldTypeSchema = z.enum([
  'char',
  'text',
  'integer',
  'float',
  'boolean',
  'date',
  'datetime',
  'selection',
  'tags',
])
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>

// A selection or a tags field is the only kind that carries options, and it always carries some.
const OPTION_TYPES: readonly CustomFieldType[] = ['selection', 'tags']

const optionShape = { key: z.string().min(1), label: z.string().min(1) }

export const CustomFieldOptionSchema = z.strictObject(optionShape)

// The definition item an emitted record and the company definition share: a key, a label, a type and,
// on the two option types, the ordered options.
const fieldShape = {
  key: z.string().min(1),
  label: z.string().min(1),
  type: CustomFieldTypeSchema,
  options: z.array(CustomFieldOptionSchema).optional(),
}

function checkOptions(field: { type: CustomFieldType; options?: readonly unknown[] }, ctx: z.RefinementCtx) {
  if (OPTION_TYPES.includes(field.type)) {
    if (!field.options?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'a selection or tags field needs its options' })
  } else if (field.options) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'a field of this type has no options' })
  }
}

/** One custom field of the company definition, in display order. */
export const CustomFieldDefinitionSchema = z.strictObject(fieldShape).superRefine(checkOptions)
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>

// A definition item of a settings patch: the server gives a new field, and each new option, its key.
export const CustomFieldDefinitionPatchItemSchema = z
  .strictObject({
    ...fieldShape,
    key: fieldShape.key.optional(),
    options: z.array(z.strictObject({ ...optionShape, key: optionShape.key.optional() })).optional(),
  })
  .superRefine(checkOptions)
export type CustomFieldDefinitionPatchItem = z.infer<typeof CustomFieldDefinitionPatchItemSchema>

/** A field's value: text, a number, a boolean, the chosen option keys of a tags field, or null when empty. */
export const CustomFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>

/** Values keyed by custom-field key; a patch carries only the fields it changes. */
export const CustomFieldValuesSchema = z.record(z.string().min(1), CustomFieldValueSchema)
export type CustomFieldValues = z.infer<typeof CustomFieldValuesSchema>

/** A record's own definition in order, each field carrying its value: enough to render and edit it alone. */
export const CustomFieldWithValueSchema = z
  .strictObject({ ...fieldShape, value: CustomFieldValueSchema })
  .superRefine(checkOptions)
export type CustomFieldWithValue = z.infer<typeof CustomFieldWithValueSchema>

/** The server's ceiling on custom fields, their options and a label, offered with the definition. */
export const CustomFieldLimitsSchema = z.strictObject({
  max_properties: z.number().int().positive(),
  max_options: z.number().int().positive(),
  max_label: z.number().int().positive(),
})
export type CustomFieldLimits = z.infer<typeof CustomFieldLimitsSchema>

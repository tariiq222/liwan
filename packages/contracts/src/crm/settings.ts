import { z } from 'zod'

export const CrmTermLanguageSchema = z.strictObject({
  singular: z.string().min(1).max(60),
  plural: z.string().min(1).max(60),
})

export const CrmTermSchema = z.strictObject({
  ar: CrmTermLanguageSchema,
  en: CrmTermLanguageSchema,
  gender: z.enum(['m', 'f']),
})

export const CrmSettingsTermsSchema = z.strictObject({
  customer: CrmTermSchema,
  opportunity: CrmTermSchema,
  package: CrmTermSchema,
})

export const CrmPresetSchema = z.enum(['general', 'phone_packages'])
export const CrmAfterAttemptsSchema = z.enum(['lost', 'manager'])
export const CrmDistributionModeSchema = z.enum(['round_robin', 'manual', 'on_import'])
export const CrmVisibilitySchema = z.enum(['own', 'team', 'all'])
export const CrmPriceAboveListSchema = z.enum(['forbid', 'managers', 'everyone'])

const RangeSchema = z.strictObject({ min: z.number().int(), max: z.number().int() })

export const CrmSettingsValuesSchema = z.strictObject({
  preset: CrmPresetSchema,
  followup_attempts: z.number().int().min(0).max(10),
  followup_interval_hours: z.number().int().min(1).max(720),
  after_attempts: CrmAfterAttemptsSchema,
  recycle_enabled: z.boolean(),
  recycle_after_days: z.number().int().min(1).max(365),
  recycle_cycles: z.number().int().min(0).max(5),
  distribution_mode: CrmDistributionModeSchema,
  distribution_user_ids: z.array(z.number().int()),
  visibility: CrmVisibilitySchema,
  view_log_enabled: z.boolean(),
  discount_allowed: z.boolean(),
  discount_max_percent: z.number().int().min(0).max(100),
  price_above_list: CrmPriceAboveListSchema,
  terms: CrmSettingsTermsSchema,
})

export const CrmSettingsOptionsSchema = z.strictObject({
  preset: z.array(CrmPresetSchema),
  after_attempts: z.array(CrmAfterAttemptsSchema),
  distribution_mode: z.array(CrmDistributionModeSchema),
  visibility: z.array(CrmVisibilitySchema),
  price_above_list: z.array(CrmPriceAboveListSchema),
  term_gender: z.array(z.enum(['m', 'f'])),
  followup_attempts: RangeSchema,
  followup_interval_hours: RangeSchema,
  recycle_after_days: RangeSchema,
  recycle_cycles: RangeSchema,
  discount_max_percent: RangeSchema,
})

export const CrmDistributionUserSchema = z.strictObject({ id: z.number().int(), name: z.string() })

export const CrmSettingsSchema = z.strictObject({
  values: CrmSettingsValuesSchema,
  // The names of `values.distribution_user_ids`, resolved at read time; a patch still carries ids only.
  distribution_users: z.array(CrmDistributionUserSchema),
  options: CrmSettingsOptionsSchema,
  revision: z.number().int().min(0),
})

const CrmTermPatchSchema = z.strictObject({
  ar: CrmTermLanguageSchema.partial().optional(),
  en: CrmTermLanguageSchema.partial().optional(),
  gender: z.enum(['m', 'f']).optional(),
})

// A values patch is partial and never carries `preset`; a preset patch carries no values.
export const CrmSettingsValuesPatchSchema = CrmSettingsValuesSchema.omit({ preset: true, terms: true })
  .extend({
    terms: z.strictObject({
      customer: CrmTermPatchSchema.optional(),
      opportunity: CrmTermPatchSchema.optional(),
      package: CrmTermPatchSchema.optional(),
    }),
  })
  .partial()
  .refine((values) => Object.keys(values).length > 0, 'values must not be empty')

export const CrmSettingsPatchSchema = z.union([
  z.strictObject({ revision: z.number().int().min(0), values: CrmSettingsValuesPatchSchema }),
  z.strictObject({ revision: z.number().int().min(0), preset: CrmPresetSchema }),
])

export type CrmSettings = z.infer<typeof CrmSettingsSchema>
export type CrmPreset = z.infer<typeof CrmPresetSchema>
export type CrmSettingsTerms = z.infer<typeof CrmSettingsTermsSchema>
export type CrmSettingsValues = z.infer<typeof CrmSettingsValuesSchema>
export type CrmSettingsValuesPatch = z.infer<typeof CrmSettingsValuesPatchSchema>
export type CrmSettingsPatch = z.infer<typeof CrmSettingsPatchSchema>

import { z } from 'zod'

export const ProjectToolKeySchema = z.enum(['planning', 'governance', 'finance'])
export const ProjectToolPolicySchema = z.enum(['enabled', 'optional', 'disabled'])

export const ProjectToolPoliciesSchema = z.object({
  planning: ProjectToolPolicySchema,
  governance: ProjectToolPolicySchema,
  finance: ProjectToolPolicySchema,
}).strict()

// Effective read state is server-owned; policy never grants an entitlement or capability.
export const ProjectToolStateSchema = z.object({
  policy: ProjectToolPolicySchema,
  enabled: z.boolean(),
  can_toggle: z.boolean(),
}).strict()
export const ProjectToolsStateSchema = z.object({
  planning: ProjectToolStateSchema,
  governance: ProjectToolStateSchema,
  finance: ProjectToolStateSchema,
}).strict()

export const ProjectToolPreferencesPatchSchema = z.object({
  planning: z.boolean().optional(),
  governance: z.boolean().optional(),
  finance: z.boolean().optional(),
}).strict()

export type ProjectToolKey = z.infer<typeof ProjectToolKeySchema>
export type ProjectToolPolicy = z.infer<typeof ProjectToolPolicySchema>
export type ProjectToolPolicies = z.infer<typeof ProjectToolPoliciesSchema>
export type ProjectToolState = z.infer<typeof ProjectToolStateSchema>
export type ProjectToolsState = z.infer<typeof ProjectToolsStateSchema>
export type ProjectToolPreferencesPatch = z.infer<typeof ProjectToolPreferencesPatchSchema>

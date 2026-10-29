import { z } from 'zod'
import { LocalizedLabelSchema } from './access'

const Id = z.number().int().positive()
const RoleIds = z.array(Id).refine(ids => new Set(ids).size === ids.length, 'duplicate role')
const Version = z.string().trim().min(1)
const Mode = z.enum(['isolated', 'delegated', 'inherited'])
export const BRANCH_PRESETS = ['single_company', 'central_branches', 'independent_branches', 'group_of_companies'] as const
export const BranchPresetSchema = z.enum(BRANCH_PRESETS)
// The mode each preset writes; the stored policy stays the only source of truth.
export const BRANCH_PRESET_MODES = {
  single_company: 'delegated',
  central_branches: 'inherited',
  independent_branches: 'delegated',
  group_of_companies: 'isolated',
} as const satisfies Record<z.infer<typeof BranchPresetSchema>, z.infer<typeof Mode>>
const Role = z.object({ id: Id, key: z.string().min(1), name: LocalizedLabelSchema, company_id: Id.nullable(), active: z.boolean() }).strict()
const UniqueBranches = <T extends z.ZodType<{ id: number }>>(item: T) => z.array(item)
  .refine(items => new Set(items.map(branch => branch.id)).size === items.length, 'duplicate branch')

export const BranchPolicySchema = z.object({
  version: Version,
  mode: Mode,
  preset: z.union([BranchPresetSchema, z.literal('custom')]),
  branches: UniqueBranches(z.object({ id: Id, name: z.string(), inherit: z.boolean(), role_ids: RoleIds }).strict()),
  roles: z.array(Role),
}).strict()
export const BranchPolicyInputSchema = z.object({
  expected_version: Version,
  mode: Mode,
  branches: UniqueBranches(z.object({ id: Id, inherit: z.boolean(), role_ids: RoleIds }).strict()),
}).strict()
export const BranchPresetInputSchema = z.object({ expected_version: Version, preset: BranchPresetSchema }).strict()
export const UserBranchAccessSchema = z.object({
  version: Version,
  branches: UniqueBranches(z.object({ id: Id, name: z.string(), role_ids: RoleIds }).strict()),
  roles: z.array(Role),
}).strict()
export const UserBranchAccessInputSchema = z.object({
  expected_version: Version,
  branches: UniqueBranches(z.object({ id: Id, role_ids: RoleIds }).strict()),
}).strict()

export type BranchPolicy = z.infer<typeof BranchPolicySchema>
export type BranchPreset = z.infer<typeof BranchPresetSchema>
export type BranchPresetInput = z.infer<typeof BranchPresetInputSchema>
export type BranchPolicyInput = z.infer<typeof BranchPolicyInputSchema>
export type UserBranchAccess = z.infer<typeof UserBranchAccessSchema>
export type UserBranchAccessInput = z.infer<typeof UserBranchAccessInputSchema>

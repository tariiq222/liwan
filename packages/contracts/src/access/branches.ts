import { z } from 'zod'
import { LocalizedLabelSchema } from './access'

const Id = z.number().int().positive()
const RoleIds = z.array(Id).refine(ids => new Set(ids).size === ids.length, 'duplicate role')
const Version = z.string().trim().min(1)
const Mode = z.enum(['isolated', 'delegated', 'inherited'])
const Role = z.object({ id: Id, key: z.string().min(1), name: LocalizedLabelSchema, company_id: Id.nullable(), active: z.boolean() }).strict()
const UniqueBranches = <T extends z.ZodType<{ id: number }>>(item: T) => z.array(item)
  .refine(items => new Set(items.map(branch => branch.id)).size === items.length, 'duplicate branch')

export const BranchPolicySchema = z.object({
  version: Version,
  mode: Mode,
  branches: UniqueBranches(z.object({ id: Id, name: z.string(), inherit: z.boolean(), role_ids: RoleIds }).strict()),
  roles: z.array(Role),
}).strict()
export const BranchPolicyInputSchema = z.object({
  expected_version: Version,
  mode: Mode,
  branches: UniqueBranches(z.object({ id: Id, inherit: z.boolean(), role_ids: RoleIds }).strict()),
}).strict()
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
export type BranchPolicyInput = z.infer<typeof BranchPolicyInputSchema>
export type UserBranchAccess = z.infer<typeof UserBranchAccessSchema>
export type UserBranchAccessInput = z.infer<typeof UserBranchAccessInputSchema>

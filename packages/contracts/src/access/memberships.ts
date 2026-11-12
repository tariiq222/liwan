import { z } from 'zod'
import { RoleAssignmentInputSchema, RoleAssignmentSchema, type RoleAssignmentInput } from './access'

const IdSchema = z.number().int().positive()
const NonEmptyVersionSchema = z.string().trim().min(1)
const uniqueAssignments = (assignments: RoleAssignmentInput[]) => {
  const keys = assignments.map((assignment) => `${assignment.role_id}:${assignment.scope.kind}:${assignment.scope.id}`)
  return new Set(keys).size === keys.length
}

export const MembershipCompanySchema = z.object({ id: IdSchema, name: z.string() }).strict()
export type MembershipCompany = z.infer<typeof MembershipCompanySchema>

/** The roles of a member in one company; unlike the roles of an invitation, the list may be empty. */
export const MembershipAssignmentListSchema = z.array(RoleAssignmentInputSchema).refine(uniqueAssignments, { message: 'assignments must be unique' })

/**
 * An account of the tenant that belongs to a company other than its home company, with the roles it holds in this one.
 * `version` names those roles: send it back with a change so two administrators editing at once meet a conflict.
 */
export const MembershipSchema = z.object({
  id: IdSchema,
  name: z.string(),
  login: z.string(),
  home_company: MembershipCompanySchema,
  company: MembershipCompanySchema,
  assignments: z.array(RoleAssignmentSchema),
  version: z.string().min(1),
}).strict()
export type Membership = z.infer<typeof MembershipSchema>
export const MembershipListSchema = z.object({ items: z.array(MembershipSchema), total: z.number().int().nonnegative() }).strict()
export type MembershipList = z.infer<typeof MembershipListSchema>

/**
 * Add an existing account of the tenant to a company, by the email the administrator typed.
 * `company_id` names a branch below the root company; only an administrator of the root company may send it, and
 * the scope of every assignment must be the company being joined. `employee_id` links that company's employee file
 * (HR installed only).
 */
export const MembershipInputSchema = z.object({
  login: z.string().trim().email(),
  assignments: MembershipAssignmentListSchema,
  company_id: IdSchema.optional(),
  employee_id: IdSchema.optional(),
}).strict()
export type MembershipInput = z.infer<typeof MembershipInputSchema>

export const MembershipRolesInputSchema = z.object({
  expected_version: NonEmptyVersionSchema,
  assignments: MembershipAssignmentListSchema,
  company_id: IdSchema.optional(),
}).strict()
export type MembershipRolesInput = z.infer<typeof MembershipRolesInputSchema>

/** The query of the list and of the removal: the branch to act in when it is not the working company. */
export const MembershipQuerySchema = z.object({ company_id: IdSchema.optional() }).strict()
export type MembershipQuery = z.infer<typeof MembershipQuerySchema>

/**
 * `details` of the `409 account_exists` answer of the invitation and the employee-account routes when the typed
 * email belongs to an active account of the tenant whose home is another company: the name and the home company
 * are all that is shown, enough to confirm before adding that account as a member.
 */
export const ExistingAccountDetailsSchema = z.object({
  existing_account: z.object({ name: z.string(), home_company: MembershipCompanySchema }).strict(),
}).strict()
export type ExistingAccountDetails = z.infer<typeof ExistingAccountDetailsSchema>

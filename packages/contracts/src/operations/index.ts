import { z } from 'zod'
import { PersonRefSchema } from '../common/person'

const Id = z.number().int().positive()
const Revision = z.number().int().nonnegative()
const Ref = z.object({ id: Id, name: z.string() }).strict()
export const OperationTargetSchema = Ref.extend({ href: z.string() }).strict()
export const OperationTargetsSchema = z.object({ items: z.array(OperationTargetSchema), total: Revision }).strict()
export const OperationExecutionKindsSchema = z.object({ items: z.array(z.string()), total: Revision }).strict()
export const OperationStateSchema = z.enum(['draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done'])
export const OperationPurposeSchema = z.enum(['work', 'employee'])
export const OperationProcessSchema = z.object({
  id: Id, name: z.string(), description: z.string(),
  purpose: OperationPurposeSchema,
  state: z.enum(['draft', 'published', 'archived']), revision: Revision,
  execution_kind: z.string().min(1),
  steps: z.array(z.object({
    name: z.string(), reviewer_ids: z.array(Id), reviewers: z.array(PersonRefSchema),
  }).strict()),
}).strict()
export const OperationActionsSchema = z.object({
  edit: z.boolean(), submit: z.boolean(), approve: z.boolean(), reject: z.boolean(),
  return: z.boolean(), withdraw: z.boolean(),
}).strict()
export const OperationRequestSummarySchema = z.object({
  id: Id, name: z.string(), process: Ref, process_revision: Revision,
  purpose: OperationPurposeSchema,
  state: OperationStateSchema, revision: Revision, cycle: Revision,
  requester: PersonRefSchema, created_at: z.string(), execution_count: Revision,
}).strict()
export const OperationRequestSchema = OperationRequestSummarySchema.extend({
  description: z.string(),
  target: OperationTargetSchema.nullable(),
  steps: z.array(z.object({ sequence: Id, name: z.string(), reviewers: z.array(PersonRefSchema), status: z.enum(['waiting', 'pending', 'approved', 'rejected', 'cancel']) }).strict()),
  events: z.array(z.object({ id: Id, kind: z.string(), actor: PersonRefSchema, comment: z.string(), cycle: Revision, created_at: z.string() }).strict()),
  attachments: z.array(z.object({ id: Id, name: z.string(), mimetype: z.string(), url: z.string() }).strict()),
  allowed_actions: OperationActionsSchema,
}).strict()
export const OperationRequestListSchema = z.object({ items: z.array(OperationRequestSummarySchema), total: Revision }).strict()
export const OperationProcessListSchema = z.object({ items: z.array(OperationProcessSchema), total: Revision }).strict()
export type OperationRequest = z.infer<typeof OperationRequestSchema>
export type OperationRequestSummary = z.infer<typeof OperationRequestSummarySchema>
export type OperationProcess = z.infer<typeof OperationProcessSchema>
export type OperationPurpose = z.infer<typeof OperationPurposeSchema>
export type OperationAction = Exclude<keyof z.infer<typeof OperationActionsSchema>, 'edit'>
export interface OperationRequestBody { name: string; description: string; process_id: number; target_id?: number; revision?: number }
export interface OperationProcessBody { name: string; description: string; purpose: OperationPurpose; execution_kind: string; steps: { name: string; reviewer_ids: number[] }[]; revision?: number }

import type {
  BudgetState,
  ProjectCharterState,
  ProjectCharterStep,
  ProjectCharterWrite,
  ProjectCreate,
  ProjectDetail,
  ProjectPatch,
  ProjectPriority,
} from '@nasq/contracts'

export const CHARTER_FIELD_KEYS = [
  'name',
  'code',
  'description',
  'type',
  'owning_unit',
  'sponsor',
  'manager',
  'authority',
  'rationale',
  'objectives',
  'benefits',
  'scope',
  'exclusions',
  'high_level_requirements',
  'deliverables',
  'acceptance',
  'success',
  'date_start',
  'date_end',
  'budget_state',
  'amount',
  'currency',
  'priority',
  'assumptions',
  'constraints',
  'closure',
] as const

export type CharterFieldKey = (typeof CHARTER_FIELD_KEYS)[number]

export const PROJECT_PRIORITIES: ProjectPriority[] = ['low', 'normal', 'high', 'critical']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type ObjectiveDraft = {
  key: string
  goal: string
  metric: string
  target: string
  persisted: boolean
}

export type DeliverableDraft = {
  key: string
  name: string
  description: string
  acceptance: string
  persisted: boolean
}

type CharterMilestoneDeliverable = {
  name: string
  done: boolean
}

export type CharterMilestone = {
  id: number
  name: string
  deliverables?: readonly CharterMilestoneDeliverable[]
}

type CharterMilestoneOutput = CharterMilestoneDeliverable & {
  milestoneId: number
  milestoneName: string
}

export type CharterDraft = {
  name: string
  description: string
  userId: number | null
  managerName: string | null
  dateStart: string | null
  dateEnd: string | null
  typeId: number | null
  typeName: string | null
  // Optional wizard steps of the chosen type; null walks every step.
  typeSteps: ProjectCharterStep[] | null
  owningUnitId: number | null
  owningUnitName: string | null
  sponsorId: number | null
  sponsorName: string | null
  authority: string
  rationale: string
  objectives: ObjectiveDraft[]
  benefits: string
  scope: string
  exclusions: string
  highLevelRequirements: string
  deliverables: DeliverableDraft[]
  success: string
  budgetState: BudgetState
  amountInput: string
  currencyLabel: string | null
  code: string | null
  priority: ProjectPriority | null
  assumptions: string
  constraints: string
  closure: string
  charterState: ProjectCharterState
}

let rowSeq = 0

function charterRowKey(kind: 'objective' | 'deliverable', index: number): string {
  return `charter-${kind}-${index}`
}

function nextCharterRowKey(): string {
  rowSeq += 1
  return `charter-row-${rowSeq}`
}

export function emptyObjective(persisted = false, key = nextCharterRowKey()): ObjectiveDraft {
  return { key, goal: '', metric: '', target: '', persisted }
}

export function emptyDeliverable(persisted = false, key = nextCharterRowKey()): DeliverableDraft {
  return { key, name: '', description: '', acceptance: '', persisted }
}

export function emptyCharterDraft(currencyLabel: string | null = null): CharterDraft {
  return {
    name: '',
    description: '',
    userId: null,
    managerName: null,
    dateStart: null,
    dateEnd: null,
    typeId: null,
    typeName: null,
    typeSteps: null,
    owningUnitId: null,
    owningUnitName: null,
    sponsorId: null,
    sponsorName: null,
    authority: '',
    rationale: '',
    objectives: [emptyObjective(false, charterRowKey('objective', 0))],
    benefits: '',
    scope: '',
    exclusions: '',
    highLevelRequirements: '',
    deliverables: [emptyDeliverable(false, charterRowKey('deliverable', 0))],
    success: '',
    budgetState: 'unknown',
    amountInput: '',
    currencyLabel,
    code: null,
    priority: null,
    assumptions: '',
    constraints: '',
    closure: '',
    charterState: 'draft',
  }
}

function formatCurrencyLabel(currency: ProjectDetail['charter']['currency']): string | null {
  if (!currency) return null
  return currency.symbol ? `${currency.name} (${currency.symbol})` : currency.name
}

export function draftFromProject(project: ProjectDetail): CharterDraft {
  const charter = project.charter
  const objectives = charter.objectives.map((row, index) => ({
    key: charterRowKey('objective', index),
    goal: row.goal,
    metric: row.metric,
    target: row.target,
    persisted: true,
  }))
  const deliverables = charter.deliverables.map((row, index) => ({
    key: charterRowKey('deliverable', index),
    name: row.name,
    description: row.description,
    acceptance: row.acceptance,
    persisted: true,
  }))
  return {
    name: project.name,
    description: project.description_html ?? '',
    userId: project.manager?.id ?? null,
    managerName: project.manager?.name ?? null,
    dateStart: project.date_start,
    dateEnd: project.date_end,
    typeId: charter.type?.id ?? null,
    typeName: charter.type?.name ?? null,
    typeSteps: charter.type ? [...charter.type.charter_steps] : null,
    owningUnitId: charter.owning_unit?.id ?? null,
    owningUnitName: charter.owning_unit?.name ?? null,
    sponsorId: charter.sponsor?.id ?? null,
    sponsorName: charter.sponsor?.name ?? null,
    authority: charter.authority,
    rationale: charter.rationale,
    objectives: objectives.length ? objectives : [emptyObjective(false, charterRowKey('objective', 0))],
    benefits: charter.benefits,
    scope: charter.scope,
    exclusions: charter.exclusions,
    highLevelRequirements: charter.high_level_requirements,
    deliverables: deliverables.length ? deliverables : [emptyDeliverable(false, charterRowKey('deliverable', 0))],
    success: charter.success,
    budgetState: charter.budget_state,
    amountInput: charter.budget_state === 'estimate' && charter.amount != null ? String(charter.amount) : '',
    currencyLabel: formatCurrencyLabel(charter.currency),
    code: charter.code,
    priority: charter.priority,
    assumptions: charter.assumptions,
    constraints: charter.constraints,
    closure: charter.closure,
    charterState: charter.state,
  }
}

function isBlankObjective(row: Pick<ObjectiveDraft, 'goal' | 'metric' | 'target'>): boolean {
  return !row.goal.trim() && !row.metric.trim() && !row.target.trim()
}

function isBlankDeliverable(row: Pick<DeliverableDraft, 'name' | 'description' | 'acceptance'>): boolean {
  return !row.name.trim() && !row.description.trim() && !row.acceptance.trim()
}

export function stripBlankObjectives(rows: ObjectiveDraft[]): ObjectiveDraft[] {
  return rows.filter((row) => !isBlankObjective(row))
}

export function stripBlankDeliverables(rows: DeliverableDraft[]): DeliverableDraft[] {
  return rows.filter((row) => !isBlankDeliverable(row))
}

export function aggregateMilestoneOutputs(milestones: readonly CharterMilestone[]): CharterMilestoneOutput[] {
  return milestones.flatMap((milestone) => (milestone.deliverables ?? [])
    .filter((output) => output.name.trim())
    .map((output) => ({
      milestoneId: milestone.id,
      milestoneName: milestone.name,
      name: output.name,
      done: output.done,
    })))
}

type AmountParse =
  | { ok: true; value: number | null }
  | { ok: false; code: 'invalid' | 'negative' | 'nonfinite' }

export function parseAmountInput(raw: string): AmountParse {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, code: 'invalid' }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { ok: false, code: 'nonfinite' }
  if (value < 0) return { ok: false, code: 'negative' }
  return { ok: true, value }
}

export function isIsoDate(value: string | null | undefined): boolean {
  if (value == null || value === '') return true
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export type CharterFieldError = { field: CharterFieldKey; code: string }

export type NativeDateSnapshot = {
  dateStart: string | null
  dateEnd: string | null
}

type CharterValidateContext = {
  mode: 'create' | 'edit'
  originalDates?: NativeDateSnapshot
}

export function nativeDateSnapshot(project: Pick<ProjectDetail, 'date_start' | 'date_end'>): NativeDateSnapshot {
  return { dateStart: project.date_start, dateEnd: project.date_end }
}

function draftDateSnapshot(draft: Pick<CharterDraft, 'dateStart' | 'dateEnd'>): NativeDateSnapshot {
  return { dateStart: draft.dateStart, dateEnd: draft.dateEnd }
}

function datesEqual(left: NativeDateSnapshot, right: NativeDateSnapshot): boolean {
  return left.dateStart === right.dateStart && left.dateEnd === right.dateEnd
}

function isSupportedDateWrite(snapshot: NativeDateSnapshot): boolean {
  return !snapshot.dateStart || !!snapshot.dateEnd
}

function datesChangedFromOriginal(draft: CharterDraft, originalDates: NativeDateSnapshot): boolean {
  return !datesEqual(draftDateSnapshot(draft), originalDates)
}

export function validateCharterDraft(
  draft: CharterDraft,
  context: CharterValidateContext = { mode: 'create' },
): CharterFieldError[] {
  const errors: CharterFieldError[] = []
  if (!draft.name.trim()) errors.push({ field: 'name', code: 'required' })
  if (!isIsoDate(draft.dateStart)) errors.push({ field: 'date_start', code: 'iso' })
  if (!isIsoDate(draft.dateEnd)) errors.push({ field: 'date_end', code: 'iso' })
  const currentDates = draftDateSnapshot(draft)
  const datesAreBeingWritten = context.mode === 'create' || !context.originalDates || datesChangedFromOriginal(draft, context.originalDates)
  if (datesAreBeingWritten && !isSupportedDateWrite(currentDates)) {
    errors.push({ field: 'date_start', code: 'pair' })
    errors.push({ field: 'date_end', code: 'pair' })
  }
  const amount = parseAmountInput(draft.amountInput)
  if (!amount.ok) errors.push({ field: 'amount', code: amount.code })
  else if (draft.budgetState === 'unknown' && amount.value != null && amount.value !== 0) {
    errors.push({ field: 'amount', code: 'unknown_amount' })
  }
  else if (draft.budgetState === 'estimate' && amount.value == null) {
    errors.push({ field: 'amount', code: 'estimate_required' })
  }
  return errors
}

// The wizard validates one step at a time: only errors on the fields that
// step shows may stop the walker from moving on.
export function charterErrorsForFields(errors: readonly CharterFieldError[], fields: readonly CharterFieldKey[]): CharterFieldError[] {
  return errors.filter(error => fields.includes(error.field))
}

export function canOverwriteWithLatest(originalToken: string | null, serverVersion: Pick<ProjectDetail, 'updated_at'> | null): boolean {
  return !!originalToken && !!serverVersion?.updated_at && serverVersion.updated_at !== originalToken
}

export function isCharterDraftDirty(draft: CharterDraft, baseline: CharterDraft): boolean {
  return comparableCharterDraft(draft) !== comparableCharterDraft(baseline)
}

function comparableCharterDraft(draft: CharterDraft): string {
  return JSON.stringify({
    name: draft.name.trim(),
    description: draft.description,
    userId: draft.userId,
    dateStart: draft.dateStart,
    dateEnd: draft.dateEnd,
    typeId: draft.typeId,
    owningUnitId: draft.owningUnitId,
    sponsorId: draft.sponsorId,
    authority: draft.authority,
    rationale: draft.rationale,
    objectives: stripBlankObjectives(draft.objectives).map(({ goal, metric, target }) => ({ goal, metric, target })),
    benefits: draft.benefits,
    scope: draft.scope,
    exclusions: draft.exclusions,
    highLevelRequirements: draft.highLevelRequirements,
    deliverables: stripBlankDeliverables(draft.deliverables).map(({ name, description, acceptance }) => ({ name, description, acceptance })),
    success: draft.success,
    budgetState: draft.budgetState,
    amountInput: draft.amountInput.trim(),
    priority: draft.priority,
    assumptions: draft.assumptions,
    constraints: draft.constraints,
    closure: draft.closure,
  })
}

function compactText(value: string): string | undefined {
  return value.trim() ? value : undefined
}

export function charterWriteFromDraft(draft: CharterDraft, mode: 'create' | 'patch'): ProjectCharterWrite {
  const objectives = stripBlankObjectives(draft.objectives).map(({ goal, metric, target }) => ({ goal, metric, target }))
  const deliverables = stripBlankDeliverables(draft.deliverables).map(({ name, description, acceptance }) => ({
    name,
    description,
    acceptance,
  }))
  const amount = parseAmountInput(draft.amountInput)
  const amountValue = amount.ok ? amount.value : null

  if (mode === 'create') {
    const write: ProjectCharterWrite = {}
    if (draft.typeId) write.type_id = draft.typeId
    if (draft.owningUnitId) write.owning_unit_id = draft.owningUnitId
    if (draft.sponsorId) write.sponsor_id = draft.sponsorId
    const authority = compactText(draft.authority)
    if (authority) write.authority = authority
    const rationale = compactText(draft.rationale)
    if (rationale) write.rationale = rationale
    if (objectives.length) write.objectives = objectives
    const benefits = compactText(draft.benefits)
    if (benefits) write.benefits = benefits
    const scope = compactText(draft.scope)
    if (scope) write.scope = scope
    const exclusions = compactText(draft.exclusions)
    if (exclusions) write.exclusions = exclusions
    const requirements = compactText(draft.highLevelRequirements)
    if (requirements) write.high_level_requirements = requirements
    if (deliverables.length) write.deliverables = deliverables
    const success = compactText(draft.success)
    if (success) write.success = success
    if (draft.budgetState === 'estimate') {
      write.budget_state = 'estimate'
      write.amount = amountValue ?? 0
    }
    else if (draft.budgetState === 'unknown' && amountValue != null) {
      write.budget_state = 'unknown'
    }
    if (draft.priority) write.priority = draft.priority
    const assumptions = compactText(draft.assumptions)
    if (assumptions) write.assumptions = assumptions
    const constraints = compactText(draft.constraints)
    if (constraints) write.constraints = constraints
    const closure = compactText(draft.closure)
    if (closure) write.closure = closure
    return write
  }

  const write: ProjectCharterWrite = {
    type_id: draft.typeId,
    owning_unit_id: draft.owningUnitId,
    sponsor_id: draft.sponsorId,
    authority: draft.authority,
    rationale: draft.rationale,
    objectives,
    benefits: draft.benefits,
    scope: draft.scope,
    exclusions: draft.exclusions,
    high_level_requirements: draft.highLevelRequirements,
    deliverables,
    success: draft.success,
    budget_state: draft.budgetState,
    priority: draft.priority,
    assumptions: draft.assumptions,
    constraints: draft.constraints,
    closure: draft.closure,
  }
  if (draft.budgetState === 'unknown') write.amount = null
  else write.amount = amountValue ?? 0
  return write
}

export function hasCharterWriteContent(write: ProjectCharterWrite): boolean {
  return Object.keys(write).length > 0
}

export function createdProjectLocation(id: number, returnTo: string): {
  path: string
  query: { returnTo: string; tab: 'milestones' }
} {
  return { path: `/projects/${id}`, query: { returnTo, tab: 'milestones' } }
}

export function draftedProjectLocation(id: number, step: string, returnTo: string): {
  path: string
  query: { returnTo: string; edit: '1'; step: string }
} {
  return { path: `/projects/${id}/charter`, query: { returnTo, edit: '1', step } }
}

export function charterCreateBody(
  draft: CharterDraft,
  options: { includeNullManager?: boolean } = {},
): ProjectCreate {
  const body: ProjectCreate = { name: draft.name.trim() }
  if (draft.description.trim()) body.description = draft.description
  if (draft.userId || options.includeNullManager) body.user_id = draft.userId
  const dates = draftDateSnapshot(draft)
  if (dates.dateStart && dates.dateEnd) {
    body.date_start = dates.dateStart
    body.date = dates.dateEnd
  }
  else if (dates.dateEnd) {
    body.date_end = dates.dateEnd
  }
  const charter = charterWriteFromDraft(draft, 'create')
  if (hasCharterWriteContent(charter)) body.charter = charter
  return body
}

export function charterPatchBody(
  draft: CharterDraft,
  expectedUpdatedAt: string,
  originalDates: NativeDateSnapshot,
): ProjectPatch {
  const patch: ProjectPatch = {
    name: draft.name.trim(),
    description: draft.description,
    user_id: draft.userId,
    charter: charterWriteFromDraft(draft, 'patch'),
    expected_updated_at: expectedUpdatedAt,
  }
  if (datesChangedFromOriginal(draft, originalDates)) {
    if (!draft.dateStart && draft.dateEnd) {
      patch.date = draft.dateEnd
    }
    else {
      patch.date_start = draft.dateStart
      patch.date = draft.dateEnd
    }
  }
  return patch
}

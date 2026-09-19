import { PROJECT_CHARTER_STEPS, type ProjectCharterStep } from '@nasq/contracts'
import type { CharterFieldKey } from '@/utils/projectCharter'
import { firstQuery } from './routeQuery'

// The charter is written step by step. `basics` opens every walk and `review`
// closes it; the optional steps in between come from the project type chosen
// in the basics step (`charter_steps` on the type catalog), so the wizard is
// shaped by the classification rather than by a fixed form.
export const CHARTER_WIZARD_STEPS = ['basics', ...PROJECT_CHARTER_STEPS, 'review'] as const

export type CharterWizardStep = (typeof CHARTER_WIZARD_STEPS)[number]

const OPTIONAL_CHARTER_STEPS: readonly ProjectCharterStep[] = PROJECT_CHARTER_STEPS

export const CHARTER_STEP_FIELDS: Record<CharterWizardStep, readonly CharterFieldKey[]> = {
  basics: ['name', 'code', 'description', 'type', 'owning_unit', 'manager', 'sponsor'],
  justification: ['authority', 'rationale', 'objectives', 'benefits'],
  scope: ['scope', 'exclusions', 'high_level_requirements', 'deliverables', 'acceptance', 'success'],
  schedule: ['date_start', 'date_end', 'priority'],
  budget: ['budget_state', 'amount', 'currency'],
  risks: ['assumptions', 'constraints', 'closure'],
  review: [],
}

function isCharterWizardStep(value: unknown): value is CharterWizardStep {
  return typeof value === 'string' && (CHARTER_WIZARD_STEPS as readonly string[]).includes(value)
}

// A type with no steps configured (or no type at all) walks every step, so a
// missing catalog value never hides charter content.
export function charterStepsForType(typeSteps: readonly string[] | null | undefined): CharterWizardStep[] {
  const optional = typeSteps == null
    ? OPTIONAL_CHARTER_STEPS
    : OPTIONAL_CHARTER_STEPS.filter(step => typeSteps.includes(step))
  return ['basics', ...optional, 'review']
}

export function fieldsForStep(step: CharterWizardStep): readonly CharterFieldKey[] {
  return CHARTER_STEP_FIELDS[step]
}

export function stepForField(steps: readonly CharterWizardStep[], field: CharterFieldKey): CharterWizardStep | null {
  return steps.find(step => CHARTER_STEP_FIELDS[step].includes(field)) ?? null
}

// `?step=` carries the step key so a refresh or a shared link reopens the
// same place; an unknown or absent value starts from the first step.
export function parseCharterStepQuery(value: unknown, steps: readonly CharterWizardStep[]): CharterWizardStep {
  const raw = firstQuery(value)
  return isCharterWizardStep(raw) && steps.includes(raw) ? raw : steps[0]!
}

export function clampCharterStep(current: CharterWizardStep, steps: readonly CharterWizardStep[]): CharterWizardStep {
  if (steps.includes(current)) return current
  // The type changed under the walker: land on the nearest step that still
  // exists rather than jumping back to the start.
  const previousIndex = CHARTER_WIZARD_STEPS.indexOf(current)
  const candidates = steps.filter(step => CHARTER_WIZARD_STEPS.indexOf(step) < previousIndex)
  return candidates[candidates.length - 1] ?? steps[0]!
}

export function adjacentCharterStep(current: CharterWizardStep, steps: readonly CharterWizardStep[], direction: 1 | -1): CharterWizardStep | null {
  const index = steps.indexOf(current)
  if (index === -1) return null
  return steps[index + direction] ?? null
}

import type { FinanceSetup } from '@webvue/contracts'

type Blocker = FinanceSetup['blockers'][number]

/** The setup steps in the order a user fixes them: the server's blocker codes, each done once it is no longer a blocker. */
export const FINANCE_SETUP_STEPS: readonly Blocker[] = [
  'chart_not_loaded', 'vat_15_tax_missing', 'company_vat_missing', 'company_registry_missing', 'company_address_incomplete', 'zatca_not_onboarded',
]

export interface FinanceSetupStep { code: Blocker; done: boolean }

export function financeSetupSteps(setup: Pick<FinanceSetup, 'blockers'>): FinanceSetupStep[] {
  return FINANCE_SETUP_STEPS.map(code => ({ code, done: !setup.blockers.includes(code) }))
}

/** How many of the steps are done, for the progress hint. */
export function financeSetupProgress(setup: Pick<FinanceSetup, 'blockers'>): { done: number; total: number } {
  const steps = financeSetupSteps(setup)
  return { done: steps.filter(step => step.done).length, total: steps.length }
}

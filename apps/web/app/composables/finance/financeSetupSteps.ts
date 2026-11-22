import type { FinanceSetup } from '@liwan/contracts'

type Blocker = FinanceSetup['blockers'][number]

/** The setup steps in the order a user fixes them: the server's blocker codes, each done once it is no longer a blocker. */
export const FINANCE_SETUP_STEPS: readonly Blocker[] = [
  'vat_15_tax_missing', 'company_vat_missing', 'company_registry_missing', 'company_address_incomplete', 'zatca_not_onboarded',
]

export interface FinanceSetupStep { code: Blocker; done: boolean }

/**
 * Where each blocked step is fixed. Every step used to link to `/settings/apps/finance` itself, so the checklist
 * was a loop: the page that showed the blocker was the only page it offered to answer it. Each target is the page
 * that owns that setting.
 */
export const FINANCE_SETUP_TARGETS: Readonly<Record<Blocker, string>> = {
  vat_15_tax_missing: '/settings/apps/finance/taxes',
  company_vat_missing: '/settings/company#profile',
  company_registry_missing: '/settings/company#profile',
  company_address_incomplete: '/settings/company#address',
  zatca_not_onboarded: '/settings/apps/finance?tab=zatca#zatca',
}

/** The route that fixes one step. */
export function financeSetupTarget(code: Blocker): string {
  return FINANCE_SETUP_TARGETS[code]
}

export function financeSetupSteps(setup: Pick<FinanceSetup, 'blockers'>): FinanceSetupStep[] {
  return FINANCE_SETUP_STEPS.map(code => ({ code, done: !setup.blockers.includes(code) }))
}

/** How many of the steps are done, for the progress hint. */
export function financeSetupProgress(setup: Pick<FinanceSetup, 'blockers'>): { done: number; total: number } {
  const steps = financeSetupSteps(setup)
  return { done: steps.filter(step => step.done).length, total: steps.length }
}

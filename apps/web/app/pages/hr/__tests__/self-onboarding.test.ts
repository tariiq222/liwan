import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canReachPath } from '../../../utils/accessPolicy'
import manifest from '../../../modules/hr/manifest'
import arHr from '../../../../i18n/locales/ar/hr.json'
import enHr from '../../../../i18n/locales/en/hr.json'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')
const employee = { capabilities: ['hr.employees.read', 'hr.leave.read'], platform: { readable_features: ['hr.enabled', 'hr.onboarding'], writable_features: ['hr.enabled', 'hr.onboarding'] } }

describe('the employee own onboarding page', () => {
  it('opens at /account/onboarding for an employee with no onboarding capability', () => {
    expect(read('pages/hr/self/onboarding.vue')).toContain("definePageMeta({ path: '/account/onboarding' })")
    expect(canReachPath(employee, '/account/onboarding')).toBe(true)
    expect(manifest.routeCapabilities?.find(rule => rule.pattern.test('/account/onboarding'))).toMatchObject({ capability: 'hr.employees.read', feature: 'hr.onboarding' })
    expect(canReachPath(employee, '/hr/onboarding')).toBe(false)
  })

  it('lists the steps and finishes one through the self-service composables only', () => {
    const page = read('pages/hr/self/onboarding.vue')
    for (const part of ['useMyHrOnboardingSteps', 'useCompleteMyHrOnboardingStep', 'hr-onboarding-mine-done', '<SharedDataTable', '#mobile-row', '<SharedEmptyState']) expect(page).toContain(part)
    expect(page).not.toContain('useHrOnboarding')
    const composable = read('composables/useHrOwnOnboarding.ts')
    expect(composable).toContain('/api/v1/hr/self/onboarding-steps')
  })

  it('words the page in both languages', () => {
    for (const messages of [arHr, enHr]) {
      for (const key of ['onboarding', 'onboardingDesc', 'onboardingEmptyTitle', 'onboardingEmptyHint', 'onboardingDone', 'openOnboardingSteps']) expect(messages.hr.self[key as keyof typeof messages.hr.self], key).toBeTruthy()
      expect(messages.hr.self.onboardingColumns.summary).toBeTruthy()
      expect(messages.hr.bell.onboardingStep).toContain('{step}')
    }
  })
})

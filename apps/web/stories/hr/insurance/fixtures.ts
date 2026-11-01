import type {
  HrInsuranceDependent,
  HrInsuranceEnrollment,
  HrInsuranceOwnEnrollment,
  HrInsurancePlan,
  HrInsuranceProvider,
  HrInsuranceSettings,
} from '@liwan/contracts'

// Static fixtures for the insurance stories: no requests are made.
export const planFixture = (over: Partial<HrInsurancePlan> = {}): HrInsurancePlan => ({
  id: 3,
  provider: { id: 1, name: 'بوبا العربية' },
  name: 'الباقة الذهبية 2026',
  tier: 'ذهبية',
  policy_number: 'POL-2026-0042',
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  annual_premium: 4800,
  state: 'active',
  expires_in_days: 60,
  active: true,
  revision: 1,
  ...over,
})

export const enrollmentFixture = (over: Partial<HrInsuranceEnrollment> = {}): HrInsuranceEnrollment => ({
  id: 5,
  employee: { id: 7, name: 'ليلى الحربي' },
  member_number: 'MBR-7770001',
  date_from: '2026-02-01',
  date_to: null,
  date_end: '2026-12-31',
  state: 'active',
  employee_share: 120,
  company_share: 380,
  revision: 1,
  plan: { id: 3, provider: { id: 1, name: 'بوبا العربية' }, name: 'الباقة الذهبية 2026', tier: 'ذهبية', valid_from: '2026-01-01', valid_to: '2026-12-31' },
  dependents_count: 2,
  ...over,
})

export const dependentFixture = (over: Partial<HrInsuranceDependent> = {}): HrInsuranceDependent => ({
  id: 9,
  enrollment_id: 5,
  name: 'عمر الحربي',
  relation: 'child',
  birth_date: '2018-04-12',
  national_id_masked: '******5432',
  national_id: '1098765432',
  date_from: '2026-02-01',
  date_to: null,
  state: 'active',
  revision: 1,
  ...over,
})

export const providersFixture: HrInsuranceProvider[] = [
  { id: 1, name: 'بوبا العربية', active: true, revision: 1 },
  { id: 2, name: 'التعاونية', active: true, revision: 2 },
  { id: 3, name: 'مزوّد سابق', active: false, revision: 3 },
]

export const insuranceSettingsFixture: HrInsuranceSettings = {
  insurance_visibility: 'own_enrollment_and_dependents',
  insurance_expiry_alert_days: 60,
  insurance_require_dependent_id: false,
  revision: 1,
}

export const ownEnrollmentFixture = (over: Partial<HrInsuranceOwnEnrollment> = {}): HrInsuranceOwnEnrollment => {
  const { dependents_count: _count, ...core } = enrollmentFixture()
  return { ...core, dependents_visible: true, dependents: [dependentFixture({ national_id: null })], ...over }
}

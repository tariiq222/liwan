import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nearestStorageOption, refusalKey, STORAGE_MB_PER_GB, STORAGE_OPTIONS_MAX, storageOptions } from '../subscription'

const GB = STORAGE_MB_PER_GB
const monthly = { unit: 'month', count: 1 }
const pricePerStep = (minor: number) => [{ cadence: monthly, amount: { currency: 'SAR', exponent: 2, minor } }]

/** The seeded LiwanOS plan (schema_025 seed + schema_033 defaults): 20 GiB included, 10 GiB steps up to 100 GiB of extra,
 * then 100 GiB steps, at SAR 1.00 per step per month. */
const SEEDED = { included_storage_mb: 20 * GB, storage_step_mb: 10 * GB, storage_step_threshold_mb: 100 * GB, storage_large_step_mb: 100 * GB }

/** Option totals in GiB, the unit the customer sees. */
const totals = (options: ReturnType<typeof storageOptions>) => options.map(o => o.totalGb)

describe('storageOptions', () => {
  const seeded = storageOptions(SEEDED, pricePerStep(100), monthly)

  it('starts at the included amount with no extra storage', () => {
    expect(seeded[0]).toEqual({ storageMb: 20 * GB, extraMb: 0, totalGb: 20, extraGb: 0, amount: null })
  })

  it('offers the 10 GiB steps below the threshold: 20 GiB then 30, 40 … 120 GiB', () => {
    // The cap truncates the ascending series, so the first rows are asserted and the tail as the 100 GiB steps.
    expect(totals(seeded).slice(0, 12)).toEqual([20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 220])
    // 10 GiB of extra is the first row that costs anything, and the whole-GiB extras are multiples of the small step.
    expect(seeded.filter(o => o.extraGb >= 10 && o.extraGb < 100).map(o => o.extraGb)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90])
  })

  it('does not offer 130 GiB and does offer 200 GiB of extra', () => {
    expect(totals(seeded)).not.toContain(130)
    expect(totals(seeded)).toContain(220)
    expect(seeded.find(o => o.totalGb === 220)!.extraMb).toBe(200 * GB)
  })

  it('is ordered ascending with no duplicates', () => {
    expect([...totals(seeded)].sort((a, b) => a - b)).toEqual(totals(seeded))
    expect(new Set(totals(seeded)).size).toBe(seeded.length)
    expect(new Set(seeded.map(o => o.storageMb)).size).toBe(seeded.length)
  })

  it('follows the plan values rather than a hardcoded step: 50 GiB steps below 200 GiB, 200 GiB from there', () => {
    const custom = { included_storage_mb: 0, storage_step_mb: 50 * GB, storage_step_threshold_mb: 200 * GB, storage_large_step_mb: 200 * GB }
    const options = storageOptions(custom, pricePerStep(500), monthly)
    expect(totals(options).slice(0, 6)).toEqual([0, 50, 100, 150, 200, 400])
    expect(totals(options)).toContain(50)
    expect(totals(options)).toContain(200)
    expect(totals(options)).not.toContain(10)
  })

  it('caps the list at 20 options, never stopping before the first option at or above the threshold', () => {
    expect(STORAGE_OPTIONS_MAX).toBe(20)
    expect(seeded.length).toBeLessThanOrEqual(STORAGE_OPTIONS_MAX)
    // A 1 GiB step with a 100 GiB threshold would run to 100 rows; the cap keeps it at 20.
    const tiny = storageOptions({ included_storage_mb: 0, storage_step_mb: GB, storage_step_threshold_mb: 100 * GB, storage_large_step_mb: 10 * GB }, pricePerStep(100), monthly)
    expect(tiny.length).toBe(STORAGE_OPTIONS_MAX)
    // Under a smaller cap the 1 GiB rows fill the list before the threshold, so the large step is simply not shown yet.
    const early = storageOptions({ included_storage_mb: 0, storage_step_mb: GB, storage_step_threshold_mb: 10 * GB, storage_large_step_mb: 100 * GB }, pricePerStep(100), monthly, 5)
    expect(totals(early)).toEqual([0, 1, 2, 3, 4])
  })

  it('prices each option by what it adds, from storage_prices for the quoted cadence, and null without a row', () => {
    // storage_prices is the price per GiB, so an option that adds 10 GiB costs 10 x the unit, not the unit itself.
    expect(seeded.slice(1).every(o => o.amount?.minor === 100 * o.extraGb)).toBe(true)
    expect(seeded[1]!.amount!.minor).toBe(1000)
    expect(seeded[0]!.amount).toBeNull()
    const yearlyOnly = storageOptions(SEEDED, [{ cadence: { unit: 'year', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 1200 } }], monthly)
    expect(yearlyOnly.slice(1).every(o => o.amount === null)).toBe(true)
  })

  it('returns no options rather than a fractional quantity when the plan minimum is not whole GiB', () => {
    expect(storageOptions({ ...SEEDED, included_storage_mb: 1536 }, pricePerStep(100), monthly)).toEqual([])
    expect(storageOptions({}, pricePerStep(100), monthly)).toEqual([])
  })
})

describe('nearestStorageOption', () => {
  const options = storageOptions(SEEDED, pricePerStep(100), monthly)

  it('keeps a legal quantity and steps an illegal one up to the next option', () => {
    expect(nearestStorageOption(options, 40 * GB)!.totalGb).toBe(40)
    expect(nearestStorageOption(options, 130 * GB)!.totalGb).toBe(220)
    expect(nearestStorageOption(options, 1024)!.totalGb).toBe(20)
    // Above the list's reach there is no option to offer: never the largest, which would be a silent downgrade.
    expect(nearestStorageOption(options, 5000 * GB)).toBeNull()
    expect(nearestStorageOption(options, 1040 * GB)).toBeNull()
  })
})

describe('the change page offers only the helper’s storage options', () => {
  const page = readFileSync(new URL('../../pages/subscription/change.vue', import.meta.url), 'utf8')

  it('builds the storage select from storageOptions and sends the chosen megabytes', () => {
    expect(page).toContain("from '@/utils/subscription'")
    expect(page).toMatch(/import \{[^}]*storageOptions[^}]*\} from '@\/utils\/subscription'/)
    expect(page).toContain('storageOptions(plan.value')
    expect(page).toMatch(/<USelect v-model="storageMb"[^>]*:items="storageChoices\.map/)
    expect(page).toContain('requested_storage_mb: storageMb.value')
    expect(page).not.toContain('storageGb')
  })

  it('explains a refused storage step through the locale key instead of the generic failure', () => {
    expect(refusalKey('storage_step_invalid')).toBe('subscription.change.storageStepInvalid')
    expect(page).toContain("refusalKey(refusalCode(cause))")
    expect(page).toContain("t('subscription.change.gib')")
  })
})

describe('the storage-step message exists in both languages', () => {
  const keys = (locale: string) => JSON.parse(readFileSync(new URL(`../../../i18n/locales/${locale}/subscription.json`, import.meta.url), 'utf8')).subscription.change

  it('has the same storage keys in en and ar', () => {
    const names = ['storage', 'gib', 'storageIncluded', 'perStorage', 'perStorageNone', 'storageStepInvalid']
    for (const name of names) {
      expect(typeof keys('en')[name], `en.${name}`).toBe('string')
      expect(typeof keys('ar')[name], `ar.${name}`).toBe('string')
    }
  })
})

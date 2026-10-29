import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The fiscal editor stays inline in the existing setup card. This is a source guard, not a behaviour test:
// the behaviour rules live in the composable unit test and the mocked journeys.
// The test lives under app/pages/settings/apps/finance/__tests__; read from the app root.
const web = resolve(import.meta.dirname, '../../../../../../')
const read = (path: string) => readFileSync(resolve(web, path), 'utf8')

const PAGE = 'app/pages/settings/apps/finance/index.vue'
const COMPOSABLE = 'app/composables/finance/useFinanceSetup.ts'
const RULES = 'app/composables/finance/financeFiscalSetup.ts'

describe('the fiscal card is an inline editor in the existing page', () => {
  it('keeps the settings page, its card and its anchors', () => {
    const source = read(PAGE)
    for (const needle of ['<SharedSettingsPage', '<SharedPageHeader', 'data-testid="finance-setup-fiscal"', 'id="setup"']) {
      expect(source, needle).toContain(needle)
    }
    // No parallel screen, form or business dialog for the fiscal year.
    expect(source).not.toContain('<SharedCreatePanel')
    expect(source).not.toContain('SharedModal')
    expect(source).not.toContain('/settings/apps/finance/fiscal')
  })

  it('edits behind the manage capability only, with the approved building blocks', () => {
    const source = read(PAGE)
    expect(source).toContain("const canManage = computed(() => can('finance.setup.manage'))")
    expect(source).toContain('v-if="canManage"')
    for (const needle of ['<UForm', '<SharedFormActions', '<SharedUnsavedChanges', '<SharedPropertyRow', '<SharedPageState']) {
      expect(source, needle).toContain(needle)
    }
    expect(source).toContain('@submit="submitFiscal"')
  })

  it('offers a date field for the four locks and never an input for the hard lock', () => {
    const source = read(PAGE)
    expect(source).toContain('FINANCE_FISCAL_LOCK_FIELDS')
    expect(source).toContain('<SharedDateField')
    expect(source).toContain(':min-value="fiscalBaseline ? fiscalBaseline[field] : null"')
    expect(source).toContain('v-model="fiscalDraft[field]"')
    expect(source).not.toContain('v-model="fiscalDraft.hard_lock_date"')
    expect(source).toContain("t('finance.setup.fiscal.hard_lock_date')")
  })

  it('sends the changed fields only, and never a client company selector', () => {
    const source = read(PAGE)
    expect(source).toContain('financeFiscalDelta(fiscalDraft.value, baseline)')
    expect(source).toContain('if (!delta) return')
    expect(source).not.toContain('company_id')
    const composable = read(COMPOSABLE)
    expect(composable).toContain('financeExpectedContextHeaders(request.scope)')
    expect(composable).not.toContain('company_id')
    expect(composable).not.toMatch(/tenant|authority/i)
  })

  it('applies an answer only while the screen still shows the identity it was sent for', () => {
    const source = read(PAGE)
    // The precondition states the identity the draft was read for, captured when the draft started.
    expect(source).toContain('const target = draftScope.value')
    expect(source).toContain('sameFinanceSetupScope(draftScope.value, scope)')
    expect(source).toContain('sameFinanceSetupScope(target, setup.scope.value)')
    expect(source).toContain('discardFiscal()')
    const composable = read(COMPOSABLE)
    expect(composable).toContain('sameFinanceSetupScope(request.scope, scope.value)')
  })

  it('keeps a save in flight on the screen, whatever the shared draft guard offers', () => {
    const source = read(PAGE)
    expect(source).toContain('onBeforeRouteLeave')
    expect(source).toContain('if (!savingFiscal.value) return true')
    expect(source).toContain('finance.setup.fiscal.saving')
    expect(source).toContain(':dirty="canManage && (fiscalDirty || savingFiscal)"')
  })
})

describe('the fiscal rules own the messages the card shows', () => {
  it('maps every refusal code the card knows to a locale key that exists in both languages', () => {
    const rules = read(RULES)
    const keys = [...rules.matchAll(/'finance\.setup\.fiscal\.errors\.[a-z_]+'/g)].map(match => match[0].slice(1, -1))
    expect(keys.length).toBeGreaterThan(0)
    for (const locale of ['ar', 'en']) {
      const messages = JSON.parse(read(`i18n/locales/${locale}/finance.json`)) as { finance: { setup: { fiscal: { errors: Record<string, string> } } } }
      for (const key of new Set(keys)) {
        const short = key.replace('finance.setup.fiscal.errors.', '')
        expect(messages.finance.setup.fiscal.errors[short], `${locale}:${short}`).toBeTruthy()
      }
    }
  })

  it('keeps the Arabic and English fiscal keys in step', () => {
    const fiscal = (locale: string) => {
      const messages = JSON.parse(read(`i18n/locales/${locale}/finance.json`)) as { finance: { setup: { fiscal: Record<string, unknown> } } }
      return messages.finance.setup.fiscal
    }
    expect(Object.keys(fiscal('ar')).sort()).toEqual(Object.keys(fiscal('en')).sort())
    const errors = (locale: string) => Object.keys((fiscal(locale).errors ?? {}) as Record<string, string>).sort()
    expect(errors('ar')).toEqual(errors('en'))
    expect(errors('ar')).toContain('request_context_changed')
    expect(errors('ar')).toContain('invalid_request_context')
  })
})

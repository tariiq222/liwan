import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The fiscal editor stays an inline card of the existing setup section. This is a source guard, not a behaviour test:
// the behaviour rules live in the composable unit test and the card flow test.
// The test lives under app/pages/settings/apps/finance/__tests__; read from the app root.
const web = resolve(import.meta.dirname, '../../../../../../')
const read = (path: string) => readFileSync(resolve(web, path), 'utf8')

const PAGE = 'app/pages/settings/apps/finance/index.vue'
const CARD = 'app/components/finance/FiscalSetupCard.vue'
const COMPOSABLE = 'app/composables/finance/useFinanceSetup.ts'
const RULES = 'app/composables/finance/financeFiscalSetup.ts'

describe('the fiscal card is an inline card in the existing page', () => {
  it('keeps the settings page, its section anchor and the card', () => {
    const page = read(PAGE)
    for (const needle of ['<SharedSettingsPage width="form"', '<SharedPageHeader', 'id="setup"', '<FiscalSetupCard']) {
      expect(page, needle).toContain(needle)
    }
    const card = read(CARD)
    for (const needle of ['id="setup-fiscal"', 'data-testid="finance-setup-fiscal"']) {
      expect(card, needle).toContain(needle)
    }
    // No parallel screen, form or business dialog for the fiscal year.
    for (const source of [page, card]) {
      expect(source).not.toContain('<SharedCreatePanel')
      expect(source).not.toContain('SharedModal')
      expect(source).not.toContain('/settings/apps/finance/fiscal')
    }
  })

  it('edits behind the manage capability only, through the shared settings card; a viewer sees the same disabled fields', () => {
    expect(read(PAGE)).toContain("const canManage = computed(() => can('finance.setup.manage'))")
    expect(read(PAGE)).toContain(':can-edit="canManage"')
    const card = read(CARD)
    for (const needle of ['<SharedSettingsCard', 'useSettingsForm', '@save="submit"', ':disabled="locked"', '!props.canEdit']) {
      expect(card, needle).toContain(needle)
    }
    expect(card).not.toContain('<SharedPropertiesPanel')
    expect(card).not.toContain('<SharedFormActions')
  })

  it('offers a date field for the four locks and never an input for the hard lock', () => {
    const card = read(CARD)
    expect(card).toContain('FINANCE_FISCAL_LOCK_FIELDS')
    expect(card).toContain('<SharedDateField')
    expect(card).toContain(':min-value="baseline[field]"')
    expect(card).toContain('v-model="draft[field]"')
    expect(card).not.toContain('v-model="draft.hard_lock_date"')
    expect(card).toContain("t('finance.setup.fiscal.hard_lock_date')")
  })

  it('sends the changed fields only, and never a client company selector', () => {
    const card = read(CARD)
    expect(card).toContain('financeFiscalDelta(values, financeFiscalDraftFromValues(latest.fiscal))')
    expect(card).toContain('if (!delta) return latest')
    expect(card).not.toContain('company_id')
    const composable = read(COMPOSABLE)
    expect(composable).toContain('financeExpectedContextHeaders(request.scope)')
    expect(composable).not.toContain('company_id')
    expect(composable).not.toMatch(/tenant|authority/i)
  })

  it('applies an answer only while the screen still shows the identity it was sent for', () => {
    // The page mounts the card again for another identity; the write states the identity the card was made for.
    expect(read(PAGE)).toContain(':key="financeSetupScopeToken(fiscalScope)"')
    const card = read(CARD)
    expect(card).toContain('saveFiscal({ delta, scope: props.scope })')
    expect(card).toContain('sameFinanceSetupScope(props.scope, readScope())')
    expect(read(COMPOSABLE)).toContain('sameFinanceSetupScope(request.scope, scope.value)')
  })

  it('keeps a save in flight on the screen, whatever the shared draft guard offers', () => {
    expect(read(CARD)).toContain('onBeforeRouteLeave(() => !state.value.saving)')
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

describe('the transfer account is a field of the same card', () => {
  it('offers reconcilable current assets only, shows the saved account and follows the draft rules', () => {
    const card = read(CARD)
    for (const needle of [
      '<AccountPicker',
      'v-model="draft.transfer_account_id"',
      'account-type="asset_current"',
      ':allow="isTransferAccount"',
      ':selected-label="setup.fiscal.transfer_account?.name"',
      "account.reconcile && account.account_type === 'asset_current'",
      "fieldMessage('transfer_account_id')",
    ]) expect(card, needle).toContain(needle)
    expect(read(RULES)).toContain('transfer_account_id')
  })
})

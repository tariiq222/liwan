import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { errorCode, errorSeconds, normalizeCode } from '../../components/auth/loginFlow'
import { normalizeMobileInput } from '../../composables/useMe'
import { signupOfferTotals, type SignupOffer } from '../../utils/subscription'
import { suggestWorkspaceSlug, workspaceSlugShapeOk } from '../../utils/workspaceSlug'
import ar from '../../../i18n/locales/ar/signup.json'
import en from '../../../i18n/locales/en/signup.json'

// The page's script is compiled in place with its Nuxt bindings injected, as the other page suites do.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const pageSource = readFileSync(resolve(import.meta.dirname, '../register.vue'), 'utf8')
const current = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01', human_check: { site_key: 'site-key-fixture', script_url: 'https://widget.example.test/api.js' } }
const person = { company_name: 'شركة', admin_name: 'مدير', email: 'owner@company.sa', mobile: '0555555555', slug: 'acme' }
const defaultOffer: SignupOffer = {
  offer_revision: '00000000-0000-4000-8000-000000000001',
  plan_name: 'Starter',
  trial_days: 14,
  currency: 'SAR',
  currency_exponent: 2,
  base_monthly_minor: 0,
  tax: { kind: 'none' },
  included_users: 3,
  included_storage_mb: 20480,
  included_extra_branches: 1,
  included_apps: [],
  apps: [
    { id: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly_minor: 9900, limits: {} },
    { id: 'inbox', name_ar: 'رسائل العملاء', name_en: 'Customer Messages', monthly_minor: 25000, limits: { 'inbox.channels': 2, 'inbox.messages_out': 1000, 'inbox.campaign_recipients': null } },
  ],
}

function resolveLocaleKey(tree: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
}

function mount(fetch: ReturnType<typeof vi.fn>, language = 'ar') {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(pageSource, { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-terms' }).content).replace('export default', 'return')
  const mounted: Array<() => unknown> = []
  const localeTree = (language === 'en' ? en : ar) as unknown as Record<string, unknown>
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput, signupOfferTotals, suggestWorkspaceSlug, workspaceSlugShapeOk, onBeforeUnmount: () => {},
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: (fn: () => unknown) => mounted.push(fn),
    reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const raw = resolveLocaleKey(localeTree, key)
        if (typeof raw !== 'string') return key
        return params ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : raw
      },
      te: (key: string) => typeof resolveLocaleKey(localeTree, key) === 'string',
      locale: Vue.ref(language),
      setLocale: () => {},
    }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  Object.assign(state.details, person)
  state.offer.value = defaultOffer
  state.selectedApps.value = defaultOffer.apps.map(app => app.id)
  // The address check runs on a timer the tests do not drive; the address is taken as checked and free.
  state.slugState.value = 'available'
  return { state, mounted }
}

describe('register page, terms acceptance', () => {
  it('refuses the form until the box is ticked', () => {
    const { state } = mount(vi.fn())
    expect(state.validateDetails({ ...person, accept_terms: false }).map((p: { name: string }) => p.name)).toEqual(['accept_terms'])
    expect(state.validateDetails({ ...person, slug: 'a--b', accept_terms: true }).map((p: { name: string }) => p.name)).toEqual(['slug'])
    expect(state.validateDetails({ ...person, accept_terms: true })).toEqual([])
  })

  it('loads the current terms on mount and links the legal pages in the visitor language', async () => {
    // No signup to resume: the status call answers not_found and the page loads the form.
    const fetch = vi.fn((url: string) => url.endsWith('/status')
      ? Promise.reject({ data: { code: 'not_found' } })
      : url.endsWith('/offer') ? Promise.resolve(defaultOffer) : Promise.resolve(current))
    const arabic = mount(fetch)
    await arabic.mounted[0]!()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/terms', { method: 'POST', body: {} })
    expect(arabic.state.termsUrl.value).toBe('https://legal.example.test/terms')
    expect(arabic.state.privacyUrl.value).toBe('https://legal.example.test/privacy')
    const english = mount(fetch, 'en')
    await english.mounted[0]!()
    expect(english.state.termsUrl.value).toBe('https://legal.example.test/en/terms')
    expect(english.state.privacyUrl.value).toBe('https://legal.example.test/en/privacy')
  })

  it('sends the acceptance with the version the page showed, and nothing without it', async () => {
    const fetch = vi.fn().mockResolvedValue({ signup_id: 'id' })
    const { state } = mount(fetch)
    state.legal.value = current
    state.humanToken.value = 'tok'
    // The address watcher runs after the fixture set it; the check it starts is settled as free here.
    await Vue.nextTick()
    state.slugState.value = 'available'
    await state.submitDetails()
    expect(fetch).not.toHaveBeenCalled()
    state.details.accept_terms = true
    await state.submitDetails()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', { method: 'POST', body: expect.objectContaining({ accept_terms: true, terms_version: '2026-11-01' }) })
  })

  it('reloads the current terms and asks again when the vendor changed them', async () => {
    const changed = { legal_base_url: 'https://legal.example.test', terms_version: '2026-12-01' }
    const fetch = vi.fn().mockRejectedValueOnce({ data: { code: 'terms_changed' } }).mockResolvedValue(changed)
    const { state } = mount(fetch)
    state.legal.value = current
    state.humanToken.value = 'tok'
    state.details.accept_terms = true
    await state.submitDetails()
    expect(state.legal.value).toEqual(changed)
    expect(state.details.accept_terms).toBe(false)
    expect(state.errorKey.value).toBe('signup.errors.termsChanged')
  })

  it('sends the monthly offer and only the applications the visitor selected', async () => {
    const fetch = vi.fn().mockResolvedValue({ signup_id: 'id' })
    const { state } = mount(fetch)
    state.legal.value = current
    state.humanToken.value = 'tok'
    state.details.accept_terms = true
    state.offer.value = { ...defaultOffer, offer_revision: 'test-revision' }
    state.selectedApps.value = ['crm']
    await state.submitDetails()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', {
      method: 'POST', body: expect.objectContaining({ offer_revision: 'test-revision', app_ids: ['crm'], slug: 'acme' }),
    })
  })

  it('words the checkbox and its refusals in both languages', () => {
    for (const locale of [ar, en]) {
      for (const key of ['acceptTerms', 'termsLink', 'privacyLink']) expect(locale.signup[key as 'acceptTerms'], key).toBeTruthy()
      for (const key of ['termsRequired', 'termsChanged']) expect(locale.signup.errors[key as 'termsRequired'], key).toBeTruthy()
      expect(locale.signup.acceptTerms).toContain('{terms}')
      expect(locale.signup.acceptTerms).toContain('{privacy}')
    }
  })
})

describe('register page, dynamic signup offer', () => {
  const dynamicOffer: SignupOffer = {
    offer_revision: '00000000-0000-4000-8000-000000000010',
    plan_name: 'Growth',
    trial_days: 30,
    currency: 'SAR',
    currency_exponent: 2,
    base_monthly_minor: 15000,
    tax: { kind: 'vat_exclusive', rate_bps: 1500 },
    included_users: 5,
    included_storage_mb: 30720,
    included_extra_branches: 2,
    included_apps: [
      { id: 'projects', name_ar: 'المشاريع', name_en: 'Projects', limits: { 'projects.max_projects': 50 } },
    ],
    apps: [
      { id: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly_minor: 9900, limits: {} },
      { id: 'inbox', name_ar: 'رسائل العملاء', name_en: 'Customer Messages', monthly_minor: 25000, limits: { 'inbox.channels': 3, 'inbox.messages_out': null, 'unknown.metric': 7 } },
      { id: 'finance', name_ar: 'المالية', name_en: 'Finance', monthly_minor: 19900, limits: {} },
      { id: 'helpdesk', name_ar: 'الدعم الفني', name_en: 'Helpdesk', monthly_minor: 12000, limits: {} },
    ],
  }

  it('defaults to all dynamic optional apps on initial load and preserves the intersection on offer_changed', async () => {
    const revisedOffer: SignupOffer = {
      ...dynamicOffer,
      offer_revision: '00000000-0000-4000-8000-000000000011',
      apps: dynamicOffer.apps.filter(app => app.id !== 'inbox'),
    }
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/status')) return Promise.reject({ data: { code: 'not_found' } })
      if (url.endsWith('/terms')) return Promise.resolve(current)
      if (url.endsWith('/offer')) return Promise.resolve(fetch.mock.calls.filter(([u]) => String(u).endsWith('/offer')).length === 1 ? dynamicOffer : revisedOffer)
      if (url.endsWith('/start')) return Promise.reject({ data: { code: 'offer_changed' } })
      return Promise.resolve({})
    })
    const { state, mounted } = mount(fetch)
    await mounted[0]!()
    expect(state.selectedApps.value).toEqual(['crm', 'inbox', 'finance', 'helpdesk'])

    // Visitor keeps only crm + inbox, then hits offer_changed where inbox was removed.
    state.selectedApps.value = ['crm', 'inbox']
    state.humanToken.value = 'tok'
    state.details.accept_terms = true
    state.slugState.value = 'available'
    await state.submitDetails()
    expect(state.errorKey.value).toBe('signup.errors.offerChanged')
    expect(state.offer.value?.offer_revision).toBe(revisedOffer.offer_revision)
    expect(state.selectedApps.value).toEqual(['crm'])
  })

  it('allows submitting with zero optional apps when the offer includes apps or a base price, and blocks otherwise', async () => {
    const fetch = vi.fn().mockResolvedValue({ signup_id: 'id' })
    const { state } = mount(fetch)
    state.legal.value = current
    state.humanToken.value = 'tok'
    state.details.accept_terms = true
    await Vue.nextTick()
    state.slugState.value = 'available'

    // Free base + no included apps + optional apps -> empty selection is blocked.
    state.offer.value = defaultOffer
    state.selectedApps.value = []
    expect(state.canSubmitApps.value).toBe(false)
    await state.submitDetails()
    expect(fetch).not.toHaveBeenCalled()

    // Offer with included apps + base price -> empty optional selection is allowed.
    state.offer.value = dynamicOffer
    state.selectedApps.value = []
    expect(state.canSubmitApps.value).toBe(true)
    await state.submitDetails()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', {
      method: 'POST',
      body: expect.objectContaining({ offer_revision: dynamicOffer.offer_revision, app_ids: [] }),
    })
  })

  it('computes base + apps + VAT totals, formats limits generically, and localizes app names', () => {
    const arPage = mount(vi.fn(), 'ar').state
    arPage.offer.value = dynamicOffer
    arPage.selectedApps.value = ['crm', 'finance']
    // 15000 + 9900 + 19900 = 44800; 15% VAT = 6720; total = 51520.
    expect(arPage.offerTotals.value).toEqual({
      subtotalMinor: 44800,
      taxMinor: 6720,
      totalMinor: 51520,
      requiresAppSelection: false,
    })
    expect(arPage.vatRate.value).toBe('15')
    expect(arPage.appName(dynamicOffer.included_apps[0]!)).toBe('المشاريع')
    expect(arPage.appLimitEntries(dynamicOffer.apps[1]!.limits)).toEqual([
      { key: 'inbox.channels', label: 'القنوات: 3' },
      { key: 'inbox.messages_out', label: 'الرسائل الصادرة في الشهر بالتوقيت العالمي المنسّق: بلا حد' },
    ])
    expect(arPage.appLimitEntries(dynamicOffer.included_apps[0]!.limits)).toEqual([
      { key: 'projects.max_projects', label: 'المشاريع: 50' },
    ])

    const enPage = mount(vi.fn(), 'en').state
    enPage.offer.value = dynamicOffer
    expect(enPage.appName(dynamicOffer.included_apps[0]!)).toBe('Projects')
    expect(enPage.appLimitEntries(dynamicOffer.included_apps[0]!.limits)).toEqual([
      { key: 'projects.max_projects', label: 'Projects: 50' },
    ])
  })

  it('parameterizes trial_days, base price, included apps, and VAT note in template and both locales', () => {
    expect(pageSource).toContain("v-if=\"step === 'details' && offer\"")
    expect(pageSource).toContain("t('signup.trial', { days: quantity.format(offer.trial_days) })")
    expect(pageSource).toContain('data-testid="offer-base-price"')
    expect(pageSource).toContain('data-testid="offer-vat-note"')
    expect(pageSource).toContain('offer.included_apps.length')
    expect(pageSource).not.toContain('inboxLimits')
    expect(pageSource).not.toContain('@liwan/commercial-contracts')
    for (const locale of [ar, en]) {
      expect(locale.signup.trial).toContain('{days}')
      expect(locale.signup.trial).not.toContain('14')
      expect(locale.signup.offer.includedApps).toBeTruthy()
      expect(locale.signup.offer.basePrice).toContain('{price}')
      expect(locale.signup.offer.vatNote).toContain('{rate}')
      expect(locale.signup.offer.vatNote).toContain('{tax}')
      expect(locale.signup.offer.limits.projects_max_projects).toContain('{count}')
      expect(locale.signup.offer.limits.inbox_channels).toContain('{count}')
      expect(locale.signup.offer.apps.projects.description).toBeTruthy()
      expect(locale.signup.offer.apps.people.description).toBeTruthy()
      expect(locale.signup.offer.apps.finance.description).toBeTruthy()
    }
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { loadSfc } from '../components/__tests__/sfc'

const root = resolve(import.meta.dirname, '../..')
const customerPage = readFileSync(resolve(root, 'app/pages/customers/[id].vue'), 'utf8')

function errorPage(status: number, capabilities: string[]) {
  const bindings = {
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en'), localeProperties: Vue.ref({ dir: 'ltr' }) }),
    useAppearanceHtmlClass: () => {}, useHead: () => {}, clearError: () => {},
    htmlAttrsFor: () => ({}), ar: {}, en: {},
    useVendorContextState: () => ({ can: (capability: string) => capabilities.includes(capability) }),
  }
  return loadSfc('error.vue', bindings).html({ error: { statusCode: status } })
}

describe('the error page', () => {
  it('offers a way back after a refused page to an account that can open the home page', async () => {
    expect(await errorPage(403, ['vendor.read'])).toContain('app.error.home')
  })
  it('does not offer it to an account without any role, or while the service is down', async () => {
    expect(await errorPage(403, [])).not.toContain('app.error.home')
    expect(await errorPage(503, ['vendor.read'])).not.toContain('app.error.home')
  })
})

describe('the audit link on the customer page', () => {
  it('shows only with the audit capability', () => {
    expect(customerPage).toContain("const canAudit = computed(() => can('vendor.audit.read'))")
    expect(customerPage).toContain('<SharedRecordSection v-if="canAudit" variant="panel" :title="t(\'vendor.customers.sections.audit\')"')
  })
})

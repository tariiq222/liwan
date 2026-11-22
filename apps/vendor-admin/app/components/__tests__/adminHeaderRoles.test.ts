import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ref } from 'vue'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

/** The header with the real app messages of one language and a person holding two roles. */
async function header(lang: 'ar' | 'en') {
  const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${lang}/app.json`), 'utf8'))
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)
  const page = await mountPage('../components/AdminHeader.vue', {
    useI18n: () => ({ t: (key: string) => String(lookup(key) ?? key), te: (key: string) => typeof lookup(key) === 'string', locale: ref(lang), locales: ref([]) }),
    useAdminSession: () => ({ me: ref({ display_name: 'Sara', roles: ['owner', 'support'] }), signOut: () => {} }),
    usePageHeaderTitle: () => ref(null), useRoute: () => ({ path: '/overview' }), useLocalePreference: () => ({ choose: () => {} }),
    useAppearance: () => ({ mode: ref('light'), setMode: () => {} }),
    adminCrumbs: () => [], catalogTabOf: () => null,
  })
  mounted.push(page)
  return page
}

it.each([['en', 'Platform owner, Support'], ['ar', 'مالك المنصة، الدعم الفني']] as const)('separates the roles of %s with the list separator of that language', async (lang, expected) => {
  const page = await header(lang)
  expect(page.state.roleNames.value).toBe(expected)
})

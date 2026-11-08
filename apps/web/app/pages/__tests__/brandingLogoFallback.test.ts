import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Customers must never see Odoo's stock logo: without a company logo the API sends `logo_url: null`.
// A source guard, like the other page template tests.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('branding without a logo', () => {
  it('login shows the tenant logo only when logo_url is set, and always the white LiwanOS wordmark on the brand surface', () => {
    const source = read('pages/login.vue')
    expect(source).toContain('v-if="branding?.logo_url"')
    expect(source).toContain('surface="brand"')
    expect(source).toContain('<SharedBrandWordmark size="xl" inverted')
    expect(source).toContain("'sr-only': !branding?.name")
  })

  it('the meeting print page guards on logo_url', () => {
    expect(read('pages/meetings/[id]/print.vue')).toContain('v-if="branding?.logo_url"')
  })

  it('the sidebar organisation card draws a logo only when the tenant has one, and its initial otherwise', () => {
    expect(read('components/shell/AppSidebar.vue')).toContain(':logo-url="branding?.logo_url"')
    const card = readFileSync(resolve(app, '../../../packages/ui/app/components/shell/ShellOrgCard.vue'), 'utf8')
    expect(card).toContain('v-if="props.logoUrl"')
    expect(card).toContain('v-else data-slot="initial"')
  })
})

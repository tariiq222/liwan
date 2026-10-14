import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Customers must never see Odoo's stock logo: without a company logo the API sends `logo_url: null`.
// A source guard, like the other page template tests.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('branding without a logo', () => {
  it('login shows the logo only when logo_url is set and falls back to the Nasq wordmark', () => {
    const source = read('pages/login.vue')
    expect(source).toContain('v-if="branding?.logo_url"')
    expect(source).toContain('<SharedBrandWordmark v-else')
  })

  it.each(['components/shell/ShellHeader.vue', 'pages/meetings/[id]/print.vue'])('%s guards on logo_url', (file) => {
    expect(read(file)).toContain('v-if="branding?.logo_url"')
  })
})

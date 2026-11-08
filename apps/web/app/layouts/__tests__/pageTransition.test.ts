import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Route changes swap only the page inside <main>: Nuxt's pageTransition owns the motion (its `.liwan-page-*` CSS is in
// packages/ui/app/assets/css/layout.css), and nothing wraps or keys the shell on the route, so the sidebar, the top bar
// and the tab bar keep their DOM nodes while the user moves between pages.
const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('page transition ownership', () => {
  it('configures one page transition named liwan-page, out then in', () => {
    expect(read('nuxt.config.ts')).toMatch(/pageTransition: \{ name: 'liwan-page', mode: 'out-in' \}/)
    expect(read('nuxt.config.ts')).not.toMatch(/layoutTransition/)
  })

  it('has no second mechanism in the layout', () => {
    const layout = read('app/layouts/default.vue')
    expect(layout).not.toMatch(/liwan-page-content-motion|pageMotion|requestAnimationFrame/)
  })
})

describe('the shell stays mounted across navigation', () => {
  it('keys nothing in the layout template', () => {
    const template = read('app/layouts/default.vue').match(/<template>([\s\S]*)<\/template>/)![1]!
    expect(template).not.toMatch(/:key=|\skey=/)
    expect(template).toContain('data-testid="shell-main"')
  })

  it('keys the layout on the session only, never on the route', () => {
    const app = read('app/app.vue')
    expect(app).toContain('<NuxtLayout :key="viewKey">')
    const viewKey = app.match(/const viewKey = computed\(([^\n]*)\)/)![1]!
    expect(viewKey).not.toMatch(/route\.(path|fullPath|params|query)/)
    expect(app).not.toMatch(/<NuxtPage[^>]*(:key|page-key)/)
  })
})

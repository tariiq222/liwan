import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Route changes swap only the page inside <main>: the default layout replays a CSS entrance (`.liwan-page-enter` in
// packages/ui/app/assets/css/layout.css) on <main>, and nothing wraps or keys the shell on the route, so the sidebar, the top bar
// and the tab bar keep their DOM nodes while the user moves between pages.
const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('page transition ownership', () => {
  it('has no Vue page transition, which cannot animate a page whose root is a fragment', () => {
    expect(read('nuxt.config.ts')).not.toMatch(/pageTransition|layoutTransition/)
  })

  it('replays the CSS entrance on <main> when the path changes, with no second mechanism', () => {
    const layout = read('app/layouts/default.vue')
    expect(layout).toContain("classList.add('liwan-page-enter')")
    expect(layout).toMatch(/watch\(\(\) => route\.path, \(\) => \{\s*replayPageEnter\(\)/)
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

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
const component = resolve(__dirname, '../LauncherCard.vue')
const entry = { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder', to: '/projects', actions: [] }
const messages = { 'nav.projects': 'المشاريع', 'launcher.open': 'فتح التطبيق', 'launcher.actions': 'إجراءات سريعة', 'nav.newProject': 'مشروع جديد' }

describe('LauncherCard', () => {
  it('opens the app and describes it, including for a reader without actions', async () => {
    const html = await renderShared(component, { entry, description: 'وصف' }, {}, { messages })
    expect(html).toContain('>المشاريع</h2>')
    expect(html).toContain('>وصف</p>')
    expect(html).toMatch(/data-testid="launcher-open"[^>]*href="\/projects"|href="\/projects"[^>]*data-testid="launcher-open"/)
    expect(html).not.toContain('launcher-action"')
    expect(html).not.toContain('aria-pressed')
  })
  it('links the provided actions to their existing routes and keeps a return path', async () => {
    const action = { id: 'new', labelKey: 'nav.newProject', icon: 'i-lucide-plus', to: '/projects/new' }
    const html = await renderShared(component, { entry: { ...entry, actions: [action] } }, {}, { messages })
    expect(html).toContain('>مشروع جديد</a>')
    expect(html).toContain('data-testid="launcher-action"')
    expect(html).toContain('aria-label="إجراءات سريعة"')
  })
})

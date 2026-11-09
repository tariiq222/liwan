import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../LauncherRow.vue')
const UTooltip = Vue.defineComponent({ props: { text: { type: String, default: '' } }, setup: (_, { slots }) => () => Vue.h('span', slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h(props.to ? 'a' : 'button', { ...attrs, href: props.to || undefined }, slots.default?.()) })
const card = (extra: Record<string, unknown> = {}) => ({ id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder', to: '/projects', pinnable: true, category: 'team', plan: 'addon', surface: 'indigo', figures: [], ...extra })
const messages = { 'nav.projects': 'المشاريع', 'launcher.open': 'فتح التطبيق', 'launcher.openShort': 'فتح', 'launcher.pin': 'تثبيت', 'launcher.unpin': 'إزالة', 'launcher.pinLimit': 'الحد' }
const render = (props: Record<string, unknown>) => renderShared(component, props, {}, { messages, stubs: { ...DEFAULT_STUBS, UTooltip, UButton } })

describe('LauncherRow', () => {
  it('opens the app with a short button whose name still says what it opens, and describes it', async () => {
    const html = await render({ card: card(), description: 'وصف' })
    expect(html).toContain('>المشاريع</h3>')
    expect(html).toContain('>وصف</p>')
    expect(html).toMatch(/aria-label="فتح التطبيق: المشاريع"[^>]*>فتح</)
    expect(html).toContain('href="/projects"')
  })

  it('draws the application icon as an identity tile scoped by its id', async () => {
    const html = await render({ card: card() })
    expect(html).toContain('data-app="projects"')
    expect(html).toContain('liwan-app-tile')
  })

  it('has a pin that says whether it is pinned, and is disabled at the limit', async () => {
    const free = await render({ card: card() })
    expect(free).toContain('aria-label="تثبيت: المشاريع"')
    expect(free).toMatch(/aria-pressed="false"/)
    const pinned = await render({ card: card(), pinned: true })
    expect(pinned).toContain('aria-label="إزالة: المشاريع"')
    expect(pinned).toMatch(/aria-pressed="true"/)
    expect(await render({ card: card(), pinDisabled: true })).toContain('disabled')
  })

  it('has no pin for an application the sidebar always shows', async () => {
    expect(await render({ card: card({ pinnable: false }) })).not.toContain('launcher-pin')
  })
})

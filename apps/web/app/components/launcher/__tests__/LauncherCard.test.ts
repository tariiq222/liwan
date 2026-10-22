import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@webvue/ui/test/helpers/renderShared'
import type { LauncherEntry } from '../../../composables/nav/launcherModel'

const component = resolve(__dirname, '../LauncherCard.vue')
const entry = (extra: Partial<LauncherEntry> = {}): LauncherEntry => ({
  id: 'finance', labelKey: 'nav.finance', icon: 'i-lucide-landmark', to: '/finance', overviewTo: '/apps/finance', pinnable: true, pinned: false, pinIndex: null, ...extra,
})
const messages = {
  'nav.finance': 'المالية', 'launcher.pin': 'تثبيت في الشريط', 'launcher.pinned': 'مثبّت',
  'launcher.open': 'فتح التطبيق', 'launcher.overview': 'نظرة عامة', 'launcher.order': 'ترتيب',
  'launcher.moveEarlier': 'تقديم {name}', 'launcher.moveLater': 'تأخير {name}',
}
const render = (props: Record<string, unknown>) => renderShared(component, { description: 'وصف', pinnedCount: 3, ...props }, {}, { messages })

describe('LauncherCard', () => {
  it('shows the name, the description, a primary link to the landing path and a link to the start page', async () => {
    const html = await render({ entry: entry() })
    expect(html).toContain('>المالية</h2>')
    expect(html).toContain('>وصف</p>')
    expect(html).toMatch(/data-testid="launcher-open"[^>]*href="\/finance"|href="\/finance"[^>]*data-testid="launcher-open"/)
    expect(html).toMatch(/data-testid="launcher-overview"[^>]*href="\/apps\/finance"|href="\/apps\/finance"[^>]*data-testid="launcher-overview"/)
  })

  it('has a real pin button with aria-pressed, and no pill or order controls while unpinned', async () => {
    const html = await render({ entry: entry() })
    expect(html).toMatch(/<button[^>]*data-testid="launcher-pin"/)
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('تثبيت في الشريط')
    expect(html).not.toContain('launcher-pinned-pill')
    expect(html).not.toContain('launcher-move')
  })

  it('keeps one name on the pin button and says the state with aria-pressed, plus the pill and the order group when pinned', async () => {
    const html = await render({ entry: entry({ pinned: true, pinIndex: 1 }) })
    expect(html).toContain('aria-pressed="true"')
    expect(html.match(/تثبيت في الشريط/g)).toHaveLength(1)
    expect(html).not.toContain('إلغاء')
    expect(html).toContain('>مثبّت</span>')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="ترتيب"')
    expect(html).toContain('aria-label="تقديم المالية"')
    expect(html).toContain('aria-label="تأخير المالية"')
  })

  it('marks the first pin\'s earlier button and the last pin\'s later button aria-disabled, and keeps them focusable', async () => {
    const aria = (html: string, testid: string) => new RegExp(`aria-disabled="true"[^>]*data-testid="${testid}"|data-testid="${testid}"[^>]*aria-disabled="true"`).test(html)
    const first = await render({ entry: entry({ pinned: true, pinIndex: 0 }) })
    expect(aria(first, 'launcher-move-earlier')).toBe(true)
    expect(aria(first, 'launcher-move-later')).toBe(false)
    const last = await render({ entry: entry({ pinned: true, pinIndex: 2 }) })
    expect(aria(last, 'launcher-move-later')).toBe(true)
    expect(last).not.toMatch(/<button[^>]*\sdisabled[^>]*data-testid="launcher-move/)
  })

  it('has no pin button for an application that is always in the rail', async () => {
    expect(await render({ entry: entry({ pinnable: false }) })).not.toContain('launcher-pin"')
  })

  it('waits for hydration before the pin controls act', async () => {
    const html = await render({ entry: entry({ pinned: true, pinIndex: 1 }), disabled: true })
    expect(html.match(/disabled=""|\sdisabled(?=[\s>])/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

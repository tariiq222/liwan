import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../AppUserMenu.vue')
const messages = {
  'nav.userMenu.label': 'قائمة المستخدم', 'nav.userMenu.account': 'حسابي', 'nav.userMenu.darkMode': 'الوضع الداكن',
  'nav.logout': 'تسجيل الخروج', 'bus.connected': 'متصل', 'bus.disconnected': 'غير متصل', 'account.logoutFailed': 'تعذر إنهاء الجلسة',
}

interface Item { type?: string, label?: string, to?: string, icon?: string, color?: string, checked?: boolean, class?: string, onSelect?: (event: Event) => void, onUpdateChecked?: (checked: boolean) => void }

// The dropdown is a Nuxt UI primitive: the stub keeps the items the component hands it and renders only the trigger.
function setup(over: { mode?: string, role?: boolean, signedOut?: boolean, signOutResult?: boolean, hydrated?: boolean } = {}) {
  const captured: { items: Item[][] } = { items: [] }
  const setMode = vi.fn()
  const choose = vi.fn()
  const signOut = vi.fn(async () => over.signOutResult ?? true)
  const toast = { add: vi.fn() }
  const UDropdownMenu = Vue.defineComponent({
    inheritAttrs: false,
    props: { items: { type: Array, default: () => [] } },
    setup(props, { slots }) {
      return () => { captured.items = props.items as Item[][]; return Vue.h('div', { 'data-menu': '' }, slots.default?.()) }
    },
  })
  const me = Vue.ref(over.signedOut ? null : { name: 'سارة العتيبي', roles: over.role === false ? [] : [{ name: { ar: 'مديرة المبيعات', en: 'Sales manager' } }] })
  const render = () => renderShared(component, {}, {}, {
    hydrated: over.hydrated ?? true,
    messages,
    stubs: { UDropdownMenu },
    globals: { useMe: () => ({ me }), useBus: () => ({ connected: Vue.ref(true) }), useToast: () => toast },
    modules: {
      '@/composables/useAppearance': { useAppearance: () => ({ mode: Vue.ref(over.mode ?? 'light'), setMode }) },
      '@/composables/useLocaleChoice': { useLocaleChoice: () => ({ other: Vue.ref({ code: 'en', name: 'English' }), choose }) },
      '@/composables/useSignOut': { useSignOut: () => signOut },
    },
  })
  return { captured, setMode, choose, signOut, toast, render }
}
const flat = (items: Item[][]) => items.flat()
const find = (items: Item[][], label: string) => flat(items).find(item => item.label === label)!

describe('AppUserMenu trigger', () => {
  it('is the account button: avatar initial, name, role, chevron and the connection dot', async () => {
    const { render } = setup()
    const html = await render()
    expect(html).toContain('data-testid="account-menu"')
    expect(html).toContain('aria-label="قائمة المستخدم: سارة العتيبي"')
    expect(html).toContain('>س<')
    expect(html).toContain('data-slot="name">سارة العتيبي<')
    expect(html).toContain('data-slot="caption">مديرة المبيعات<')
    expect(html).toContain('data-connected="true"')
    expect(html).toContain('title="متصل"')
  })

  it('shows the name alone for a person without a role, and is disabled with no dot before hydration', async () => {
    const html = await setup({ role: false, hydrated: false }).render()
    expect(html).not.toContain('data-slot="caption"')
    expect(html).toMatch(/<button[^>]*disabled/)
    expect(html).not.toContain('data-slot="status"')
  })
})

describe('AppUserMenu items', () => {
  it('lists the name and role, then my account, the dark switch and the language, then sign out', async () => {
    const { captured, render } = setup()
    await render()
    expect(captured.items.map(group => group.map(item => item.label))).toEqual([
      ['سارة العتيبي', 'مديرة المبيعات'],
      ['حسابي'],
      ['الوضع الداكن', 'English'],
      ['تسجيل الخروج'],
    ])
    expect(find(captured.items, 'حسابي')).toMatchObject({ to: '/account', icon: 'i-lucide-user-round' })
    expect(find(captured.items, 'تسجيل الخروج')).toMatchObject({ color: 'error', icon: 'i-lucide-log-out' })
  })

  it('offers no company switch: the product has one company per session', async () => {
    const { captured, render } = setup()
    await render()
    expect(flat(captured.items).map(item => item.icon)).not.toContain('i-lucide-building-2')
  })

  it('the dark item is a checkbox that reflects and flips the colour mode', async () => {
    const light = setup()
    await light.render()
    const toggle = find(light.captured.items, 'الوضع الداكن')
    expect(toggle).toMatchObject({ type: 'checkbox', checked: false })
    toggle.onUpdateChecked!(true)
    expect(light.setMode).toHaveBeenCalledWith('dark')
    const dark = setup({ mode: 'dark' })
    await dark.render()
    const on = find(dark.captured.items, 'الوضع الداكن')
    expect(on.checked).toBe(true)
    on.onUpdateChecked!(false)
    expect(dark.setMode).toHaveBeenCalledWith('light')
  })

  it('keeps the menu open when the dark switch is picked, so the change is seen in place', async () => {
    const { captured, render } = setup()
    await render()
    const event = { preventDefault: vi.fn() } as unknown as Event
    find(captured.items, 'الوضع الداكن').onSelect!(event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('the language item names the other language and switches to it', async () => {
    const { captured, choose, render } = setup()
    await render()
    find(captured.items, 'English').onSelect!(new Event('select'))
    expect(choose).toHaveBeenCalledWith('en')
  })

  it('signs out through the shared flow and reports a failure with a toast', async () => {
    const ok = setup()
    await ok.render()
    find(ok.captured.items, 'تسجيل الخروج').onSelect!(new Event('select'))
    await Vue.nextTick()
    expect(ok.signOut).toHaveBeenCalledTimes(1)
    expect(ok.toast.add).not.toHaveBeenCalled()

    const failed = setup({ signOutResult: false })
    await failed.render()
    find(failed.captured.items, 'تسجيل الخروج').onSelect!(new Event('select'))
    await new Promise(resolve => setTimeout(resolve))
    expect(failed.toast.add).toHaveBeenCalledWith({ title: 'تعذر إنهاء الجلسة', color: 'error' })
  })
})

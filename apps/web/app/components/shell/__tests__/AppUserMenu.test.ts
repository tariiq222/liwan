import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../AppUserMenu.vue')
const messages = {
  'nav.userMenu.label': 'قائمة المستخدم', 'nav.userMenu.company': 'الشركة', 'errors.generic': 'حدث خطأ', 'nav.userMenu.services': 'خدماتي', 'nav.userMenu.more': 'المزيد',
  'nav.userMenu.accountPassword': 'حسابي وكلمة المرور', 'nav.userMenu.appearance': 'المظهر', 'nav.userMenu.light': 'فاتح', 'nav.userMenu.dark': 'داكن',
  'nav.language': 'اللغة', 'nav.logout': 'تسجيل الخروج', 'bus.connected': 'متصل', 'bus.disconnected': 'غير متصل', 'account.logoutFailed': 'تعذر إنهاء الجلسة',
  'hr.self.profile': 'ملفي الوظيفي', 'hr.self.leave': 'إجازاتي', 'hr.self.pay': 'قسائم الراتب', 'hr.leave.new': 'طلب إجازة',
}

interface Item { type?: string, label?: string, to?: string, icon?: string, color?: string, slot?: string, onSelect?: (event: Event) => void }
const ENTRIES = [
  { id: 'hr-profile', section: 'profile', labelKey: 'hr.self.profile', icon: 'i-lucide-user-round', to: '/account/profile', summary: { queryKey: ['p'], load: async () => ({}) } },
  { id: 'hr-leave', section: 'leave', labelKey: 'hr.self.leave', icon: 'i-lucide-calendar-days', to: '/account/leave' },
  { id: 'hr-pay', section: 'pay', labelKey: 'hr.self.pay', icon: 'i-lucide-banknote', to: '/account/pay' },
]
const LEAVE_ACTION = { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-calendar-plus', to: '/account/leave/new' }

// The dropdown is a Nuxt UI primitive: the stub keeps the items the component hands it and renders the trigger and the custom slots.
function setup(over: { mode?: string, role?: boolean, signedOut?: boolean, signOutResult?: boolean, hydrated?: boolean, employee?: boolean, entries?: boolean, companies?: number, switchFails?: boolean, switching?: boolean } = {}) {
  const captured: { items: Item[][] } = { items: [] }
  const setMode = vi.fn()
  const choose = vi.fn()
  const signOut = vi.fn(async () => over.signOutResult ?? true)
  const toast = { add: vi.fn() }
  const switchCompany = vi.fn(async (_id: number) => { if (over.switchFails) throw new Error('تعذر التبديل') })
  const SharedSegmentedControl = Vue.defineComponent({
    props: { modelValue: String, items: { type: Array, default: () => [] }, label: String },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      ;(SharedSegmentedControl as unknown as { last: Record<string, unknown> }).last = {}
      return () => Vue.h('div', { 'data-segmented': props.label, 'data-value': props.modelValue }, (props.items as { value: string, label: string }[]).map(item => Vue.h('button', { 'data-item': item.value, onClick: () => emit('update:modelValue', item.value) }, item.label)))
    },
  })
  const UDropdownMenu = Vue.defineComponent({
    inheritAttrs: false,
    props: { items: { type: Array, default: () => [] } },
    setup(props, { slots }) {
      return () => { captured.items = props.items as Item[][]; return Vue.h('div', { 'data-menu': '' }, [slots.default?.(), slots.employee?.(), slots.appearance?.(), slots.language?.()]) }
    },
  })
  const companies = Array.from({ length: over.companies ?? 1 }, (_, index) => ({ id: index + 1, name: `الشركة ${index + 1}` }))
  const me = Vue.ref(over.signedOut ? null : { id: 4, company: companies[0], companies, name: 'سارة العتيبي', roles: over.role === false ? [] : [{ name: { ar: 'مديرة المبيعات', en: 'Sales manager' } }] })
  const entries = over.entries === false ? [] : ENTRIES
  const render = () => renderShared(component, {}, {}, {
    hydrated: over.hydrated ?? true,
    messages,
    stubs: { UDropdownMenu, SharedSegmentedControl },
    globals: { useMe: () => ({ me }), useBus: () => ({ connected: Vue.ref(true) }), useToast: () => toast, useApi: () => ({ $api: vi.fn() }), ref: Vue.ref, computed: Vue.computed },
    modules: {
      '@tanstack/vue-query': { useQuery: () => ({ data: Vue.ref(over.employee === false ? { caption: 'لا ملف' } : { value: 'سارة العتيبي', caption: 'مديرة مبيعات · المبيعات' }) }) },
      '@/composables/nav/personalModel': { personalEntries: () => entries, personalAction: (entry: { section: string }) => entry.section === 'leave' ? LEAVE_ACTION : null },
      '@/composables/useAppearance': { useAppearance: () => ({ mode: Vue.ref(over.mode ?? 'light'), setMode }) },
      '@/composables/useLocaleChoice': { useLocaleChoice: () => ({ languages: [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }], other: Vue.ref({ code: 'en', name: 'English' }), choose }) },
      '@/composables/useSignOut': { useSignOut: () => signOut },
      '@/utils/companySwitch': { companySwitching: Vue.ref(over.switching ?? false) },
      '@/composables/useSwitchCompany': { useSwitchCompany: () => switchCompany },
    },
  })
  return { captured, setMode, choose, signOut, switchCompany, toast, render }
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
  it('for a person with an employee record: card, services with «المزيد», the leave request, the account, the switches, then sign out', async () => {
    const { captured, render } = setup()
    await render()
    expect(captured.items.map(group => group.map(item => item.label ?? item.slot))).toEqual([
      ['employee'],
      ['خدماتي', 'ملفي الوظيفي', 'إجازاتي', 'قسائم الراتب', 'المزيد'],
      ['طلب إجازة'],
      ['حسابي وكلمة المرور'],
      ['appearance', 'language'],
      ['تسجيل الخروج'],
    ])
    expect(find(captured.items, 'ملفي الوظيفي')).toMatchObject({ to: '/account/profile' })
    expect(find(captured.items, 'المزيد')).toMatchObject({ to: '/account' })
    expect(find(captured.items, 'طلب إجازة')).toMatchObject({ to: '/account/leave/new' })
    expect(find(captured.items, 'حسابي وكلمة المرور')).toMatchObject({ to: '/account/settings' })
    expect(find(captured.items, 'تسجيل الخروج')).toMatchObject({ color: 'error', icon: 'i-lucide-log-out' })
  })

  it('for a person without an employee record: only the card, the account, the switches and sign out', async () => {
    const { captured, render } = setup({ employee: false })
    await render()
    expect(captured.items.map(group => group.map(item => item.label ?? item.slot))).toEqual([
      ['employee'], ['حسابي وكلمة المرور'], ['appearance', 'language'], ['تسجيل الخروج'],
    ])
  })

  it('offers no services when no application declares one for the person', async () => {
    const { captured, render } = setup({ entries: false })
    await render()
    expect(flat(captured.items).map(item => item.label)).not.toContain('خدماتي')
  })

  it('the card shows the name once, with the job title and department under it', async () => {
    const html = await setup().render()
    expect(html).toContain('data-testid="user-menu-employee"')
    expect(html).toContain('>مديرة مبيعات · المبيعات<')
    expect(html.match(/>سارة العتيبي</g)?.length).toBe(2)
  })

  it('lists no companies for a person who belongs to one', async () => {
    const { captured, render } = setup()
    await render()
    expect(flat(captured.items).map(item => item.label)).not.toContain('الشركة')
    expect(flat(captured.items).map(item => item.icon)).not.toContain('i-lucide-building-2')
  })

  it('lists the companies under the card for a person who belongs to several, the working one a checked item that does nothing', async () => {
    const { captured, switchCompany, render } = setup({ companies: 3 })
    await render()
    expect(captured.items.map(group => group.map(item => item.label ?? item.slot)).slice(0, 2)).toEqual([
      ['employee'], ['الشركة', 'الشركة 1', 'الشركة 2', 'الشركة 3'],
    ])
    // A checked item stays in keyboard navigation and is announced as checked; a disabled one is skipped and silent.
    const current = find(captured.items, 'الشركة 1') as Item & { checked?: boolean, disabled?: boolean }
    expect(current).toMatchObject({ type: 'checkbox', checked: true })
    expect(current.disabled).toBeUndefined()
    const event = { preventDefault: vi.fn() } as unknown as Event
    current.onSelect!(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(switchCompany).not.toHaveBeenCalled()
    expect(find(captured.items, 'الشركة 2')).toMatchObject({ icon: 'i-lucide-building-2' })
  })

  it('makes the other companies unselectable while a switch is running', async () => {
    const { captured, render } = setup({ companies: 3, switching: true })
    await render()
    expect(find(captured.items, 'الشركة 2')).toMatchObject({ disabled: true })
    expect(find(captured.items, 'الشركة 3')).toMatchObject({ disabled: true })
  })

  it('switches to the company that is picked, and reports a refused switch with a toast', async () => {
    const ok = setup({ companies: 3 })
    await ok.render()
    find(ok.captured.items, 'الشركة 3').onSelect!(new Event('select'))
    await Vue.nextTick()
    expect(ok.switchCompany).toHaveBeenCalledWith(3)
    expect(ok.toast.add).not.toHaveBeenCalled()

    const failed = setup({ companies: 2, switchFails: true })
    await failed.render()
    find(failed.captured.items, 'الشركة 2').onSelect!(new Event('select'))
    await new Promise(resolve => setTimeout(resolve))
    expect(failed.toast.add).toHaveBeenCalledWith({ title: 'تعذر التبديل', color: 'error' })
  })

  it('offers no presence status, notification preferences or automatic appearance', async () => {
    const html = await setup().render()
    expect(html).not.toContain('data-item="auto"')
  })

  it('the appearance control reflects the colour mode and flips it', async () => {
    const light = setup()
    const html = await light.render()
    expect(html).toContain('data-segmented="المظهر" data-value="light"')
    const dark = setup({ mode: 'dark' })
    expect(await dark.render()).toContain('data-segmented="المظهر" data-value="dark"')
    expect(html).toContain('data-item="dark"')
  })

  it('the language control offers both languages', async () => {
    const html = await setup().render()
    expect(html).toContain('data-segmented="اللغة"')
    expect(html).toContain('data-item="ar"')
    expect(html).toContain('data-item="en"')
  })

  it('keeps the menu open when a switch row is selected, so the change is seen in place', async () => {
    const { captured, render } = setup()
    await render()
    const event = { preventDefault: vi.fn() } as unknown as Event
    flat(captured.items).find(item => item.slot === 'appearance')!.onSelect!(event)
    expect(event.preventDefault).toHaveBeenCalled()
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

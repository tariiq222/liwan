import { resolve } from 'node:path'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadShared, DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { canReachPath } from '../../../utils/accessPolicy'
import { useNav } from '../../../composables/nav/shellModules'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { MaintenancePreferencePatchSchema, MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema, type MaintenanceSnapshot } from '@liwan/contracts'

type Node = { type: string; props: Record<string, any>; children: Node[]; parent: Node | null; prev: Node | null; next: Node | null; text?: string }
const node = (type = 'root'): Node => ({ type, props: {}, children: [], parent: null, prev: null, next: null })
const detach = (el: Node) => {
  if (el.prev) el.prev.next = el.next
  if (el.next) el.next.prev = el.prev
  if (el.parent) { const at = el.parent.children.indexOf(el); if (at >= 0) el.parent.children.splice(at, 1) }
  el.prev = el.next = el.parent = null
}
const renderer = Vue.createRenderer<Node, Node>({
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(el, parent, anchor) {
    detach(el)
    el.parent = parent
    const wanted = anchor ? parent.children.indexOf(anchor) : parent.children.length
    const at = wanted < 0 ? parent.children.length : wanted
    parent.children.splice(at, 0, el)
    el.prev = parent.children[at - 1] ?? null
    el.next = parent.children[at + 1] ?? null
    if (el.prev) el.prev.next = el
    if (el.next) el.next.prev = el
  },
  remove(el) { if (el) detach(el) },
  createElement: node, createText: text => ({ ...node('text'), text }), createComment: text => ({ ...node('comment'), text }),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.next,
})
const passthrough = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) } })
const withSlots = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, [slots.actions?.(), slots.default?.()]) } })
const inlineConfirm = Vue.defineComponent({ emits: ['confirm', 'cancel'], setup(_, { emit }) { return () => Vue.h('button', { 'data-testid': 'maintenance-confirm-cancel', onClick: () => emit('confirm') }) } })
const unsavedChanges = Vue.defineComponent({ props: ['dirty'], setup: props => () => Vue.h('div', { 'data-testid': 'unsaved-changes', 'data-dirty': props.dirty }) })
// Surfaces the alert title as an attribute so tests read it from the rendered node.
const alert = Vue.defineComponent({ inheritAttrs: false, props: ['title', 'description'], setup: (props, { attrs }) => () => Vue.h('div', { ...attrs, 'data-alert': props.title ?? '' }) })
// The real card draws a form and footer; the stub shows the state the form hands it and lets a test press «Save changes».
const settingsCard = Vue.defineComponent({
  inheritAttrs: false,
  props: ['message', 'dirty'],
  emits: ['save'],
  setup(props, { emit, slots }) {
    return () => Vue.h('section', { 'data-testid': 'maintenance-preference-card', 'data-message': props.message, 'data-dirty': props.dirty }, [Vue.h('button', { 'data-testid': 'maintenance-preference-save', onClick: () => emit('save') }), slots.default?.()])
  },
})
const stubs = {
  ...Object.fromEntries(['UInput', 'USelect', 'UFormField', 'UCheckbox', 'SharedFormSection', 'SharedFormActions', 'SharedStatusBadge'].map(name => [name, passthrough])),
  SharedRecordSection: withSlots,
  SharedInlineConfirm: passthrough,
  SharedUnsavedChanges: unsavedChanges,
  UAlert: alert,
  SharedSettingsCard: settingsCard,
}
const filename = resolve(import.meta.dirname, '../MaintenanceSettings.vue')
const formFile = resolve(import.meta.dirname, '../MaintenanceBookingForm.vue')
const wrapperFile = resolve(import.meta.dirname, '../../../pages/settings/system.vue')
const createPageFile = resolve(import.meta.dirname, '../../../pages/settings/system/maintenance/new.vue')
const editPageFile = resolve(import.meta.dirname, '../../../pages/settings/system/maintenance/[bookingId]/edit.vue')
const snapshot = (): MaintenanceSnapshot => ({ preference: { id: 1, timezone: 'Asia/Riyadh', weekday: 4, startMinute: 120, durationMinutes: 60, revision: 1 }, releases: { items: [{ id: 2, releaseId: '19.0.2', deadlineAt: '2030-01-10T00:00:00Z', estimatedSeconds: 120, scope: 'tenant', status: 'supported', urgency: 'security', policy: 'Operator deadline' }], total: 1 }, bookings: { items: [{ id: 3, releaseId: 1, scheduledAt: '2030-01-01T00:00:00Z', timezone: 'Asia/Riyadh', durationMinutes: 60, status: 'scheduled', revision: 4 }], total: 1 } })
const contracts = { MaintenancePreferencePatchSchema, MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema }
const options = (hydrated: Vue.Ref<boolean>) => ({ modules: { '@liwan/contracts': contracts, '@/composables/settings/useSettingsForm': { useSettingsForm }, '@/composables/useApi': { ApiError }, '@/utils/formFeedback': { saveErrorMessage } }, globals: { useHydrated: () => hydrated, useId: () => '1' } })
function harness(preference: MaintenanceSnapshot['preference'] | null = snapshot().preference) {
  const hydrated = Vue.ref(false)
  const props = Vue.reactive({ snapshot: { ...snapshot(), preference }, pending: false, reload: vi.fn(async () => snapshot()), savePreference: vi.fn(async () => { throw new ApiError(422, 'invalid', 'save failed') }), updateBooking: vi.fn(async () => undefined) })
  const component = loadShared(filename, options(hydrated))
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ...stubs, SharedInlineConfirm: inlineConfirm })) app.component(name, stub)
  const root = node(); app.mount(root)
  const find = (id: string, el: Node = root): Node | undefined => el.props['data-testid'] === id ? el : el.children.map(child => find(id, child)).find(Boolean)
  return { app, hydrated, props, find }
}
function formHarness(booking?: MaintenanceSnapshot['bookings']['items'][number]) {
  const hydrated = Vue.ref(true)
  const props = Vue.reactive({ snapshot: snapshot(), booking, book: vi.fn(async () => undefined), updateBooking: vi.fn(async () => undefined), onDone: vi.fn(), onCancel: vi.fn() })
  const component = loadShared(formFile, options(hydrated))
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ...stubs })) app.component(name, stub)
  const root = node(); app.mount(root)
  const walk = (match: (props: Record<string, any>) => boolean, el: Node = root): Node | undefined => match(el.props) ? el : el.children.map(child => walk(match, child)).find(Boolean)
  const find = (id: string) => walk(props => props['data-testid'] === id)
  const findBy = (match: (props: Record<string, any>) => boolean) => walk(match)
  return { app, hydrated, props, find, findBy }
}
function pageHarness(file: string, setup: { route: Record<string, unknown>; canAccess: boolean; data?: MaintenanceSnapshot | null }) {
  const enabledGetters: Array<() => boolean> = []
  const book = vi.fn(async () => undefined)
  const update = vi.fn(async () => undefined)
  const push = vi.fn(async () => undefined)
  const replace = vi.fn(async () => undefined)
  const query = { data: Vue.ref(setup.data ?? null), isPending: Vue.ref(false), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }
  let formProps: Record<string, any> | null = null
  const pageStubs: Record<string, Vue.Component> = {
    ...stubs,
    MaintenanceBookingForm: Vue.defineComponent({ props: ['snapshot', 'booking', 'book', 'updateBooking'], emits: ['done', 'cancel'], setup(props) { formProps = Vue.reactive(props); return () => Vue.h('div', { 'data-testid': 'maintenance-booking-form' }) } }),
    SharedForbiddenState: Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'forbidden-state' }) }),
    SharedPageState: Vue.defineComponent({ inheritAttrs: false, props: ['loading', 'error'], setup: (props, { slots }) => () => Vue.h('div', { 'data-testid': 'page-state', 'data-loading': String(Boolean(props.loading)), 'data-error': props.error ? JSON.stringify(props.error) : '' }, !props.loading && !props.error ? slots.default?.() : []) }),
    SharedPageContainer: passthrough,
    SharedPageHeader: passthrough,
    SharedCreatePanel: passthrough,
    SharedSettingsPage: Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('div', { 'data-testid': 'settings-page' }, slots.default?.()) } }),
    MaintenanceSettings: Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'maintenance-settings' }) }),
    NuxtPage: Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'nuxt-page' }) }),
  }
  const hydrated = Vue.ref(true)
  const component = loadShared(file, {
    modules: {
      '@liwan/contracts': contracts,
      '@/composables/useApi': { ApiError },
      '@/utils/formFeedback': { saveErrorMessage },
      '@/composables/useMaintenance': { useMaintenance: (enabled?: () => boolean) => { if (enabled) enabledGetters.push(enabled); return query }, useMaintenanceActions: () => ({ preference: { mutateAsync: vi.fn(async () => undefined) }, booking: { mutateAsync: book }, update: { mutateAsync: update } }) },
      '@/components/settings/MaintenanceBookingForm.vue': pageStubs.MaintenanceBookingForm,
      '@/components/settings/MaintenanceSettings.vue': pageStubs.MaintenanceSettings,
    },
    globals: {
      useHydrated: () => hydrated,
      useId: () => '1',
      useRoute: () => setup.route,
      useRouter: () => ({ push, replace }),
      useSettingsPage: () => ({ shows: (id: string) => setup.canAccess && id === 'maintenance', parts: Vue.ref(setup.canAccess ? [{ id: 'maintenance' }] : []) }),
    },
  })
  const app = renderer.createApp({ render: () => Vue.h(component, {}) })
  for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ...pageStubs })) app.component(name, stub)
  const root = node(); app.mount(root)
  const find = (id: string, el: Node = root): Node | undefined => el.props['data-testid'] === id ? el : el.children.map(child => find(id, child)).find(Boolean)
  return { app, enabledGetters, book, update, push, replace, query, find, get formProps() { return formProps } }
}

function update(h: ReturnType<typeof harness> | ReturnType<typeof formHarness>, id: string, value: unknown) {
  const handlers = h.find(id)!.props['onUpdate:modelValue']
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) handler(value)
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('maintenance settings', () => {
  it('gates direct navigation, settings links and the booking routes on the maintenance capability', () => {
    expect(canReachPath({ capabilities: [] }, '/settings/system')).toBe(false)
    expect(canReachPath({ capabilities: ['settings.maintenance.manage'] }, '/settings/system')).toBe(true)
    expect(useNav({ capabilities: ['settings.maintenance.manage'] }).map(item => item.to)).toContain('/settings/system#maintenance')
    for (const path of ['/settings/system/maintenance/new', '/settings/system/maintenance/3/edit']) {
      expect(canReachPath({ capabilities: [] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['settings.maintenance.manage'] }, path)).toBe(true)
      // A sibling system capability (storage, export) never opens the booking routes.
      expect(canReachPath({ capabilities: ['settings.company.manage'] }, path)).toBe(false)
      expect(canReachPath({ capabilities: ['tenant.export'] }, path)).toBe(false)
    }
  })

  it('links the booking create panel and the per-booking edit page from the lists', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    expect(h.find('maintenance-booking-add')!.props.to).toBe('/settings/system/maintenance/new')
    expect(h.find('maintenance-edit-3')!.props.to).toBe('/settings/system/maintenance/3/edit')
    expect(h.find('maintenance-booking-form')).toBeUndefined()
    h.app.unmount()
  })
  it('cancellation requires inline confirmation and uses the revision shown to the customer', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    h.find('maintenance-cancel-3')!.props.onClick(); await Vue.nextTick()
    expect(h.props.updateBooking).not.toHaveBeenCalled()
    h.props.snapshot.bookings.items[0]!.revision = 9; await Vue.nextTick()
    h.find('maintenance-confirm-cancel')!.props.onClick(); await Vue.nextTick()
    expect(h.props.updateBooking).toHaveBeenCalledWith(3, { status: 'cancelled', revision: 4 })
    h.app.unmount()
  })
  it('offers no create button when no release is bookable', async () => {
    const h = harness(); h.hydrated.value = true
    h.props.snapshot.releases.items[0]!.deadlineAt = '2020-01-01T00:00:00Z'; await Vue.nextTick()
    expect(h.find('maintenance-booking-add')).toBeUndefined()
    h.app.unmount()
  })
  it('hides reschedule and cancellation controls after maintenance starts', async () => {
    const h = harness(); h.props.snapshot.bookings.items[0]!.status = 'running'; await Vue.nextTick()
    expect(h.find('maintenance-cancel-3')).toBeUndefined()
    expect(h.find('maintenance-edit-3')).toBeUndefined()
    h.app.unmount()
  })

  it('disables first-click controls until hydration', async () => {
    const h = harness()
    expect(h.find('maintenance-timezone')!.props.disabled).toBe(true)
    h.hydrated.value = true; await Vue.nextTick()
    expect(h.find('maintenance-timezone')!.props.disabled).toBe(false)
    h.app.unmount()
  })
  it('keeps a failed preference draft and shows the failure inside its card', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    update(h, 'maintenance-timezone', 'Europe/London'); await Vue.nextTick()
    h.find('maintenance-preference-save')!.props.onClick(); await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick()
    expect(h.props.savePreference).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Europe/London', revision: 1 }))
    expect(h.find('maintenance-timezone')!.props.modelValue).toBe('Europe/London')
    expect(h.find('maintenance-preference-card')!.props['data-message']).toBe('save failed')
    h.app.unmount()
  })
  it('saves with the newest revision the page knows when the other fields are unchanged', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    h.props.savePreference.mockResolvedValueOnce({ ...snapshot().preference!, timezone: 'Europe/London', revision: 10 } as never)
    update(h, 'maintenance-timezone', 'Europe/London'); await Vue.nextTick()
    h.props.snapshot = { ...snapshot(), preference: { ...snapshot().preference!, revision: 9 } }; await Vue.nextTick()
    h.find('maintenance-preference-save')!.props.onClick(); await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick()
    expect(h.props.savePreference).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Europe/London', revision: 9 }))
    h.app.unmount()
  })
  const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
  it('locks the card instead of overwriting a window another admin changed meanwhile', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    update(h, 'maintenance-timezone', 'Europe/London'); await Vue.nextTick()
    h.props.snapshot = { ...snapshot(), preference: { ...snapshot().preference!, timezone: 'Asia/Dubai', revision: 2 } }; await Vue.nextTick()
    expect(h.find('maintenance-preference-card')!.props['data-message']).toBe('app.settingsConflict')
    h.find('maintenance-preference-save')!.props.onClick(); await settle()
    expect(h.props.savePreference).not.toHaveBeenCalled()
    h.app.unmount()
  })
  it('lets a tenant with no saved window save the default one', async () => {
    const fresh = harness(null); fresh.hydrated.value = true; await Vue.nextTick()
    expect(fresh.find('maintenance-preference-card')!.props['data-dirty']).toBe(true)
    fresh.props.savePreference.mockResolvedValueOnce({ id: 1, timezone: 'UTC', weekday: 4, startMinute: 120, durationMinutes: 60, revision: 1 } as never)
    fresh.find('maintenance-preference-save')!.props.onClick(); await settle()
    expect(fresh.props.savePreference).toHaveBeenCalledWith({ timezone: 'UTC', weekday: 4, startMinute: 120, durationMinutes: 60, revision: 0 })
    fresh.app.unmount()
  })
  it('explains an invalid window inside the card without sending it', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    update(h, 'maintenance-duration', 0); await Vue.nextTick()
    h.find('maintenance-preference-save')!.props.onClick(); await settle()
    expect(h.props.savePreference).not.toHaveBeenCalled()
    expect(h.find('maintenance-preference-card')!.props['data-message']).toBe('settings.maintenance.invalid')
    h.app.unmount()
  })
  it('renders shared scope, operator policy and measured duration', async () => {
    const data = snapshot(); data.releases.items[0]!.scope = 'ai_service'
    const html = await renderShared(filename, { snapshot: data, savePreference: vi.fn(), updateBooking: vi.fn() }, {}, { ...options(Vue.ref(true)), stubs })
    expect(html).toContain('settings.maintenance.scope.ai_service')
    expect(html).toContain('Operator deadline')
    expect(html).toContain('settings.maintenance.sharedScope')
  })
})

describe('maintenance booking form', () => {
  it('submits the selected release and local time and preserves a failed booking draft', async () => {
    const h = formHarness()
    update(h, 'maintenance-release', 2); update(h, 'maintenance-booking-time', '2030-01-01T02:00'); await Vue.nextTick()
    expect(h.find('unsaved-changes')!.props['data-dirty']).toBe(true)
    h.props.book.mockRejectedValueOnce(new ApiError(422, 'invalid', 'full capacity'))
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).toHaveBeenCalledWith({ releaseId: 2, localDateTime: '2030-01-01T02:00', timezone: 'Asia/Riyadh', durationMinutes: 60 })
    expect(h.props.onDone).not.toHaveBeenCalled()
    expect(h.find('maintenance-error')!.props['data-alert']).toBe('full capacity')
    expect(h.find('maintenance-booking-time')!.props.modelValue).toBe('2030-01-01T02:00')
    expect(h.find('unsaved-changes')!.props['data-dirty']).toBe(true)
    h.props.book.mockResolvedValueOnce(undefined)
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.onDone).toHaveBeenCalledTimes(1)
    // A saved booking disarms the unsaved-changes guard, so the shared guard never blocks the navigation it caused.
    expect(h.find('unsaved-changes')!.props['data-dirty']).toBe(false)
    h.app.unmount()
  })
  it('books with the saved window instead of explicit times when the reader prefers it', async () => {
    const h = formHarness()
    update(h, 'maintenance-release', 2)
    const checkbox = h.findBy(props => props.label === 'settings.maintenance.usePreference')!
    checkbox.props['onUpdate:modelValue'](true); await Vue.nextTick()
    expect(h.find('maintenance-booking-time')).toBeUndefined()
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).toHaveBeenCalledWith({ releaseId: 2, usePreference: true, preferenceRevision: 1 })
    h.app.unmount()
  })
  it('refuses an empty submit with field errors and no request', async () => {
    const h = formHarness()
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).not.toHaveBeenCalled()
    expect(h.find('maintenance-release')!.parent!.props.error).toBe('settings.maintenance.releaseRequired')
    expect(h.find('maintenance-booking-time')!.parent!.props.error).toBe('settings.maintenance.timeRequired')
    h.app.unmount()
  })
  it('explains an invalid duration or timezone under its field without sending it', async () => {
    const h = formHarness()
    update(h, 'maintenance-release', 2); update(h, 'maintenance-booking-time', '2030-01-01T02:00')
    update(h, 'maintenance-booking-zone', 'Not/AZone'); update(h, 'maintenance-booking-duration', 0)
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).not.toHaveBeenCalled()
    expect(h.find('maintenance-booking-zone')!.parent!.props.error).toBe('settings.maintenance.zoneInvalid')
    expect(h.find('maintenance-booking-duration')!.parent!.props.error).toBe('settings.maintenance.durationInvalid')
    h.app.unmount()
  })
  it('blocks submit when the selected release is unavailable or the local time is malformed', async () => {
    const h = formHarness()
    update(h, 'maintenance-release', 999); update(h, 'maintenance-booking-time', '2030-01-01 02:00')
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).not.toHaveBeenCalled()
    expect(h.find('maintenance-release')!.parent!.props.error).toBe('settings.maintenance.releaseRequired')
    expect(h.find('maintenance-booking-time')!.parent!.props.error).toBe('settings.maintenance.timeRequired')
    h.app.unmount()
  })
  it('edits on the page: starts clean from the booking, patches with its revision and never resends the release', async () => {
    const h = formHarness(snapshot().bookings.items[0])
    expect(h.find('unsaved-changes')!.props['data-dirty']).toBe(false)
    expect(h.find('maintenance-booking-time')!.props.modelValue).toBe('2030-01-01T03:00')
    expect(h.find('maintenance-booking-zone')!.props.modelValue).toBe('Asia/Riyadh')
    expect(h.find('maintenance-release')!.props.disabled).toBe(true)
    update(h, 'maintenance-booking-time', '2030-01-01T04:00'); update(h, 'maintenance-booking-duration', 90)
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.updateBooking).toHaveBeenCalledWith(3, { localDateTime: '2030-01-01T04:00', timezone: 'Asia/Riyadh', durationMinutes: 90, revision: 4 })
    expect(h.props.book).not.toHaveBeenCalled()
    expect(h.props.onDone).toHaveBeenCalledTimes(1)
    h.app.unmount()
  })
  it('keeps a failed edit draft and its unsaved-changes guard armed', async () => {
    const h = formHarness(snapshot().bookings.items[0])
    update(h, 'maintenance-booking-time', '2030-01-01T04:00'); await Vue.nextTick()
    h.props.updateBooking.mockRejectedValueOnce(new ApiError(409, 'conflict', 'already running'))
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.find('maintenance-error')!.props['data-alert']).toBe('already running')
    expect(h.find('maintenance-booking-time')!.props.modelValue).toBe('2030-01-01T04:00')
    expect(h.find('unsaved-changes')!.props['data-dirty']).toBe(true)
    h.app.unmount()
  })
})

describe('maintenance booking routes', () => {
  it('renders SharedSettingsPage on /settings/system and /new, and hides it on sub-pages', async () => {
    const route = Vue.reactive({ path: '/settings/system' })
    const h = pageHarness(wrapperFile, { route, canAccess: true, data: snapshot() })
    expect(h.find('settings-page')).toBeDefined()
    expect(h.find('nuxt-page')).toBeDefined()
    expect(h.enabledGetters[0]!()).toBe(true)
    route.path = '/settings/system/maintenance/new'
    await Vue.nextTick()
    expect(h.find('settings-page')).toBeDefined()
    expect(h.find('nuxt-page')).toBeDefined()
    expect(h.enabledGetters[0]!()).toBe(true)
    for (const subPath of ['/settings/system/storage', '/settings/system/export', '/settings/system/maintenance/3/edit']) {
      route.path = subPath
      await Vue.nextTick()
      expect(h.find('settings-page')).toBeUndefined()
      expect(h.find('nuxt-page')).toBeDefined()
      expect(h.enabledGetters[0]!()).toBe(false)
    }
    h.app.unmount()
  })
  it('hosts the form in the create panel, gated on the maintenance capability and with the fetch held back otherwise', async () => {
    const route = Vue.reactive({ path: '/settings/system/maintenance/new', query: {} })
    const denied = pageHarness(createPageFile, { route, canAccess: false })
    expect(denied.find('forbidden-state')).toBeDefined()
    expect(denied.find('maintenance-booking-form')).toBeUndefined()
    expect(denied.enabledGetters[0]!()).toBe(false)
    denied.app.unmount()

    const h = pageHarness(createPageFile, { route, canAccess: true, data: snapshot() })
    expect(h.find('forbidden-state')).toBeUndefined()
    expect(h.find('maintenance-booking-form')).toBeDefined()
    expect(h.enabledGetters[0]!()).toBe(true)
    h.app.unmount()
  })
  it('edits one scheduled booking on its own page: rejects invalid, unknown, non-scheduled or unauthorized access', async () => {
    const route = Vue.reactive({ params: { bookingId: '3' }, query: {} })
    const h = pageHarness(editPageFile, { route, canAccess: true, data: snapshot() })
    expect(h.enabledGetters[0]!()).toBe(true)
    expect(h.find('maintenance-booking-form')).toBeDefined()
    expect(h.formProps!.booking.id).toBe(3)
    expect(h.formProps!.snapshot.bookings.total).toBe(1)

    route.params.bookingId = 'abc'; await Vue.nextTick()
    expect(h.enabledGetters[0]!()).toBe(false)
    expect(h.find('page-state')!.props['data-error']).toBe('{"status":404}')
    expect(h.find('maintenance-booking-form')).toBeUndefined()
    h.app.unmount()

    const missing = pageHarness(editPageFile, { route: Vue.reactive({ params: { bookingId: '99' }, query: {} }), canAccess: true, data: snapshot() })
    await Vue.nextTick()
    expect(missing.find('page-state')!.props['data-error']).toBe('{"status":404}')
    expect(missing.find('maintenance-booking-form')).toBeUndefined()
    missing.app.unmount()

    const runningSnapshot = snapshot()
    runningSnapshot.bookings.items[0]!.status = 'running'
    const running = pageHarness(editPageFile, { route: Vue.reactive({ params: { bookingId: '3' }, query: {} }), canAccess: true, data: runningSnapshot })
    await Vue.nextTick()
    expect(running.find('page-state')!.props['data-error']).toBe('{"status":404}')
    expect(running.find('maintenance-booking-form')).toBeUndefined()
    running.app.unmount()

    const denied = pageHarness(editPageFile, { route: Vue.reactive({ params: { bookingId: '3' }, query: {} }), canAccess: false, data: snapshot() })
    expect(denied.find('forbidden-state')).toBeDefined()
    expect(denied.find('maintenance-booking-form')).toBeUndefined()
    expect(denied.enabledGetters[0]!()).toBe(false)
    denied.app.unmount()
  })
})

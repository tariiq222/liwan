import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { loadShared, DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import { canReachPath } from '../../../utils/accessPolicy'
import { useNav } from '../../../composables/nav/shellModules'
import { MaintenancePreferencePatchSchema, MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema } from '@webvue/contracts'

type Node = { type: string; props: Record<string, any>; children: Node[]; parent: Node | null; text?: string }
const node = (type = 'root'): Node => ({ type, props: {}, children: [], parent: null })
const renderer = Vue.createRenderer<Node, Node>({
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(el, parent) { el.parent = parent; parent.children.push(el) },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  createElement: node, createText: text => ({ ...node('text'), text }), createComment: text => ({ ...node('comment'), text }),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: () => null,
})
const passthrough = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) } })
const inlineConfirm = Vue.defineComponent({ emits: ['confirm', 'cancel'], setup(_, { emit }) { return () => Vue.h('button', { 'data-testid': 'maintenance-confirm-cancel', onClick: () => emit('confirm') }) } })
const stubs = Object.fromEntries(['UInput', 'USelect', 'UFormField', 'UCheckbox', 'SharedFormSection', 'SharedFormActions', 'SharedRecordSection', 'SharedInlineConfirm', 'SharedUnsavedChanges'].map(name => [name, passthrough]))
const filename = resolve(import.meta.dirname, '../MaintenanceSettings.vue')
const snapshot = () => ({ preference: { id: 1, timezone: 'Asia/Riyadh', weekday: 4, startMinute: 120, durationMinutes: 60, revision: 1 }, releases: { items: [{ id: 2, releaseId: '19.0.2', deadlineAt: '2030-01-10T00:00:00Z', estimatedSeconds: 120, scope: 'tenant', status: 'supported', urgency: 'security', policy: 'Operator deadline' }], total: 1 }, bookings: { items: [{ id: 3, releaseId: 1, scheduledAt: '2030-01-01T00:00:00Z', timezone: 'Asia/Riyadh', durationMinutes: 60, status: 'scheduled', revision: 4 }], total: 1 } })
const options = (hydrated: Vue.Ref<boolean>) => ({ modules: { '@webvue/contracts': { MaintenancePreferencePatchSchema, MaintenanceBookingInputSchema, MaintenanceBookingPatchSchema } }, globals: { useHydrated: () => hydrated } })
function harness() {
  const hydrated = Vue.ref(false)
  const props = Vue.reactive({ snapshot: snapshot(), pending: false, savePreference: vi.fn(async () => { throw new Error('save failed') }), book: vi.fn(async () => undefined), updateBooking: vi.fn(async () => undefined) })
  const component = loadShared(filename, options(hydrated))
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ...stubs, SharedInlineConfirm: inlineConfirm, SharedUnsavedChanges: Vue.defineComponent({ props: ['dirty'], setup: p => () => Vue.h('div', { 'data-dirty': p.dirty }) }) })) app.component(name, stub)
  const root = node(); app.mount(root)
  const find = (id: string, el: Node = root): Node | undefined => el.props['data-testid'] === id ? el : el.children.map(child => find(id, child)).find(Boolean)
  return { app, hydrated, props, find }
}

function update(h: ReturnType<typeof harness>, id: string, value: unknown) {
  const handlers = h.find(id)!.props['onUpdate:modelValue']
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) handler(value)
}

describe('maintenance settings', () => {
  it('gates both direct navigation and settings links on the maintenance capability', () => {
    expect(canReachPath({ capabilities: [] }, '/settings/system')).toBe(false)
    expect(canReachPath({ capabilities: ['settings.maintenance.manage'] }, '/settings/system')).toBe(true)
    expect(useNav({ capabilities: ['settings.maintenance.manage'] }).map(item => item.to)).toContain('/settings/system#maintenance')
  })

  it('submits the selected release and local time, preserving a failed booking draft', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    update(h, 'maintenance-release', 2); update(h, 'maintenance-booking-time', '2030-01-01T02:00'); await Vue.nextTick()
    h.props.book.mockRejectedValueOnce(new Error('full capacity'))
    await h.find('maintenance-booking-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.book).toHaveBeenCalledWith({ releaseId: 2, localDateTime: '2030-01-01T02:00', timezone: 'Asia/Riyadh', durationMinutes: 60 })
    expect(h.find('maintenance-booking-time')!.props.modelValue).toBe('2030-01-01T02:00')
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
  it('hides reschedule and cancellation controls after maintenance starts', async () => {
    const h = harness(); h.props.snapshot.bookings.items[0]!.status = 'running'; await Vue.nextTick()
    expect(h.find('maintenance-cancel-3')).toBeUndefined()
    expect(h.find('maintenance-edit-3')).toBeUndefined()
    h.app.unmount()
  })

  it('disables first-click controls until hydration', async () => {
    const h = harness()
    expect(h.find('maintenance-preference-save')!.props.disabled).toBe(true)
    h.hydrated.value = true; await Vue.nextTick()
    expect(h.find('maintenance-preference-save')!.props.disabled).toBe(false)
    h.app.unmount()
  })
  it('preserves a failed preference draft and its original CAS revision after refetch', async () => {
    const h = harness(); h.hydrated.value = true; await Vue.nextTick()
    for (const handler of h.find('maintenance-timezone')!.props['onUpdate:modelValue']) handler('Europe/London'); await Vue.nextTick()
    h.props.snapshot = { ...snapshot(), preference: { ...snapshot().preference, revision: 9 } }; await Vue.nextTick()
    await h.find('maintenance-preference-form')!.props.onSubmit({ preventDefault() {} }); await Vue.nextTick()
    expect(h.props.savePreference).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Europe/London', revision: 1 }))
    expect(h.find('maintenance-timezone')!.props.modelValue).toBe('Europe/London')
    expect(h.find('maintenance-error')).toBeDefined()
    h.app.unmount()
  })
  it('renders shared scope, operator policy and measured duration', async () => {
    const data = snapshot(); data.releases.items[0]!.scope = 'ai_service'
    const html = await renderShared(filename, { snapshot: data, savePreference: vi.fn(), book: vi.fn(), updateBooking: vi.fn() }, {}, { ...options(Vue.ref(true)), stubs })
    expect(html).toContain('settings.maintenance.scope.ai_service')
    expect(html).toContain('Operator deadline')
    expect(html).toContain('settings.maintenance.sharedScope')
  })
})

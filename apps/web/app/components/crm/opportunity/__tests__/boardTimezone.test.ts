import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../../packages/ui/test/helpers/renderShared'
import { isCallDue } from '../../../../utils/crmOpportunity'

const NativeDateTimeFormat = Intl.DateTimeFormat

const Badge = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('span', { 'data-tone': attrs.tone }, String(attrs.label)) })
const Avatar = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('span', { 'data-avatar': attrs.text }) })

async function boardHtml(runtimeZone: string, userZone?: string, extra: { items?: unknown[]; createTo?: string } = {}) {
  // Separate server and browser formatter caches, each with a real Intl formatter.
  // Only their ambient time zone differs; an explicit session time zone wins.
  vi.resetModules()
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? runtimeZone })
  } as typeof Intl.DateTimeFormat)
  const formatting = await import('../../../../../../../packages/ui/app/utils/formatDate')
  const avatarTone = await import('../../../../../../../packages/ui/app/utils/avatarTone')
  const CallButton = Vue.defineComponent({ setup: () => () => Vue.h('button', { disabled: true }, 'Call') })
  const Board = loadShared(resolve(import.meta.dirname, '../CrmOpportunityBoard.vue'), {
    modules: {
      '@liwan/ui/app/utils/formatDate': formatting,
      '@liwan/ui/app/utils/avatarTone': avatarTone,
      './CrmCallButton.vue': { __esModule: true, default: CallButton },
      '@/utils/crmOpportunity': { isCallDue },
    },
    globals: { useMe: () => ({ me: Vue.ref({ tz: userZone }) }) },
  })
  const app = Vue.createSSRApp({ render: () => Vue.h(Board, {
    stages: [{ id: 1, name: 'Follow up', active: true, sequence: 1 }],
    items: extra.items ?? [{ id: 4, stage: { id: 1 }, contact_name: 'Future contact', phone: '+966500000000', user: null, needs_manager: false, status: 'pending', next_call_at: '2026-11-07T08:30:00Z' }],
    now: Date.parse('2026-11-06T12:00:00Z'), to: () => '/crm/opportunities/4', createTo: extra.createTo, createLabel: 'Deal',
  }) })
  for (const [name, component] of Object.entries(DEFAULT_STUBS)) app.component(name, component)
  app.component('SharedStatusBadge', Badge)
  app.component('UAvatar', Avatar)
  return renderToString(app)
}

afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })

it('renders a future call identically on UTC SSR and Riyadh hydration using the session timezone', async () => {
  const server = await boardHtml('UTC', 'Asia/Riyadh')
  vi.restoreAllMocks()
  const firstClient = await boardHtml('Asia/Riyadh', 'Asia/Riyadh')
  expect(server).toContain('07/11/2026 11:30')
  expect(firstClient).toBe(server)
  expect(server).toContain('datetime="2026-11-07T08:30:00Z"')
})

it('uses the same UTC fallback when identity has no timezone', async () => {
  const server = await boardHtml('UTC')
  vi.restoreAllMocks()
  const firstClient = await boardHtml('Asia/Riyadh')
  expect(server).toContain('07/11/2026 08:30')
  expect(firstClient).toBe(server)
})

const owned = { id: 5, stage: { id: 1 }, contact_name: 'Owned contact', phone: '+966511111111', user: { id: 9, name: 'Sara Ali' }, needs_manager: true, status: 'pending', next_call_at: null }
const unowned = { ...owned, id: 6, contact_name: 'Pool contact', user: null, needs_manager: false }

it('shows the owner avatar and name with the manager warning, and the pool badge for an unassigned record', async () => {
  const html = await boardHtml('UTC', 'Asia/Riyadh', { items: [owned, unowned] })
  expect(html).toContain('data-avatar="SA"')
  expect(html).toContain('Sara Ali')
  expect(html).toContain('<span data-tone="warning">crm.opportunities.tag.needsManager</span>')
  expect(html).toContain('<span data-tone="neutral">crm.opportunities.tag.pool</span>')
})

it('ends every column with an add tile that links to the create panel only when a create link is given', async () => {
  const withTile = await boardHtml('UTC', 'Asia/Riyadh', { items: [owned], createTo: '/crm/opportunities/new' })
  expect(withTile).toContain('data-testid="crm-board-add"')
  expect(withTile).toContain('Deal')
  expect(await boardHtml('UTC', 'Asia/Riyadh', { items: [owned] })).not.toContain('crm-board-add')
})

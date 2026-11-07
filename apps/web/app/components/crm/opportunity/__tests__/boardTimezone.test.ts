import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../../packages/ui/test/helpers/renderShared'
import { isCallDue } from '../../../../utils/crmOpportunity'

const NativeDateTimeFormat = Intl.DateTimeFormat

async function boardHtml(runtimeZone: string, userZone?: string) {
  // Separate server and browser formatter caches, each with a real Intl formatter.
  // Only their ambient time zone differs; an explicit session time zone wins.
  vi.resetModules()
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? runtimeZone })
  } as typeof Intl.DateTimeFormat)
  const formatting = await import('../../../../../../../packages/ui/app/utils/formatDate')
  const CallButton = Vue.defineComponent({ setup: () => () => Vue.h('button', { disabled: true }, 'Call') })
  const Board = loadShared(resolve(import.meta.dirname, '../CrmOpportunityBoard.vue'), {
    modules: {
      '@liwan/ui/app/utils/formatDate': formatting,
      './CrmCallButton.vue': { __esModule: true, default: CallButton },
      '@/utils/crmOpportunity': { isCallDue },
    },
    globals: { useMe: () => ({ me: Vue.ref({ tz: userZone }) }) },
  })
  const app = Vue.createSSRApp({ render: () => Vue.h(Board, {
    stages: [{ id: 1, name: 'Follow up', active: true, sequence: 1 }],
    items: [{ id: 4, stage: { id: 1 }, contact_name: 'Future contact', phone: '+966500000000', user: null, needs_manager: false, status: 'pending', next_call_at: '2026-11-07T08:30:00Z' }],
    now: Date.parse('2026-11-06T12:00:00Z'), to: () => '/crm/opportunities/4',
  }) })
  for (const [name, component] of Object.entries(DEFAULT_STUBS)) app.component(name, component)
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

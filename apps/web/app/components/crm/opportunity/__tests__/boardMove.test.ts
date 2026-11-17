import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../../packages/ui/test/helpers/renderShared'
import * as boardMove from '../../../../utils/crmBoardMove'
import { isCallDue } from '../../../../utils/crmOpportunity'

// The draggable column stands in as a div carrying the group it was given, so the drop rules show in the markup.
const Draggable = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', { class: attrs.class, 'data-group': JSON.stringify(attrs.group), 'data-delay': attrs.delay }, slots.default?.()) })
const RowActions = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', { 'data-testid': 'row-action' }, (attrs.actions as { label: string }[]).map(action => action.label).join()) })
const Passthrough = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('span', String(attrs.label ?? '')) })

const stages = [
  { id: 1, name: 'New', active: true, sequence: 1, is_won: false },
  { id: 4, name: 'Sold', active: true, sequence: 4, is_won: true },
]
const mine = { id: 1, stage: { id: 1 }, contact_name: 'Mine', phone: '+966500000001', user: { id: 3, name: 'Layla' }, needs_manager: false, status: 'pending', next_call_at: null, win_by_order: false }
const theirs = { ...mine, id: 2, contact_name: 'Theirs', user: { id: 9, name: 'Sara' } }

async function boardHtml(items: unknown[], canMove?: (item: { id: number }) => boolean) {
  const Board = loadShared(resolve(import.meta.dirname, '../CrmOpportunityBoard.vue'), {
    modules: {
      '@liwan/ui/app/utils/formatDate': { formatDateTime: () => '' },
      '@liwan/ui/app/utils/avatarTone': { avatarProps: () => ({}) },
      './CrmCallButton.vue': { __esModule: true, default: Vue.defineComponent({ setup: () => () => Vue.h('i') }) },
      '@/utils/crmOpportunity': { isCallDue },
      '@/utils/crmBoardMove': boardMove,
      'vue-draggable-plus': { VueDraggable: Draggable },
    },
    globals: { useMe: () => ({ me: Vue.ref({ tz: 'UTC' }) }), nextTick: Vue.nextTick },
  })
  const app = Vue.createSSRApp({ render: () => Vue.h(Board, { stages, items, to: () => '/x', now: 0, canMove }) })
  for (const [name, component] of Object.entries(DEFAULT_STUBS)) app.component(name, component)
  app.component('SharedStatusBadge', Passthrough)
  app.component('UAvatar', Passthrough)
  app.component('SharedRowActions', RowActions)
  return renderToString(app)
}

it('makes only the cards the user may work draggable and gives only those the move action', async () => {
  const html = await boardHtml([mine, theirs], item => item.id === 1)
  expect(html.match(/data-readonly="false"/g)).toHaveLength(1)
  expect(html.match(/data-readonly="true"/g)).toHaveLength(1)
  expect(html.match(/data-testid="row-action"/g)).toHaveLength(1)
  expect(html).toContain('crm.opportunities.board.move')
})

it('offers no drag and no move action when nothing may be moved', async () => {
  const html = await boardHtml([mine, theirs])
  expect(html).not.toContain('data-readonly="false"')
  expect(html).not.toContain('row-action')
})

it('takes drops on every stage column, delays a touch drag, and renders the lost zone hidden until a drag starts', async () => {
  const html = await boardHtml([mine], () => true)
  expect(html).toContain('data-group="&quot;crm-opportunities&quot;"')
  expect(html).toContain('data-delay="200"')
  expect(html).toContain('data-testid="crm-board-lost-zone"')
  expect(html).toContain('invisible')
  expect(html).not.toContain('crm-board-win-hint')
})

it('closes the sold column to drops while an order wins the sale', async () => {
  const html = await boardHtml([{ ...mine, win_by_order: true }], () => true)
  expect(html).toContain('data-group="{&quot;name&quot;:&quot;crm-opportunities&quot;,&quot;put&quot;:false}"')
})

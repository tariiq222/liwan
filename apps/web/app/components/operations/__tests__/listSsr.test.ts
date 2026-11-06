import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'

// Exercise both production list templates before onMounted, including permission/error/empty branches.
async function renderList(kind: 'operations' | 'crm', state: 'rows' | 'empty' | 'error' | 'forbidden') {
  const filename = kind === 'operations' ? new URL('../RequestList.vue', import.meta.url) : new URL('../../crm/opportunity/CrmOpportunityList.vue', import.meta.url)
  const template = parse(readFileSync(filename, 'utf8')).descriptor.template!.content
  const compiled = compileTemplate({ source: template, filename: filename.pathname, id: kind, compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(Vue)
  const rows = state === 'rows' ? [{ id: 2, name: 'Server row' }] : []
  const bindings = {
    hydrated: false, allowed: state !== 'forbidden', can: () => state !== 'forbidden', t: (key: string) => key,
    query: { error: Vue.ref(state === 'error' ? new Error('Failure') : null), isPending: Vue.ref(false), isFetching: Vue.ref(false) },
    items: rows, activeCount: 0, count: 0, selectedState: null, selectedPurpose: null, purposeFilter: false, filters: {}, stageItems: [], sourceItems: [], statusItems: [],
    board: false, canAssign: false, due: false, search: '', personal: false, scope: 'mine', hasFilters: false, columns: [], total: rows.length, page: 1, pages: 1,
    requestTo: () => '/operations/2', recordTo: () => '/crm/opportunities/2', update: () => {}, clearFilters: () => {},
  }
  const app = Vue.createSSRApp({ setup: () => bindings, render })
  const shell = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.filters?.(), slots.search?.(), slots.default?.(), slots.footer?.()]) })
  for (const name of ['SharedRecordNumber', 'NuxtLink', 'SharedPersonAvatar', 'SharedStatusBadge', 'CrmOpportunityBoard', 'CrmCallButton']) app.component(name, shell)
  for (const name of ['SharedListCard', 'SharedFilterBar']) app.component(name, shell)
  for (const name of ['UInput', 'USelect', 'USwitch', 'SharedPersonPicker']) app.component(name, Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('input', attrs) }))
  for (const name of ['SharedForbiddenState', 'SharedPageState', 'SharedEmptyState']) app.component(name, Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('p', { 'data-state': name }, attrs.title as string || name) }))
  app.component('SharedListFooter', shell)
  app.component('SharedDataTable', Vue.defineComponent({ props: ['rows'], setup: props => () => Vue.h('table', (props.rows as any[]).map(row => Vue.h('tr', row.name))) }))
  return renderToString(app)
}

for (const kind of ['operations', 'crm'] as const) {
  it(`${kind} renders data before hydration while filters remain disabled`, async () => {
    const html = await renderList(kind, 'rows')
    expect(html).toContain('Server row')
    expect(html).toContain('disabled')
  })
  it.each(['empty', 'error', 'forbidden'] as const)(`${kind} renders its %s state during SSR`, async state => {
    expect(await renderList(kind, state)).toContain(state === 'empty' ? 'SharedEmptyState' : state === 'error' ? 'SharedPageState' : 'SharedForbiddenState')
  })
}

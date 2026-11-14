import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as tenantExport from '../../../utils/tenantExport'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../TenantExportPanel.vue')
const root = resolve(__dirname, '../../../..')
const strings = JSON.parse(readFileSync(resolve(root, 'i18n/locales/en/settings.json'), 'utf8')).settings.tenantExport as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(strings, 'settings.tenantExport.')
const box = (tag = 'div') => Vue.defineComponent({ inheritAttrs: false, props: ['title', 'rows'], setup: (p, { attrs, slots }) => () => Vue.h(tag, attrs, [p.title, slots.default?.()]) })
// The table stub draws the cell slots so the row content is checked, not the table library.
const Table = Vue.defineComponent({
  inheritAttrs: false, props: ['rows'],
  setup: (p, { slots }) => () => Vue.h('div', (p.rows as any[]).map(row => Vue.h('div', { 'data-row': row.id }, ['state-cell', 'counts-cell', 'actions-cell'].map(name => (slots as any)[name]?.({ row: { original: row } })))))
})
const Badge = Vue.defineComponent({ props: ['label'], setup: p => () => Vue.h('span', p.label) })
const base = { id: 1, state: 'done', requested_at: '2030-01-10T08:00:00Z', started_at: null, steps_done: 0, steps_total: 0, finished_at: '2030-01-10T08:20:00Z', expires_at: null, failure: null, size_bytes: 1, counts: { rows: { a: 2, b: 3 }, files: 4, file_bytes: 9, overflow_cells: 0 }, downloadable: true }
const render = (props: Record<string, unknown>) => renderShared(component, { timezone: 'Asia/Riyadh', retentionDays: 7, ...props }, {}, {
  hydrated: true, messages,
  stubs: { SharedRecordSection: box('section'), SharedDataTable: Table, SharedStatusBadge: Badge, SharedEmptyState: box('div') },
  modules: { '@liwan/ui/app/utils/formatDate': { formatDateTime: (v: string) => v }, '@/utils/tenantExport': tenantExport },
  globals: { computed: Vue.computed },
})

describe('TenantExportPanel', () => {
  it('explains the contents, the exclusions, the wait and the retention taken from the server', async () => {
    const html = await render({ exports: [] })
    for (const key of ['contents.workbooks', 'contents.files', 'contents.manifest', 'never', 'takesTime']) expect(html).toContain(messages[`settings.tenantExport.${key}`])
    expect(html).toContain('for 7 days')
    expect(html).toContain('data-testid="tenant-export-empty"')
    expect(await render({ exports: [], retentionDays: undefined })).not.toContain('days')
  })
  it('disables the request with the reason while a job is queued or running', async () => {
    const busy = await render({ exports: [{ ...base, state: 'running', counts: null, downloadable: false }] })
    expect(busy).toContain('data-testid="tenant-export-busy"')
    expect(busy).toMatch(/<button[^>]*\bdisabled\b[^>]*data-testid="tenant-export-request"/)
    expect(await render({ exports: [base] })).not.toContain('tenant-export-busy')
  })
  it('offers a download only for a finished export and shows the failure reason', async () => {
    const html = await render({ exports: [base, { ...base, id: 2, state: 'failed', downloadable: false, counts: null, failure: { code: 'insufficient_disk', message: 'x' } }] })
    expect(html.match(/data-testid="tenant-export-download"/g)).toHaveLength(1)
    expect(html).toContain(messages['settings.tenantExport.failures.diskSpace'])
    expect(html).toContain('5 records, 4 files')
  })
})

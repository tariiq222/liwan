import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import GlobalSearch from '../../app/components/shell/GlobalSearch.vue'
import { usePalette, type PaletteView } from '../../app/composables/usePalette'
import { readOnlyShellMe } from '../fixtures/shell'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/GlobalSearch',
  component: GlobalSearch,
  parameters: { msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof GlobalSearch>
export default meta
type Story = StoryObj<typeof meta>

const context = storyContext('apps/web/app/components/shell/ShellHeader.vue:76')
const template = '<div class="webvue-shell-header-actions"><GlobalSearch /></div>'
/** The palette already open: the state is set in setup, after the global loader resets the shim state. */
const opened = (view: PaletteView = 'main', term = '') => () => ({
  components: { GlobalSearch },
  setup: () => { usePalette().show(view, term) },
  template,
})
const withTasks = (resolver: Parameters<typeof http.get>[1]) =>
  ({ msw: { handlers: { api: [http.get('/api/v1/tasks', resolver), ...shellHandlers] } } })

export const Default: Story = {
  name: 'زر البحث',
  parameters: context,
  render: () => ({ components: { GlobalSearch }, template }),
}
export const PaletteMain: Story = { name: 'لوحة الأوامر', parameters: context, render: opened() }
export const PaletteSearch: Story = {
  name: 'نتائج البحث',
  parameters: { ...context, ...withTasks(() => HttpResponse.json({ items: [], total: 0 })) },
  render: opened('main', 'مشروع'),
}
export const PaletteError: Story = {
  name: 'تعذّر البحث',
  parameters: { ...context, ...withTasks(() => HttpResponse.json({ code: 'server_error', message: 'Storybook' }, { status: 500 })) },
  render: opened('main', 'مشروع'),
}
export const PaletteShortcuts: Story = { name: 'اختصارات لوحة المفاتيح', parameters: context, render: opened('shortcuts') }
export const PaletteReadOnly: Story = {
  name: 'قارئ بلا صلاحية إنشاء',
  parameters: { ...context, msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(readOnlyShellMe)), ...shellHandlers] } } },
  render: opened(),
}

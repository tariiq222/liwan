import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import AiRunList from '../../app/components/ai/AiRunList.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Ai/RunList',
  render: () => ({ components: { AiRunList }, template: '<div class="h-[28rem] w-72 border border-default"><AiRunList /></div>' }),
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/modules/ai/manifest.ts:13') },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const now = Date.now()
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString()
const runs = [
  { run_id: 'r_1', title: 'ما مهامي المتأخرة؟', status: 'done', updated_at: hoursAgo(0.1), archived: false },
  { run_id: 'r_2', title: 'جهّز لي مشروع بوابة العملاء', status: 'waiting_user', updated_at: hoursAgo(30), archived: false },
  { run_id: 'r_3', title: 'لخّص حالة المشاريع النشطة مع أهم المخاطر وأقرب التسليمات لهذا الربع', status: 'failed', updated_at: hoursAgo(24 * 9), archived: false },
  { run_id: 'r_4', title: null, status: 'done', updated_at: hoursAgo(24 * 40), archived: false },
]
const archivedRuns = [
  { run_id: 'r_8', title: 'مقارنة ميزانيات الربع الماضي', status: 'done', updated_at: hoursAgo(24 * 20), archived: true },
  { run_id: 'r_9', title: 'ملخص اجتماع الإطلاق', status: 'done', updated_at: hoursAgo(24 * 55), archived: true },
]
const listing = (items: unknown[], archived: unknown[] = []) => [
  http.get('/api/v1/me', () => HttpResponse.json(me)),
  http.get('/api/ai/runs', ({ request }) => {
    const rows = new URL(request.url).searchParams.get('archived') === 'true' ? archived : items
    return HttpResponse.json({ items: rows, total: rows.length })
  }),
  http.patch('/api/ai/runs/:id', async ({ params, request }) => {
    const row = [...items, ...archived].find(item => (item as { run_id: string }).run_id === params.id)
    return HttpResponse.json({ ...(row as object), ...(await request.json() as object) })
  }),
]
const refuse = [
  ...listing(runs, archivedRuns).slice(0, 2),
  http.patch('/api/ai/runs/:id', () => HttpResponse.json({ data: { code: 'invalid', message: 'تعذّر حفظ الاسم' } }, { status: 422 })),
]

export const History: Story = { name: 'سجل المحادثات', parameters: { msw: { handlers: { api: listing(runs, archivedRuns) } } } }
export const Empty: Story = { name: 'لا محادثات بعد', parameters: { msw: { handlers: { api: listing([]) } } } }
export const Loading: Story = {
  name: 'يُحمَّل',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(me)), http.get('/api/ai/runs', async () => { await delay('infinite') })] } } },
}
export const Failed: Story = {
  name: 'تعذّر التحميل',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(me)), http.get('/api/ai/runs', () => HttpResponse.json({ data: { code: 'ai_upstream', message: 'down' } }, { status: 502 }))] } } },
}
export const Searching: Story = {
  ...History,
  name: 'بحث في المحادثات',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByTestId('ai-run-search'), 'مهامي')
    await waitFor(() => expect(canvas.getAllByTestId('ai-run-item')).toHaveLength(1))
  },
}
export const Archived: Story = {
  ...History,
  name: 'المحادثات المؤرشفة',
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('ai-view-archived'))
    await waitFor(() => expect(within(canvasElement).getAllByTestId('ai-run-item')).toHaveLength(archivedRuns.length))
  },
}
export const NoArchived: Story = {
  ...History,
  name: 'لا مؤرشفة',
  parameters: { msw: { handlers: { api: listing(runs) } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('ai-view-archived'))
    await within(canvasElement).findByText('لا محادثات مؤرشفة')
  },
}
export const Renaming: Story = {
  ...History,
  name: 'تغيير الاسم في مكانه',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [first] = await canvas.findAllByRole('button', { name: /خيارات المحادثة/ })
    await userEvent.click(first!)
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'تغيير الاسم' }))
    await canvas.findByTestId('ai-run-rename-input')
  },
}
export const RenameRefused: Story = {
  ...Renaming,
  name: 'رفض الاسم الجديد',
  parameters: { msw: { handlers: { api: refuse } } },
  play: async (context) => {
    await Renaming.play!(context)
    const input = await within(context.canvasElement).findByTestId('ai-run-rename-input')
    await userEvent.type(input, ' جديد{Enter}')
    await within(context.canvasElement).findByRole('alert')
  },
}
export const MobileDisclosure: Story = {
  ...History,
  name: 'قائمة قابلة للطي على الجوال',
  render: () => ({ components: { AiRunList }, template: '<div class="w-[22rem]"><AiRunList disclosure /></div>' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByTestId('ai-history-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    await waitFor(() => expect(canvas.getAllByTestId('ai-run-item')).toHaveLength(runs.length))
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getAllByTestId('ai-run-item')[0]!)
    await waitFor(() => expect(canvas.queryByTestId('ai-run-list-body')).toBeNull())
  },
}

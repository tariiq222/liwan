import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesVisibilityCard from '../../app/components/sales/settings/SalesVisibilityCard.vue'
import { storyContext } from '../support/context'
import { meWith, salesSettings } from './salesFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const save = http.patch('/api/v1/sales/settings', async ({ request }) => HttpResponse.json({ ...salesSettings, ...await request.json() as object, revision: 4 }))
const conflict = http.patch('/api/v1/sales/settings', () => HttpResponse.json({ code: 'conflict', message: 'Sales settings changed; reload before saving' }, { status: 409 }))

const meta = {
  title: 'Sales/SalesVisibilityCard',
  component: SalesVisibilityCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/index.vue:31'), msw: { handlers: { api: [manage, save] } } },
  args: { settings: salesSettings, canEdit: true, reloadSettings: async () => ({ ...salesSettings, revision: 4 }) },
} satisfies Meta<typeof SalesVisibilityCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...salesSettings, can_manage: false } } }
export const Conflict: Story = { name: 'تعارض المراجعة', parameters: { msw: { handlers: { api: [manage, conflict] } } } }

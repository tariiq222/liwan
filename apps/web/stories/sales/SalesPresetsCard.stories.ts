import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesPresetsCard from '../../app/components/sales/settings/SalesPresetsCard.vue'
import { storyContext } from '../support/context'
import { meWith, salesSettings } from './salesFixtures'
import { bridgePresets, bridgeSettings, presets } from './salesTemplateFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const save = http.patch('/api/v1/sales/settings', async ({ request }) => HttpResponse.json({ ...salesSettings, ...await request.json() as object, revision: 4 }))
const conflict = http.patch('/api/v1/sales/settings', () => HttpResponse.json({ code: 'conflict', message: 'Sales settings changed; reload before saving' }, { status: 409 }))
const list = http.get('/api/v1/sales/settings/presets', () => HttpResponse.json({ items: presets, total: presets.length }))

const meta = {
  title: 'Sales/SalesPresetsCard',
  component: SalesPresetsCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/index.vue:39', 'قوالب الإعدادات حسب القطاع: اختر قالبًا لترى الإعدادات التي سيغيّرها، ثم أكّد التطبيق.'), msw: { handlers: { api: [manage, list, save] } } },
  args: { settings: salesSettings, presets, canEdit: true, reloadSettings: async () => ({ ...salesSettings, revision: 4 }), reloadPresets: async () => undefined },
} satisfies Meta<typeof SalesPresetsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Choose: Story = { name: 'اختيار قالب' }
export const WithBridges: Story = { name: 'مع إعدادات الجسور', args: { settings: bridgeSettings, presets: bridgePresets } }
export const Current: Story = { name: 'قالب مطابق للإعدادات', args: { presets: presets.map(preset => preset.key === 'services' ? { ...preset, matches: true } : preset), settings: { ...salesSettings, ...presets[0]!.values } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...salesSettings, can_manage: false } } }
export const Conflict: Story = { name: 'تعارض المراجعة', parameters: { msw: { handlers: { api: [manage, list, conflict] } } } }

import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse, delay } from 'msw'
import type { ChatSettings } from '@liwan/contracts'
import ChatSettingsCard from '../../app/components/chat/ChatSettingsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const settings: ChatSettings = {
  values: { message_delete_mode: 'placeholder' },
  defaults: { message_delete_mode: 'placeholder' },
  options: { message_delete_mode: ['placeholder', 'permanent'] },
  revision: 3,
}
const changedElsewhere: ChatSettings = { ...settings, values: { message_delete_mode: 'permanent' }, revision: 4 }
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['chat.settings.manage'] }))
const save = http.patch('/api/v1/chat/settings', async ({ request }) => {
  const body = await request.json() as { values: ChatSettings['values'] }
  return HttpResponse.json({ ...settings, values: body.values, revision: 4 })
})
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/chat/settings', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Chat/ChatSettingsCard',
  component: ChatSettingsCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/chat/index.vue:25', 'ماذا يحدث عند حذف رسالة: تبقى عبارة «حُذفت هذه الرسالة» أو حذف نهائي، يُحفظ مع رقم المراجعة ويُعاد التحميل عند التعارض.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, reloadSettings: async () => changedElsewhere },
} satisfies Meta<typeof ChatSettingsCard>
export default meta
type Story = StoryObj<typeof meta>

export const KeepsADeletedRow: Story = {}
export const DeletesForGood: Story = { args: { settings: changedElsewhere } }
export const Saving: Story = { parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/chat/settings', async () => { await delay(10_000); return HttpResponse.json({ ...settings, revision: 4 }) })] } } } }
export const SaveError: Story = refuse(503, { code: 'unavailable', message: 'تعذّر حفظ الإعدادات الآن' })
export const Conflict: Story = refuse(409, { code: 'conflict', message: 'Chat settings changed; reload before saving' })

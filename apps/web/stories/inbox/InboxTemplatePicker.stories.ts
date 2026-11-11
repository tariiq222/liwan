import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { InboxTemplate } from '@liwan/contracts'
import { http, HttpResponse } from 'msw'
import { ref } from 'vue'
import InboxTemplatePicker from '../../app/components/inbox/InboxTemplatePicker.vue'
import { storyContext } from '../support/context'

const template = (id: number, rest: Partial<InboxTemplate> = {}): InboxTemplate => ({
  id, name: `template_${id}`, language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green', header: null,
  body: 'مرحبا {{1}}', body_examples: ['فهد'], footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null, param_count: 1, editable: true, otp_button_text: null, supported: true, ...rest,
})
// 120 approved templates: the server returns the first 50 whose name contains `q`, and the total of all matches.
const many = Array.from({ length: 120 }, (_, index) => template(index + 1, { category: index % 3 === 0 ? 'marketing' : 'utility' }))
const few = many.slice(0, 4)
const server = (all: InboxTemplate[]) => [
  http.get('/api/v1/inbox/channels/:id/templates', ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? ''
    const matches = all.filter(item => item.name.includes(q))
    return HttpResponse.json({ items: matches.slice(0, 50), total: matches.length })
  }),
  http.get('/api/v1/inbox/templates/:id', ({ params }) => {
    const found = all.find(item => item.id === Number(params.id))
    return found ? HttpResponse.json(found) : HttpResponse.json({ code: 'not_found', message: 'not found' }, { status: 404 })
  }),
]

const meta = {
  title: 'Inbox/InboxTemplatePicker',
  component: InboxTemplatePicker,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/campaigns/InboxCampaignForm.vue:180', 'قائمة قوالب القناة المعتمدة مع بحث بالاسم من الخادم: تعرض أول خمسين نتيجة وتنبّه عند وجود المزيد، ويبقى القالب المختار ظاهرًا ولو خرج من الصفحة.'),
    msw: { handlers: { templates: server(many) } },
  },
  args: { channelId: 1, modelValue: null },
  render: args => ({
    components: { InboxTemplatePicker },
    setup() {
      const templateId = ref<number | null>(args.modelValue)
      const picked = ref<InboxTemplate | null>(null)
      return { args, templateId, picked }
    },
    template: `<div class="max-w-md"><InboxTemplatePicker v-model="templateId" v-model:template="picked" :channel-id="args.channelId" :accept="args.accept" :disabled="args.disabled" :invalid="args.invalid"><template #empty><p class="text-sm text-muted">لا توجد قوالب معتمدة لهذه القناة.</p></template></InboxTemplatePicker></div>`,
  }),
} satisfies Meta<typeof InboxTemplatePicker>
export default meta
type Story = StoryObj<typeof meta>

export const Defaults: Story = {}
export const ChosenBeyondTheFirstPage: Story = { args: { modelValue: 99 } }
export const FewTemplates: Story = { parameters: { msw: { handlers: { templates: server(few) } } } }
export const NoTemplates: Story = { parameters: { msw: { handlers: { templates: server([]) } } } }
export const MarketingOnly: Story = { args: { accept: item => item.category === 'marketing' } }
export const Failed: Story = { parameters: { msw: { handlers: { templates: [http.get('/api/v1/inbox/channels/:id/templates', () => HttpResponse.json({ code: 'server_error', message: 'تعذّر' }, { status: 500 }))] } } } }
export const Invalid: Story = { args: { invalid: true } }
export const Disabled: Story = { args: { disabled: true, modelValue: 2 } }
export const NoChannel: Story = { args: { channelId: null } }

import type { Meta, StoryObj } from '@storybook/vue3-vite'
import IntegrationProviderGuide from '../../app/components/settings/IntegrationProviderGuide.vue'
import { storyContext } from '../support/context'
import { meta as metaConnection, twilio as twilioConnection } from './integrationFixtures'

const meta = {
  title: 'Settings/IntegrationProviderGuide', component: IntegrationProviderGuide,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/settings/IntegrationConnectionForm.vue:93', 'دليل ربط مزوّد: خطوات واتساب عند Meta وحقائق حساب Twilio، وبعد الحفظ تعرض الخطوة القابلة للفحص ما يقرؤه الاتصال المحفوظ فقط.') },
  args: { code: 'meta' },
  render: args => ({ components: { IntegrationProviderGuide }, setup: () => ({ args }), template: '<div class="max-w-xl"><IntegrationProviderGuide v-bind="args" /></div>' }),
} satisfies Meta<typeof IntegrationProviderGuide>
export default meta
type Story = StoryObj<typeof meta>

export const BeforeSave: Story = { name: 'واتساب قبل الحفظ' }
export const Connected: Story = { name: 'واتساب متصل', args: { connection: metaConnection } }
export const Refused: Story = {
  name: 'رفض المزوّد الرمز',
  args: { connection: { ...metaConnection, state: 'error', status_message: 'رفض المزوّد الرمز.', secrets: [{ name: 'access_token', present: true }, { name: 'app_secret', present: true }, { name: 'verify_token', present: true }] } },
}
export const Incomplete: Story = {
  name: 'مفاتيح ناقصة',
  args: { connection: { ...metaConnection, state: 'pending', last_checked: null, secrets: [{ name: 'access_token', present: true }, { name: 'app_secret', present: false }, { name: 'verify_token', present: false }] } },
}
export const TwilioBeforeSave: Story = { name: 'Twilio قبل الحفظ', args: { code: 'twilio' } }
export const TwilioConnected: Story = { name: 'Twilio متصل', args: { code: 'twilio', connection: twilioConnection } }
export const TwilioRefused: Story = {
  name: 'Twilio رفض الرمز',
  args: { code: 'twilio', connection: { ...twilioConnection, state: 'error', status_message: 'رفض المزوّد المفاتيح.' } },
}

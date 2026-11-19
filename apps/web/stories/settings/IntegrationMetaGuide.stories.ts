import type { Meta, StoryObj } from '@storybook/vue3-vite'
import IntegrationMetaGuide from '../../app/components/settings/IntegrationMetaGuide.vue'
import { storyContext } from '../support/context'
import { meta as metaConnection } from './integrationFixtures'

const meta = {
  title: 'Settings/IntegrationMetaGuide', component: IntegrationMetaGuide,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/settings/IntegrationConnectionForm.vue:92', 'دليل ربط واتساب: خمس خطوات عند Meta، وبعد الحفظ تعرض كل خطوة ما يقرؤه الاتصال المحفوظ فقط.') },
  render: args => ({ components: { IntegrationMetaGuide }, setup: () => ({ args }), template: '<div class="max-w-xl"><IntegrationMetaGuide v-bind="args" /></div>' }),
} satisfies Meta<typeof IntegrationMetaGuide>
export default meta
type Story = StoryObj<typeof meta>

export const BeforeSave: Story = { name: 'قبل الحفظ' }
export const Connected: Story = { name: 'متصل', args: { connection: metaConnection } }
export const Refused: Story = {
  name: 'رفض المزوّد الرمز',
  args: { connection: { ...metaConnection, state: 'error', status_message: 'رفض المزوّد الرمز.', secrets: [{ name: 'access_token', present: true }, { name: 'app_secret', present: true }, { name: 'verify_token', present: true }] } },
}
export const Incomplete: Story = {
  name: 'مفاتيح ناقصة',
  args: { connection: { ...metaConnection, state: 'pending', last_checked: null, secrets: [{ name: 'access_token', present: true }, { name: 'app_secret', present: false }, { name: 'verify_token', present: false }] } },
}

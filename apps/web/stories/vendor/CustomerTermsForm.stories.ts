import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CustomerTermsForm from '../../app/components/vendor/CustomerTermsForm.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Vendor/CustomerTermsForm', component: CustomerTermsForm, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/customers/[id]/terms/new.vue:42') }, args: {} } satisfies Meta<typeof CustomerTermsForm>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Busy: Story = { args: { busy: true } }
export const Failed: Story = { args: { error: { status: 422, code: 'invalid' } } }

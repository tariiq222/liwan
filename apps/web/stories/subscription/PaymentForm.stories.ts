import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PaymentForm from '../../app/components/subscription/PaymentForm.vue'
import { storyContext } from '../support/context'
// The provider's real card form needs the payment provider, so these stories use the stand-in key the test stack serves: the page
// shows a labelled stand-in and never contacts the provider.
const session = {
  attempt_id: '00000000-0000-4000-8000-0000000000a1', intent: { id: 'intent-stand-in-1', client_secret: 'secret-stand-in-1' },
  publishable_key: 'pk_stand_in', amount: { minor: 34_500, currency: 'SAR', exponent: 2 }, expires_at: '2099-01-01T00:00:00.000Z',
}
const meta = { title: 'Subscription/PaymentForm', component: PaymentForm, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/pay/[order].vue:118') }, args: { session, saveCard: false } } satisfies Meta<typeof PaymentForm>
export default meta
type Story = StoryObj<typeof meta>
export const StandInNotSaving: Story = {}
export const StandInSavingCard: Story = { args: { saveCard: true } }

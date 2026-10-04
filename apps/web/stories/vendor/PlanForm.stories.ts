import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PlanForm from '../../app/components/vendor/PlanForm.vue'
import { storyContext } from '../support/context'
const policy = { id: '00000000-0000-4000-8000-000000000004', timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive' as const, rate_bps: 1500 } }
const meta = { title: 'Vendor/PlanForm', component: PlanForm, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/plans/new.vue:25') }, args: { bundles: [], policy } } satisfies Meta<typeof PlanForm>
export default meta
type Story = StoryObj<typeof meta>
export const Create: Story = {}
export const Saving: Story = { args: { busy: true } }
export const Conflict: Story = { args: { error: { status: 409, data: { code: 'revision_conflict' } }, requireReason: true } }

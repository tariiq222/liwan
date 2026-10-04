import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BundleForm from '../../app/components/vendor/BundleForm.vue'
import { storyContext } from '../support/context'
import { release } from './fixtures'
const meta = { title: 'Vendor/BundleForm', component: BundleForm, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/bundles/new.vue:39') }, args: { releases: [release] } } satisfies Meta<typeof BundleForm>
export default meta
type Story = StoryObj<typeof meta>
export const Create: Story = {}
export const Saving: Story = { args: { busy: true } }
export const Conflict: Story = { args: { error: { status: 409, data: { code: 'revision_conflict' } }, requireReason: true } }
export const PriceMissing: Story = { args: { error: { status: 422, data: { code: 'price_missing', field: 'prices' } } } }

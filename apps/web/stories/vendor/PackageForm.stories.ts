import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PackageForm from '../../app/components/vendor/PackageForm.vue'
import { storyContext } from '../support/context'
const meta = {
  title: 'Vendor/PackageForm', component: PackageForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/catalog/new.vue:17') },
  args: { catalogs: [{ id: 'source', version: '2026.10', status: 'published', solution: { base_modules: ['nasq_core', 'nasq_platform', 'nasq_api'], tiers: [{ id: 'projects', modules: ['nasq_pmo'], features: ['boolean:pmo.enabled', 'boolean:meetings.enabled', 'limit:projects.max_projects'] }, { id: 'people', modules: ['nasq_hr'], features: ['boolean:hr.enabled'] }] } }] },
} satisfies Meta<typeof PackageForm>
export default meta
type Story = StoryObj<typeof meta>
export const Create: Story = {}
export const Saving: Story = { args: { busy: true } }
export const SaveConflict: Story = { args: { error: { data: { code: 'package_revision_conflict' } } } }

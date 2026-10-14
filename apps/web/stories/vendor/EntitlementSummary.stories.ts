import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EntitlementSummary from '../../app/components/vendor/EntitlementSummary.vue'
import { storyContext } from '../support/context'
import { release } from './fixtures'
const meta = { title: 'Vendor/EntitlementSummary', component: EntitlementSummary, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/vendor/bundles/[id].vue:31') },
  args: { release, selections: [{ app_id: 'projects', feature_keys: ['meetings.enabled'] }], limits: { 'projects.max_projects': 20, 'users.limit': null } } } satisfies Meta<typeof EntitlementSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const NoZeroCoercion: Story = { args: { limits: { 'projects.max_projects': 0 } } }
export const Empty: Story = { args: { selections: [], limits: {} } }

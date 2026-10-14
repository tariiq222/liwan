import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RequestList from '../../app/components/operations/RequestList.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'
import { operationHandlers } from './fixtures'
const meta = { title: 'Operations/RequestList', component: RequestList, render: args => ({ components: { RequestList, PageContainer }, setup: () => ({ args }), template: '<PageContainer width="list"><RequestList v-bind="args" /></PageContainer>' }), parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/operations/index.vue:4'), msw: { handlers: { api: operationHandlers } } }, args: { scope: 'mine' } } satisfies Meta<typeof RequestList>
export default meta
type Story = StoryObj<typeof meta>
export const Mine: Story = {}
export const Pending: Story = { args: { scope: 'pending' } }
export const Monitoring: Story = { args: { scope: 'monitoring' } }

import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProcessList from '../../app/components/operations/ProcessList.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { operationHandlers } from './fixtures'
const meta = { title: 'Operations/ProcessList', component: ProcessList, render: args => ({ components: { ProcessList, PageContainer }, setup: () => ({ args }), template: '<PageContainer width="list"><ProcessList v-bind="args" /></PageContainer>' }), parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/operations/processes/index.vue:4'), msw: { handlers: { api: operationHandlers } } } } satisfies Meta<typeof ProcessList>
export default meta
type Story = StoryObj<typeof meta>
export const Published: Story = {}

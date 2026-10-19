import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProcessForm from '../../app/components/operations/ProcessForm.vue'
import { storyContext } from '../support/context'
import { operationHandlers, process } from './fixtures'
const meta = {
  title: 'Operations/ProcessForm', component: ProcessForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/operations/processes/new.vue:19'), msw: { handlers: { api: operationHandlers } } },
  args: { backTo: '/settings/apps/operations/processes', save: async body => ({ ...process, ...body, state: 'draft', revision: 3, steps: body.steps.map((step, index) => ({ ...step, reviewers: process.steps[index]?.reviewers ?? [] })) }) },
} satisfies Meta<typeof ProcessForm>
export default meta
type Story = StoryObj<typeof meta>
export const Create: Story = {}
export const PublishedRevision: Story = { args: { process } }
export const Disabled: Story = { args: { process, disabled: true } }

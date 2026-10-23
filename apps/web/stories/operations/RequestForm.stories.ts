import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RequestForm from '../../app/components/operations/RequestForm.vue'
import { storyContext } from '../support/context'
import { draft, operationHandlers, process } from './fixtures'
const meta = {
  title: 'Operations/RequestForm', component: RequestForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/operations/RequestCreate.vue:24'), msw: { handlers: { api: operationHandlers } } },
  args: { backTo: '/operations', processes: [process], save: async body => ({ ...draft, name: body.name, description: body.description }) },
} satisfies Meta<typeof RequestForm>
export default meta
type Story = StoryObj<typeof meta>
export const Create: Story = {}
export const EditReturned: Story = { args: { record: { ...draft, state: 'returned' } } }
export const LoadingChoices: Story = { args: { loading: true, processes: [] } }
export const PermissionDenied: Story = { args: { processError: { status: 403 }, disabled: true } }
export const RelatedTask: Story = { args: { processes: [{ ...process, execution_kind: 'pmo_completion' }] } }

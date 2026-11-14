import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DeleteWorkspacePanel from '../../app/components/subscription/DeleteWorkspacePanel.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Subscription/DeleteWorkspacePanel', component: DeleteWorkspacePanel, parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:191') },
  args: { deletion: null, hydrated: true } } satisfies Meta<typeof DeleteWorkspacePanel>
export default meta
type Story = StoryObj<typeof meta>
export const NotRequested: Story = {}
export const WaitingForCode: Story = { args: { deletion: { state: 'requested', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: '2026-11-20T09:15:00.000Z', confirmed_at: null, due_at: null, hold_until: null, can_withdraw: true } } }
export const Scheduled: Story = { args: { deletion: { state: 'confirmed', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: null, confirmed_at: '2026-11-20T09:05:00.000Z', due_at: '2026-12-20T09:05:00.000Z', hold_until: null, can_withdraw: true } } }
export const FinalHold: Story = { args: { deletion: { state: 'due', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: null, confirmed_at: '2026-11-20T09:05:00.000Z', due_at: '2027-02-18T09:05:00.000Z', hold_until: '2027-02-21T09:05:00.000Z', can_withdraw: true } } }
export const Deleting: Story = { args: { deletion: { state: 'deleting', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: null, confirmed_at: '2026-11-20T09:05:00.000Z', due_at: '2027-02-18T09:05:00.000Z', hold_until: '2027-02-21T09:05:00.000Z', can_withdraw: false } } }
export const Saving: Story = { args: { pending: true } }
export const Failed: Story = { args: { deletion: { state: 'requested', requested_at: '2026-11-20T09:00:00.000Z', code_expires_at: '2026-11-20T09:15:00.000Z', confirmed_at: null, due_at: null, hold_until: null, can_withdraw: true }, error: 'The code is wrong or expired. Check it, or send a new code.' } }

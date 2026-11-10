import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { trialEndPreviewSchema } from '@liwan/commercial-contracts'
import TrialEndPanel from '../../app/components/subscription/TrialEndPanel.vue'
import { storyContext } from '../support/context'
import { quote } from '../shared/commerceFixtures'

const kept = '00000000-0000-4000-8000-000000000001'
const locked = '00000000-0000-4000-8000-000000000002'
const preview = trialEndPreviewSchema.parse({
  status: 'trialing',
  trial_ends_at: '2026-12-01T21:00:00Z',
  outcome: null,
  kept: { bundle_revision_ids: [kept], paid_users: 2, paid_storage_gb: 10, paid_extra_branches: 1 },
  locked_bundle_revision_ids: [locked],
  limits: { users: 5, storage_mb: 30_720, extra_branches: 1 },
  excess: { users: 1, storage_bytes: 5_242_880, extra_branches: 0, sampled_at: '2026-11-30T09:00:00Z', source: 'usage_snapshot', item_details: 'unavailable' },
  first_invoice: { ...quote, requested_users: 5, requested_storage_mb: 30_720 },
  next_attempt_at: null,
})

const meta = {
  title: 'Subscription/TrialEndPanel',
  component: TrialEndPanel,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/subscription/index.vue:95') },
  args: { preview, bundleNames: { [kept]: 'Projects', [locked]: 'Inbox' }, canManageTeam: true, canOpenDocuments: true, canOpenStorage: true, canReadBranches: true },
} satisfies Meta<typeof TrialEndPanel>
export default meta

type Story = StoryObj<typeof meta>
export const TrialActive: Story = {}
export const ApplyingLock: Story = {
  args: { preview: { ...preview, status: 'lock_pending', next_attempt_at: '2026-12-01T21:05:00Z' } },
}
export const UsageUnavailable: Story = {
  args: {
    preview: { ...preview, excess: { ...preview.excess, users: null, storage_bytes: null, sampled_at: null, source: 'unavailable' } },
    bundleNames: {},
  },
}
export const FreeBase: Story = {
  args: { preview: { ...preview, status: 'settled', outcome: 'free_base', first_invoice: null, kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 } } },
}

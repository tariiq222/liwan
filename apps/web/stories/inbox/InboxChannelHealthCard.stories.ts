import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InboxChannelHealthCard from '../../app/components/inbox/InboxChannelHealthCard.vue'
import { storyContext } from '../support/context'
import { activeHealth } from './inboxHealthFixtures'

const meta = {
  title: 'Inbox/InboxChannelHealthCard',
  component: InboxChannelHealthCard,
  parameters: storyContext('apps/web/app/pages/settings/apps/inbox/channels/[id]/health.vue:65', 'مقاييس رقم واتساب كما أبلغت بها ميتا: الجودة والحد والسعة والاسم، مع شريط حالة الحساب عند وجود مشكلة.'),
  args: { health: activeHealth },
} satisfies Meta<typeof InboxChannelHealthCard>
export default meta
type Story = StoryObj<typeof meta>
export const Healthy: Story = {}
export const LowQuality: Story = { args: { health: { ...activeHealth, quality_rating: 'red', messaging_limit: 'tier_250' } } }
export const NameUnderReview: Story = { args: { health: { ...activeHealth, name_status: 'pending_review', requested_name: 'عيادة الأمل للأسنان' } } }
export const NameRejected: Story = { args: { health: { ...activeHealth, name_status: 'declined', requested_name: 'عيادة الأمل للأسنان', name_rejection_reason: 'NAME_NOT_CONSISTENT' } } }
export const Restricted: Story = { args: { health: { ...activeHealth, account_state: 'restricted', account_restricted_until: '2026-11-05T12:00:00Z', quality_rating: 'yellow' } } }
export const ScheduledForDisable: Story = { args: { health: { ...activeHealth, account_state: 'scheduled_for_disable' } } }
export const Disabled: Story = { args: { health: { ...activeHealth, account_state: 'disabled', quality_rating: 'red' } } }
export const NeverChecked: Story = {
  args: { health: { ...activeHealth, display_phone_number: null, verified_name: null, name_status: 'unknown', quality_rating: 'unknown', messaging_limit: 'unknown', throughput_level: 'unknown', code_verified: false, checked_at: null } },
}

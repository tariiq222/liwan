import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellNoticeBar from '../../app/components/shell/ShellNoticeBar.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellNoticeBar',
  component: ShellNoticeBar,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/layouts/default.vue:77', 'الإشعار الواحد للاشتراك أعلى المحتوى: يختاره useShellNotice، وهذا المكوّن يرسم نصه وزره الواحد وإغلاقه إن سمح به.'),
  },
} satisfies Meta<typeof ShellNoticeBar>

export default meta
type Story = StoryObj<typeof meta>

export const PaymentSuspendedManager: Story = {
  name: 'تعليق لعدم السداد لمسؤول الاشتراك',
  args: {
    notice: {
      key: 'payment_suspended', severity: 'error', params: {}, dismissible: false,
      messageKey: 'subscription.notice.paymentSuspended.manager', action: { labelKey: 'subscription.notice.actions.pay', to: '/subscription' },
    },
  },
}
export const PaymentSuspendedMember: Story = {
  name: 'تعليق لعدم السداد لعضو بلا صلاحية الاشتراك',
  args: {
    notice: { key: 'payment_suspended', severity: 'error', params: {}, dismissible: false, messageKey: 'subscription.notice.paymentSuspended.member' },
  },
}
export const TrialEnding: Story = {
  name: 'اقتراب نهاية التجربة قابل للإغلاق',
  args: {
    notice: {
      key: 'trial_ending', level: 'early', severity: 'info', params: { days: 6 }, messageKey: 'subscription.notice.trialEnding',
      action: { labelKey: 'subscription.notice.actions.choosePlan', to: '/subscription/change' }, dismissible: { hours: 24 },
    },
  },
}
export const PaymentOverdue: Story = {
  name: 'دفعة متأخرة',
  args: {
    notice: {
      key: 'payment_overdue', level: 'early', severity: 'warning', params: { date: '2026-12-01', days: 9 }, messageKey: 'subscription.notice.paymentOverdue',
      action: { labelKey: 'subscription.notice.actions.pay', to: '/subscription' }, dismissible: { hours: 24 },
    },
  },
}
export const WorkspaceDeletionScheduled: Story = {
  name: 'حذف مساحة العمل مجدول',
  args: {
    notice: {
      key: 'workspace_deletion', level: 'scheduled', severity: 'warning', params: { date: '2027-02-12' }, messageKey: 'subscription.notice.workspaceDeletion.scheduled',
      action: { labelKey: 'subscription.notice.actions.reviewDeletion', to: '/subscription#delete-workspace' }, dismissible: { hours: 24 },
    },
  },
}
export const WorkspaceDeletionHold: Story = {
  name: 'المهلة الأخيرة قبل الحذف',
  args: {
    notice: {
      key: 'workspace_deletion', level: 'hold', severity: 'error', params: { date: '2027-02-14' }, messageKey: 'subscription.notice.workspaceDeletion.hold',
      action: { labelKey: 'subscription.notice.actions.reviewDeletion', to: '/subscription#delete-workspace' }, dismissible: false,
    },
  },
}

import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import StatusBadge from '@webvue/ui/app/components/shared/data/StatusBadge.vue'
import { operationsStateTone } from '../../app/composables/operations/state'
import { storyContext } from '../support/context'
const meta = { title: 'Operations/StateBadge', component: StatusBadge, parameters: { a11y: { test: 'error' }, ...storyContext('apps/web/app/components/operations/RequestList.vue:81') }, args: { tone: 'info', label: '' } } satisfies Meta<typeof StatusBadge>
export default meta
type Story = StoryObj<typeof meta>
const state = (value: string): Story => ({ render: () => ({ components: { StatusBadge }, setup: () => ({ t: useI18n().t, value, operationsStateTone }), template: '<StatusBadge :tone="operationsStateTone(value)" :label="t(`operations.states.${value}`)" />' }) })
export const Pending: Story = state('pending')
export const Completed: Story = state('done')
export const Returned: Story = state('returned')
export const Rejected: Story = state('rejected')

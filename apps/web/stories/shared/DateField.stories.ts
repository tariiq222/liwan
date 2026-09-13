import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DateField from '../../app/components/shared/DateField.vue'
import FilterBar from '../../app/components/shared/FilterBar.vue'
import FormSection from '../../app/components/shared/FormSection.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DateField',
  component: DateField,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: null, disabled: false, minValue: null, maxValue: null },
} satisfies Meta<typeof DateField>
export default meta
type Story = StoryObj<typeof meta>

const inForm = (error?: string): Story['render'] => args => ({
  components: { DateField, FormSection, PageContainer },
  setup() {
    const { t } = useI18n()
    return { args, t, value: ref(args.modelValue), error: error ? t(error) : undefined }
  },
  template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.sectionSchedule')"><div class="nasq-form-grid"><UFormField :label="t('meetingsUi.date')" name="date" required :error="error"><DateField id="meeting-date" v-model="value" class="w-full" :disabled="args.disabled" :min-value="args.minValue" :max-value="args.maxValue" :aria-invalid="!!error" aria-required="true" /></UFormField></div></FormSection></form></PageContainer></main>`,
})

const formContext = storyContext('apps/web/app/pages/meetings/new.vue:149')

export const InFormField: Story = { name: 'داخل حقل نموذج', parameters: formContext, render: inForm() }
export const WithValue: Story = { name: 'بقيمة', parameters: formContext, args: { modelValue: '2026-09-13' }, render: inForm() }
export const Invalid: Story = { name: 'خطأ تحقق', parameters: formContext, render: inForm('meetingsUx.errors.required') }
export const Disabled: Story = { name: 'معطّل', parameters: formContext, args: { disabled: true }, render: inForm() }

export const InFilterPopover: Story = {
  name: 'داخل نافذة الفلاتر',
  parameters: storyContext('apps/web/app/pages/meetings/index.vue:247', 'نافذة الفلاتر مفتوحة عبر `default-open` في `FilterBar`.'),
  render: () => ({
    components: { DateField, FilterBar, PageContainer },
    setup: () => ({ t: useI18n().t, from: ref<string | null>(null) }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><FilterBar class="w-full" :default-open="true"><div class="grid min-w-0 content-start gap-1"><label for="meeting-date-from" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.fromDateLabel') }}</label><DateField id="meeting-date-from" v-model="from" class="w-full" /></div></FilterBar></PageContainer></main>`,
  }),
}

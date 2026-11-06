import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { reactive } from 'vue'
import SettingsPage from '@liwan/ui/app/components/shared/layout/SettingsPage.vue'
import SettingsCard from '@liwan/ui/app/components/shared/layout/SettingsCard.vue'
import SettingsSaveBar from '@liwan/ui/app/components/shared/layout/SettingsSaveBar.vue'
import { storyContext } from '../support/context'

// The page provides the registry and renders the bar after its cards; each SharedSettingsCard registers itself instead
// of drawing a footer. The cards start edited, so the bar is visible and its two buttons reset or "save" them.
function cards(count: number, failed: boolean) {
  const titles = ['المتابعة', 'الظهور']
  return reactive(Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`,
    title: titles[index] ?? `بطاقة ${index + 1}`,
    dirty: true,
    saving: false,
    reloading: false,
    conflict: false,
    message: failed && index === 0 ? 'تعذّر حفظ الإعدادات الآن' : '',
    reloadFailed: false,
  })))
}

const meta = {
  title: 'Shared/SettingsSaveBar',
  component: SettingsSaveBar,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('packages/ui/app/components/shared/layout/SettingsPage.vue:15', 'شريط حفظ واحد أسفل صفحة الإعدادات: يظهر حين يكون في الصفحة بطاقة غير محفوظة، ويعدّها، ويحفظ المعدّل كله بضغطة أو يرجعها كلها بضغطة. خطأ كل بطاقة يبقى داخلها.'),
  },
} satisfies Meta<typeof SettingsSaveBar>
export default meta
type Story = StoryObj<typeof meta>

const page = (count: number, failed = false): Story['render'] => () => ({
  components: { SettingsPage, SettingsCard },
  setup: () => ({
    cards: cards(count, failed),
    clear: (card: { dirty: boolean; message: string }) => { card.dirty = false; card.message = '' },
    revert: (card: { dirty: boolean; message: string }) => { card.dirty = false; card.message = '' },
  }),
  template: `<main class="liwan-shell-main"><SettingsPage>
    <div class="grid gap-4">
      <SettingsCard v-for="card in cards" :key="card.id" v-bind="card" :can-edit="true" @save="clear(card)" @revert="revert(card)" @reload="() => undefined">
        <UFormField orientation="horizontal" label="محاولات إضافية" description="عدد مرات إعادة الاتصال قبل الإغلاق." name="attempts">
          <UInputNumber :id="card.id + '-attempts'" :model-value="2" class="w-full" />
        </UFormField>
      </SettingsCard>
    </div>
  </SettingsPage></main>`,
})

export const Edited: Story = { name: 'بطاقتان غير محفوظتين', render: page(2) }
export const SaveFailed: Story = { name: 'تعذّر حفظ بطاقة', render: page(2, true) }

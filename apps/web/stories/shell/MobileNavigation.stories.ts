import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MobileNavigation from '../../app/components/shell/MobileNavigation.vue'
import { applicationNavigation } from '../../app/composables/nav/applicationNavigation'
import { contextLinksForModule } from '../../app/composables/nav/shellModules'
import { shellMe } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = { title: 'Shell/MobileNavigation', component: MobileNavigation, parameters: { layout: 'fullscreen' }, args: { items: [], activeId: 'meetings', homeTo: '/' } } satisfies Meta<typeof MobileNavigation>
export default meta
type Story = StoryObj<typeof meta>
export const Open: Story = {
  name: 'القائمة مفتوحة', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:63'),
  render: args => ({
    components: { MobileNavigation },
    setup() {
      const { t } = useI18n()
      const items = computed(() => applicationNavigation({ identity: shellMe, route: { path: '/meetings', fullPath: '/meetings', query: {}, params: {} }, activeId: 'meetings', contextLinks: contextLinksForModule('meetings', shellMe, '/meetings'), translate: t }))
      return { args, items, open: ref(true) }
    },
    template: '<div class="webvue-shell min-h-svh"><MobileNavigation v-bind="args" :items="items" v-model:open="open" /></div>',
  }),
}

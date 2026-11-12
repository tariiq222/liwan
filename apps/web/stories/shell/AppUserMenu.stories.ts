import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppUserMenu from '../../app/components/shell/AppUserMenu.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { http, HttpResponse } from 'msw'
import { shellHandlers } from '../handlers/shell'
import { multiCompanyShellMe } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppUserMenu',
  component: AppUserMenu,
  parameters: { layout: 'centered', msw: { handlers: { api: shellHandlers } }, ...storyContext('apps/web/app/components/shell/AppTopBar.vue:80') },
} satisfies Meta<typeof AppUserMenu>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const render = () => ({ components: { AppUserMenu }, template: '<div class="liwan-shell" style="padding: 24px 24px 240px"><AppUserMenu /></div>' })

export const Closed: Story = { name: 'مغلق: الصورة والاسم والدور', loaders: [at('/tasks')], render }
const openMenu = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector<HTMLButtonElement>('[data-testid="account-menu"]')?.click()
}
export const Open: Story = {
  name: 'مفتوح، شركة واحدة: حسابي والوضع الداكن واللغة وتسجيل الخروج',
  loaders: [at('/tasks')],
  render,
  play: openMenu,
}
export const OpenSeveralCompanies: Story = {
  name: 'مفتوح، عدة شركات: الحالية معلّمة والباقي يبدّل',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(multiCompanyShellMe)), ...shellHandlers] } } },
  loaders: [at('/tasks')],
  render,
  play: openMenu,
}

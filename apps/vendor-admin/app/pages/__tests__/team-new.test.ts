import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountPage } from './pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

async function newAccountPage() {
  const invitation = ref<{ name: string, link: string, expiresAt: string } | null>(null)
  const order: string[] = []
  const team = { busy: ref(false), errorKey: ref(null), invitation, invite: vi.fn(), dismissInvitation: vi.fn(() => { order.push('dismiss'); invitation.value = null }) }
  const navigateTo = vi.fn(async () => { order.push('navigate') })
  const page = await mountPage('team/new.vue', { useTeamActions: () => team, refreshNuxtData: vi.fn(), navigateTo })
  mounted.push(page)
  const guard = async () => (await page.rendered()).captured.find(node => node.name === 'SharedUnsavedChanges')
  return { invitation, order, navigateTo, page, guard }
}

it('guards leaving while the one-time invitation link is shown, and not otherwise', async () => {
  const { invitation, guard } = await newAccountPage()
  expect((await guard())?.props.dirty).toBe(false)
  invitation.value = { name: 'Sara', link: 'https://console.test/enroll#secret', expiresAt: '2026-12-01T00:00:00Z' }
  expect((await guard())?.props.dirty).toBe(true)
})

it('lets the person leave through the dismiss button once the link is released from the guard', async () => {
  const { invitation, order, navigateTo, page } = await newAccountPage()
  invitation.value = { name: 'Sara', link: 'https://console.test/enroll#secret', expiresAt: '2026-12-01T00:00:00Z' }
  const link = (await page.rendered()).captured.find(node => node.name === 'TeamInvitationLink')!
  await link.props.onDismiss()
  expect(order).toEqual(['dismiss', 'navigate'])
  expect(navigateTo).toHaveBeenCalledWith('/team')
})

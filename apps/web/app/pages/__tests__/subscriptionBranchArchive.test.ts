import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { latestOnly } from '../../utils/subscription'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (name: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${name}/subscription.json`)).subscription

describe('branch archive on the subscription branches page', () => {
  const list = read('app/pages/subscription/branches.vue'), row = read('app/components/subscription/BranchSummary.vue'), panel = list
  it('offers archive only to a branches manager, on active extra branches, never on the headquarters', () => {
    expect(list).toContain(`:archivable="can('branches.manage') && hydrated && !archiveBusy"`)
    expect(row).toContain(`v-if="archivable && b.state === 'active'"`)
    expect(row).toContain("summary.items.filter(i => i.kind === 'extra')")
  })
  it('quotes the archive, confirms inline, then places the order and follows it to its status', () => {
    expect(panel).toContain("archive: kind === 'archive' ? [branch.id] : []")
    expect(panel).toContain('<SharedInlineConfirm')
    expect(panel).toContain('api.accept(archiveAction.value, { quote_id: quote.value.id, expected_subscription_revision: quoteRevision.value })')
    expect(panel).toContain("path: '/subscription/status', query: { order: order.id }")
    expect(panel).not.toContain('<UModal')
  })
  it('stops on an expired or stale quote instead of placing it', () => {
    expect(panel).toContain('QUOTE_IS_EXPIRED(quote.value)')
    expect(panel).toContain('statusCode === 409) quote.value = null')
  })
  it('says in both languages that the data stays readable and the branch can be restored', () => {
    for (const name of ['ar', 'en'] as const) {
      const archive = locale(name).branches.archive
      for (const key of ['open', 'title', 'description', 'action', 'retry']) expect(archive[key], `${name}.${key}`).toBeTruthy()
      expect(archive.title).toContain('{name}')
    }
  })
})

describe('branch restore on the subscription branches page', () => {
  const list = read('app/pages/subscription/branches.vue'), row = read('app/components/subscription/BranchSummary.vue')
  it('offers restore only on an archived extra branch that still has its company, to a branches manager', () => {
    expect(row).toContain(`v-if="archivable && b.state === 'archived' && b.odoo_company_id !== null"`)
    expect(list).toContain(`@restore="openChange('restore', $event)"`)
  })
  it('quotes the restore like an added branch, confirms inline and places the order', () => {
    expect(list).toContain("restore: kind === 'restore' ? [branch.id] : []")
    expect(list).toContain('<SharedInlineConfirm v-if="archiving"')
    expect(list).toContain('api.accept(archiveAction.value')
    expect(list).toContain('QUOTE_IS_EXPIRED(quote.value)')
  })
  it('explains a refusal for a taken name or the extra-branch limit in both languages', () => {
    expect(list).toContain("['branch_name_taken', 'branch_limit_exceeded', 'branch_not_archived']")
    for (const name of ['ar', 'en'] as const) {
      const strings = locale(name).branches
      for (const key of ['open', 'title', 'description', 'action']) expect(strings.restore[key], `${name}.${key}`).toBeTruthy()
      for (const key of ['failed', 'branch_name_taken', 'branch_limit_exceeded', 'branch_not_archived']) expect(strings.refusals[key], `${name}.${key}`).toBeTruthy()
      expect(strings.archive.description).not.toMatch(/support|الدعم/)
    }
  })
})

describe('overlapping branch quotes', () => {
  it('keeps only the newest answer, so a late quote for branch A never sits under branch B', async () => {
    const guard = latestOnly()
    const shown: string[] = []
    const ask = async (branch: string, delay: number) => {
      const ticket = guard.next()
      await new Promise(resolve => setTimeout(resolve, delay))
      if (guard.isCurrent(ticket)) shown.push(branch)
    }
    await Promise.all([ask('A', 20), ask('B', 1)])
    expect(shown).toEqual(['B'])
  })
  it('drops an answer that arrives after the confirmation was closed', () => {
    const guard = latestOnly(), ticket = guard.next()
    guard.cancel()
    expect(guard.isCurrent(ticket)).toBe(false)
  })
  it('the page checks the ticket after every await, shows the answer only from the newest request, and locks the rows while one is pending', () => {
    const list = read('app/pages/subscription/branches.vue')
    expect(list.match(/quoteTickets\.isCurrent\(ticket\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(list).toContain('quoteSubscription.value = sub.id; quoteRevision.value = sub.revision; quote.value = answer')
    expect(list).toContain('hydrated && !archiveBusy')
    expect(list).toContain('function closeArchive() { quoteTickets.cancel();')
  })
})

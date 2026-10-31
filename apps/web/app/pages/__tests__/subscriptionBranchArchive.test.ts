import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (name: 'ar' | 'en') => JSON.parse(read(`i18n/locales/${name}/subscription.json`)).subscription

describe('branch archive on the subscription branches page', () => {
  const list = read('app/pages/subscription/branches.vue'), row = read('app/components/subscription/BranchSummary.vue'), panel = list
  it('offers archive only to a branches manager, on active extra branches, never on the headquarters', () => {
    expect(list).toContain(`:archivable="can('branches.manage') && hydrated"`)
    expect(row).toContain(`v-if="archivable && b.state === 'active'"`)
    expect(row).toContain("summary.items.filter(i => i.kind === 'extra')")
  })
  it('quotes the archive, confirms inline, then places the order and follows it to its status', () => {
    expect(panel).toContain('add: [], archive: [branch.id]')
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
      for (const key of ['open', 'title', 'description', 'action', 'failed', 'retry']) expect(archive[key], `${name}.${key}`).toBeTruthy()
      expect(archive.title).toContain('{name}')
    }
  })
})

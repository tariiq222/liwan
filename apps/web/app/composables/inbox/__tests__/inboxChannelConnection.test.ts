import { describe, expect, it } from 'vitest'
import type { InboxChannelConnection } from '@liwan/contracts'
import { connectionOptionLabel, connectionPagePath, selectableAccounts } from '../inboxChannelConnection'

const account = (extra: Partial<InboxChannelConnection>): InboxChannelConnection => ({
  id: 1, provider: 'meta', external_id: '1029384756', label: 'متجر الورد', app_id: null, state: 'connected', status_message: '', ...extra,
})

describe('inbox channel accounts', () => {
  it('offers only the connected accounts', () => {
    const list = [account({ id: 1 }), account({ id: 2, state: 'error' }), account({ id: 3, state: 'pending' }), account({ id: 4, state: 'disabled' })]
    expect(selectableAccounts(list).map(item => item.id)).toEqual([1])
  })

  it('labels an account by its name, or by the provider id without one', () => {
    expect(connectionOptionLabel({ label: 'متجر الورد', external_id: '1' })).toBe('متجر الورد')
    expect(connectionOptionLabel({ label: '', external_id: '1029384756' })).toBe('1029384756')
  })

  it('links to the account page', () => {
    expect(connectionPagePath(7)).toBe('/settings/integrations/connections/7')
  })
})

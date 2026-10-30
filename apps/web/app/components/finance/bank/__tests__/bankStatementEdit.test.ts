import { describe, expect, it } from 'vitest'
import { FinanceBankStatementPatchSchema } from '@liwan/contracts'
import { statementEditDraft, statementPatch, validateStatementEdit } from '../bankStatementEdit'

const statement = { name: 'May', balance_start: 1000, balance_end_real: 1250.5 }

describe('statement correction', () => {
  it('sends nothing when nothing changed, including a balance retyped to the same cent', () => {
    expect(statementPatch(statement, statementEditDraft(statement))).toBeNull()
    expect(statementPatch(statement, { ...statementEditDraft(statement), balanceEnd: '1250.50' })).toBeNull()
  })

  it('sends only the changed fields, in a body the contract accepts', () => {
    const body = statementPatch(statement, { name: ' May 2026 ', balanceStart: '1000', balanceEnd: '1300' })
    expect(FinanceBankStatementPatchSchema.parse(body)).toEqual({ name: 'May 2026', balance_end_real: 1300 })
  })

  it('needs a name and readable balances', () => {
    expect(validateStatementEdit(statementEditDraft(statement))).toEqual({})
    expect(validateStatementEdit({ name: ' ', balanceStart: '', balanceEnd: 'x' })).toEqual({ name: true, balanceStart: true, balanceEnd: true })
  })
})

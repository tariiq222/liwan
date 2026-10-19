import { z } from 'zod'
import { currency, day, id, list } from './shared'

// Amounts are in the company currency, except the partner statement, whose blocks are per document currency.
const amount = z.number()
const TargetMoveSchema = z.enum(['posted', 'all'])
const KindSchema = z.enum(['receivable', 'payable'])
const LedgerAccountSchema = z.object({ id, code: z.string(), name: z.string() }).strict()
const PartnerRefSchema = z.object({ id, name: z.string() }).strict()
const header = {
  target_move: TargetMoveSchema,
  currency,
}

export const FinanceTrialBalanceAmountsSchema = z.object({
  initial_balance: amount,
  debit: amount,
  credit: amount,
  balance: amount,
  ending_balance: amount,
}).strict()

export const FinanceTrialBalanceRowSchema = FinanceTrialBalanceAmountsSchema.extend({
  account: LedgerAccountSchema,
}).strict()

/** Trial balance of a period; the totals of a complete ledger have `debit == credit` and zero balances. */
export const FinanceTrialBalanceSchema = z.object({
  date_from: day,
  date_to: day,
  ...header,
  accounts: z.array(FinanceTrialBalanceRowSchema),
  totals: FinanceTrialBalanceAmountsSchema,
}).strict()

export const FinanceLedgerLineSchema = z.object({
  id,
  date: day,
  entry: z.string(),
  /** The journal code. */
  journal: z.string(),
  partner: PartnerRefSchema.nullable(),
  label: z.string(),
  debit: amount,
  credit: amount,
  /** The running balance of the account after this line. */
  balance: amount,
}).strict()

export const FinanceLedgerAccountSchema = z.object({
  account: LedgerAccountSchema,
  initial_balance: amount,
  debit: amount,
  credit: amount,
  ending_balance: amount,
  /** One page (`limit`/`offset`) of the account's lines in date order; `items` is empty unless the request names the account, `total` always counts the period's lines. */
  lines: list(FinanceLedgerLineSchema),
}).strict()

export const FinanceGeneralLedgerSchema = z.object({
  date_from: day,
  date_to: day,
  ...header,
  accounts: z.array(FinanceLedgerAccountSchema),
}).strict()

const agedBuckets = {
  current: amount,
  days_1_30: amount,
  days_31_60: amount,
  days_61_90: amount,
  days_91_120: amount,
  days_over_120: amount,
  total: amount,
}

/** `partner` is null for items posted without a partner. */
export const FinanceAgedPartnerSchema = z.object({ partner: PartnerRefSchema.nullable(), ...agedBuckets }).strict()

export const FinanceAgedAccountSchema = z.object({
  account: LedgerAccountSchema,
  ...agedBuckets,
  partners: z.array(FinanceAgedPartnerSchema),
}).strict()

/** Open balances as of `date_to`, aged from their due date. */
export const FinanceAgedPartnerBalanceSchema = z.object({
  date_to: day,
  kind: KindSchema,
  ...header,
  accounts: z.array(FinanceAgedAccountSchema),
  totals: z.object(agedBuckets).strict(),
}).strict()

export const FinanceStatementLineSchema = z.object({
  date: day,
  date_due: day,
  entry: z.string(),
  ref: z.string(),
  label: z.string(),
  debit: amount,
  credit: amount,
  open_amount: amount,
  /** The running balance (activity statements only). */
  balance: amount.nullable(),
}).strict()

export const FinanceStatementCurrencySchema = z.object({
  currency,
  balance_forward: amount,
  amount_due: amount,
  ending_balance: amount,
  lines: z.array(FinanceStatementLineSchema),
  buckets: z.object(agedBuckets).strict().nullable(),
}).strict()

export const FinancePartnerStatementSchema = z.object({
  type: z.enum(['activity', 'outstanding']),
  kind: KindSchema,
  partner: PartnerRefSchema,
  /** Null for an outstanding statement. */
  date_from: day.nullable(),
  date_to: day,
  currencies: z.array(FinanceStatementCurrencySchema),
}).strict()

/** One figure of a MIS report: `code` is stable (the KPI name), `label` its English description. */
export const FinanceReportLineSchema = z.object({
  code: z.string().min(1),
  label: z.string(),
  value: amount,
}).strict()

export const FinanceProfitLossSchema = z.object({
  date_from: day,
  date_to: day,
  ...header,
  lines: z.array(FinanceReportLineSchema),
}).strict()

export const FinanceBalanceSheetSchema = z.object({
  date_to: day,
  ...header,
  lines: z.array(FinanceReportLineSchema),
}).strict()

/** A simplified Zakat base: the formula must be reviewed by a Saudi CPA (`disclaimer`) before it is relied on. */
export const FinanceZakatBaseSchema = z.object({
  date_to: day,
  ...header,
  lines: z.array(FinanceReportLineSchema),
  base: amount,
  rate: z.number(),
  zakat_due: amount,
  disclaimer: z.string().min(1),
}).strict()

export type FinanceTrialBalance = z.infer<typeof FinanceTrialBalanceSchema>
export type FinanceGeneralLedger = z.infer<typeof FinanceGeneralLedgerSchema>
export type FinanceAgedPartnerBalance = z.infer<typeof FinanceAgedPartnerBalanceSchema>
export type FinancePartnerStatement = z.infer<typeof FinancePartnerStatementSchema>
export type FinanceReportLine = z.infer<typeof FinanceReportLineSchema>
export type FinanceProfitLoss = z.infer<typeof FinanceProfitLossSchema>
export type FinanceBalanceSheet = z.infer<typeof FinanceBalanceSheetSchema>
export type FinanceZakatBase = z.infer<typeof FinanceZakatBaseSchema>

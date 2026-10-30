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

const managementInformation = {
  statutory: z.literal(false),
  status: z.literal('management_information'),
}

export const FinanceProfitLossSchema = z.object({
  date_from: day,
  date_to: day,
  ...header,
  ...managementInformation,
  lines: z.array(FinanceReportLineSchema),
}).strict()

export const FinanceBalanceSheetSchema = z.object({
  date_to: day,
  ...header,
  ...managementInformation,
  lines: z.array(FinanceReportLineSchema),
}).strict()

export const FinanceZakatAdjustmentSchema = z.object({
  id,
  date_to: day,
  kind: z.enum(['add', 'deduct']),
  label: z.string(),
  amount: z.number().positive(),
  note: z.string(),
}).strict()

/** An accountant's review of the computation as it stood; `current` is false once the books or the adjustments changed. */
export const FinanceZakatReviewSchema = z.object({
  id,
  date_to: day,
  reviewer: z.object({ id, name: z.string() }).strict(),
  /** The credential the reviewer states (for example a SOCPA licence); LiwanOS does not verify it. */
  credential: z.string().min(1),
  note: z.string(),
  reviewed_at: z.string().datetime(),
  base: amount,
  zakat_due: amount,
  current: z.boolean(),
}).strict()

/**
 * A simplified Zakat base. `template_base` is the books' figure; `base` and `zakat_due` include the company's adjustments.
 * `status` is `management_information` until a review exists, `reviewed` while the latest review matches, `review_stale`
 * after a change. `filed` is always false: LiwanOS never files, and even a reviewed computation is the taxpayer's to file.
 */
export const FinanceZakatBaseSchema = z.object({
  date_to: day,
  ...header,
  lines: z.array(FinanceReportLineSchema),
  template_base: amount,
  adjustments: z.array(FinanceZakatAdjustmentSchema),
  adjustments_total: amount,
  base: amount,
  rate: z.number(),
  zakat_due: amount,
  status: z.enum(['management_information', 'reviewed', 'review_stale']),
  filed: z.literal(false),
  review: FinanceZakatReviewSchema.nullable(),
  disclaimer: z.string().min(1),
}).strict()

export const FinanceZakatAdjustmentListSchema = list(FinanceZakatAdjustmentSchema)
export const FinanceZakatReviewListSchema = list(FinanceZakatReviewSchema)

/** POST /finance/zakat/adjustments (`finance.zakat.manage`). */
export const FinanceZakatAdjustmentInputSchema = z.object({
  date_to: day,
  kind: z.enum(['add', 'deduct']),
  label: z.string().min(1).max(255),
  amount: z.number().positive(),
  note: z.string().max(255).optional(),
}).strict()

/** POST /finance/zakat/reviews (`finance.zakat.review`): the reviewer states their credential. */
export const FinanceZakatReviewInputSchema = z.object({
  date_to: day,
  credential: z.string().min(1).max(255),
  note: z.string().max(255).optional(),
}).strict()

export type FinanceTrialBalance = z.infer<typeof FinanceTrialBalanceSchema>
export type FinanceGeneralLedger = z.infer<typeof FinanceGeneralLedgerSchema>
export type FinanceAgedPartnerBalance = z.infer<typeof FinanceAgedPartnerBalanceSchema>
export type FinancePartnerStatement = z.infer<typeof FinancePartnerStatementSchema>
export type FinanceReportLine = z.infer<typeof FinanceReportLineSchema>
export type FinanceProfitLoss = z.infer<typeof FinanceProfitLossSchema>
export type FinanceBalanceSheet = z.infer<typeof FinanceBalanceSheetSchema>
export type FinanceZakatBase = z.infer<typeof FinanceZakatBaseSchema>
export type FinanceZakatAdjustment = z.infer<typeof FinanceZakatAdjustmentSchema>
export type FinanceZakatReview = z.infer<typeof FinanceZakatReviewSchema>
export type FinanceZakatAdjustmentInput = z.infer<typeof FinanceZakatAdjustmentInputSchema>
export type FinanceZakatReviewInput = z.infer<typeof FinanceZakatReviewInputSchema>

const CashFlowItemSchema = z.object({ account: LedgerAccountSchema, amount }).strict()

/**
 * GET /finance/reports/cash-flow?date_from&date_to: the statement of cash flows by the indirect method, from the posted
 * journal items (year-end closing entries left out). An amount is positive when cash comes in. `difference` is the check
 * against the change of the cash accounts and is zero when the statement closes. `statutory` is always false: it is an
 * accounting statement built from the books, not a filed one.
 */
export const FinanceCashFlowSchema = z.object({
  date_from: day,
  date_to: day,
  currency,
  basis: z.literal('indirect'),
  statutory: z.literal(false),
  opening_cash: amount,
  closing_cash: amount,
  net_change: amount,
  operating: z.object({
    net_income: amount,
    adjustments: z.array(z.object({ key: z.literal('depreciation'), amount }).strict()),
    /** Changes of receivables, payables and other current accounts. */
    items: z.array(CashFlowItemSchema),
    total: amount,
  }).strict(),
  investing: z.object({
    items: z.array(CashFlowItemSchema),
    /** Depreciation taken out of the fixed asset accounts' change, so only purchases and sales remain. */
    depreciation_reclass: amount,
    total: amount,
  }).strict(),
  financing: z.object({ items: z.array(CashFlowItemSchema), total: amount }).strict(),
  total_change: amount,
  difference: amount,
}).strict()

export type FinanceCashFlow = z.infer<typeof FinanceCashFlowSchema>

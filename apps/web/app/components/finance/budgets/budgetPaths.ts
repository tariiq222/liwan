export const BUDGETS_PATH = '/finance/budgets'

export const budgetRecordPath = (id: number) => `${BUDGETS_PATH}/${id}`

/** A period as one text: both days, the earlier first. */
export const budgetPeriod = (period: { date_from: string; date_to: string }) => `${period.date_from} – ${period.date_to}`

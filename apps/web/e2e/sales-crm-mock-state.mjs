// What the CRM mock and the Sales mock share about the Sales bridge, so neither imports the other's state for it.
// `plan`: Sales is in the plan beside CRM (`POST /api/v1/__mock/crm-win-by-order {on, can_quote}` in crm-ui-preview-data.mjs).
// `win`: the Sales setting `opportunity_win` (kept by sales-mock-routes.mjs). An order wins an opportunity while both say so.
const state = { plan: false, canQuote: true, win: 'order_confirmed' }

export const salesCrmPlan = () => state.plan
export const salesCrmWinByOrder = () => state.plan && state.win === 'order_confirmed'
export const salesCrmCanQuote = () => state.canQuote
export const setSalesCrmPlan = (plan, canQuote = true) => { state.plan = plan; state.canQuote = canQuote }
export const setSalesCrmWin = win => { state.win = win }

// What the Sales mock and its Finance bridge share: whether Finance is in the plan beside Sales (the switch
// `POST /api/v1/public/sales/__mock/finance {on}` in sales-mock-routes.mjs). Off, an order shows no invoicing and the settings carry no
// down payment choice, as for a tenant without Finance.
const state = { plan: false }

export const salesFinancePlan = () => state.plan
export const setSalesFinancePlan = on => { state.plan = on }

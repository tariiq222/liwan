// Opt-in isolated preview of the earned value route (PROJECTS_UI_PREVIEW=1). Never connected to an Odoo database.
// Project 2 «مشروع بيتا» holds baselines and answers the worked example of the maths test (a 120 000 budget, 48 000 spent,
// read on 2026-03-15); project 3 has none, so it answers 409 `no_baseline`. POST /api/v1/__mock/evm-variant {name} shapes the
// answer for a spec and an empty name restores the worked example.
const CURRENCY = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }
const CURVE = [
  { date: '2026-03-01', pv: 0 }, { date: '2026-03-08', pv: 12000 }, { date: '2026-03-15', pv: 60000 },
  { date: '2026-03-22', pv: 96000 }, { date: '2026-03-29', pv: 114000 }, { date: '2026-03-30', pv: 120000 },
]
const WORKED = {
  project_id: 2, baseline_number: 2, computed_at: '2026-03-15T09:00:00Z', as_of: '2026-03-15', currency: CURRENCY, method: 'manual',
  hidden_count: 0, undated_count: 0, bac: 120000, pv: 60000, ev: 42000, ac: 48000, sv: -18000, cv: -6000, spi: 0.7, cpi: 0.88,
  eac: 137142.86, etc: 89142.86, vac: -17142.86, tcpi: 1.08, planned_curve: CURVE,
}
const VARIANTS = {
  healthy: { ev: 66000, sv: 6000, cv: 18000, spi: 1.1, cpi: 1.38, eac: 86956.52, etc: 38956.52, vac: 33043.48, tcpi: 0.55 },
  warning: { ev: 57000, sv: -3000, cv: 9000, spi: 0.95, cpi: 0.97, eac: 123711.34, etc: 75711.34, vac: -3711.34, tcpi: 1.04 },
  empty: { bac: 0, pv: null, ev: null, sv: null, planned_curve: [], cv: null, spi: null, cpi: null, eac: null, etc: null, vac: null, tcpi: null, ac: 0, hidden_count: 2, undated_count: 1 },
}

let variant = ''

export async function handleEvm(req, res, path, url, { json, readBody }) {
  if (req.method === 'POST' && path === '/api/v1/__mock/evm-variant') {
    variant = JSON.parse(await readBody(req) || '{}').name ?? ''
    return json(res, 200, { ok: true }) || true
  }
  const match = path.match(/^\/api\/v1\/projects\/(\d+)\/evm$/)
  if (!match || req.method !== 'GET') return false
  const projectId = Number(match[1])
  if (projectId === 3) return json(res, 409, { code: 'no_baseline', message: 'take a baseline before reading earned value' }) || true
  if (projectId !== 2) return json(res, 404, { code: 'not_found', message: 'Record does not exist' }) || true
  return json(res, 200, { ...WORKED, ...VARIANTS[variant] }) || true
}

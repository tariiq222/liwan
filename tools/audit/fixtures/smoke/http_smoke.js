// A one-request k6 smoke. It proves the harness reaches its target and checks the status and a marker;
// it is not a load test, so it uses one VU for one iteration and never ramps.
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
}

export default function () {
  const target = __ENV.TARGET
  if (!target) throw new Error('TARGET is required')
  const response = http.get(target)
  check(response, {
    'status is 200': (result) => result.status === 200,
    'body is not empty': (result) => String(result.body || '').length > 0,
  })
}

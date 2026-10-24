// Auth storm: pure login ramp to 5000 concurrent users.
// Measures the authentication ceiling (Odoo pbkdf2 hashing + session creation).
import http from 'k6/http';
import { check, sleep } from 'k6';

import { LOGIN, PASSWORD } from './credentials.js';

const BASE = __ENV.BASE || 'http://[::1]:3100';

export const options = {
  scenarios: {
    storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '45s', target: 500 },
        { duration: '45s', target: 1000 },
        { duration: '90s', target: 2000 },
        { duration: '180s', target: 5000 },
        { duration: '60s', target: 5000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
};

export default function () {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ login: LOGIN, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' }, timeout: '120s' },
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  sleep(1);
}

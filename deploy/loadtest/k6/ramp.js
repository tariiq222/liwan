// Main ramp: 100 -> 5000 concurrent virtual users against the WebVue stack.
// Each VU logs in once (real session cookie, sent explicitly on every request),
// then loops a realistic browse mix:
// SSR pages (/ , /tasks , /projects) + API reads (/api/v1/me , /api/v1/projects , /api/v1/notifications).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://[::1]:3100';
const LOGIN = __ENV.LOGIN || 'admin';
const PASSWORD = __ENV.PASSWORD || 'LoadTest2026!';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '45s', target: 500 },
        { duration: '45s', target: 1000 },
        { duration: '90s', target: 2000 },
        { duration: '180s', target: 5000 },
        { duration: '120s', target: 5000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  // Reporting thresholds only; nothing aborts, we want to find the ceiling.
  thresholds: {
    'http_req_duration{name:login}': ['p(95)<5000'],
  },
};

let sessionCookie = null;

function authHeaders() {
  return { 'Content-Type': 'application/json', Cookie: `session_id=${sessionCookie}` };
}

function loginOnce() {
  if (sessionCookie) return;
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ login: LOGIN, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' }, timeout: '120s' },
  );
  if (res.status === 200 && res.cookies.session_id) {
    sessionCookie = res.cookies.session_id[0].value;
  }
}

const PAGES = ['/', '/tasks', '/projects'];
const APIS = ['/api/v1/me', '/api/v1/projects', '/api/v1/notifications'];

export default function () {
  loginOnce();
  if (!sessionCookie) { sleep(2); return; }
  const page = PAGES[Math.floor(Math.random() * PAGES.length)];
  http.get(`${BASE}${page}`, { headers: authHeaders(), tags: { name: 'page_' + page }, timeout: '120s' });
  const api = APIS[Math.floor(Math.random() * APIS.length)];
  http.get(`${BASE}${api}`, { headers: authHeaders(), tags: { name: 'api_' + api }, timeout: '120s' });
  sleep(1);
}

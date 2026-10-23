// Smoke test: validates the full authenticated flow before the big ramp.
// k6's default cookie jar does not persist across iterations, so the session
// cookie captured at login is sent explicitly on every request.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://[::1]:3100';
const LOGIN = __ENV.LOGIN || 'admin';
const PASSWORD = __ENV.PASSWORD || 'LoadTest2026!';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
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
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  if (res.status === 200 && res.cookies.session_id) {
    sessionCookie = res.cookies.session_id[0].value;
  }
}

export default function () {
  loginOnce();
  if (!sessionCookie) { sleep(1); return; }
  const me = http.get(`${BASE}/api/v1/me`, { headers: authHeaders(), tags: { name: 'api_me' } });
  check(me, { 'me 200': (r) => r.status === 200 });
  const projects = http.get(`${BASE}/api/v1/projects`, { headers: authHeaders(), tags: { name: 'api_projects' } });
  check(projects, { 'projects 200': (r) => r.status === 200 });
  const home = http.get(`${BASE}/`, { headers: authHeaders(), tags: { name: 'page_home' } });
  check(home, { 'home 200': (r) => r.status === 200 });
  const tasks = http.get(`${BASE}/tasks`, { headers: authHeaders(), tags: { name: 'page_tasks' } });
  check(tasks, { 'tasks 200': (r) => r.status === 200 });
  sleep(1);
}

// Concurrency probe: classifies what actually fails at high concurrency (node:http only).
const http = require('node:http');
const url = new URL(process.env.BASE || 'http://[::1]:3100');
const HOST = url.hostname.replace(/^\[|\]$/g, '');
const PORT = url.port;
const CONC = parseInt(process.env.CONC || '1000', 10);
const TOTAL = parseInt(process.env.TOTAL || '2000', 10);
const PATH = process.env.PATH_ || '/api/v1/me';

const agent = new http.Agent({
  host: HOST,
  port: PORT,
  maxSockets: CONC,
  keepAlive: true,
  maxFreeSockets: CONC,
});

const counts = { ok: 0, status: {}, err: {} };
const lat = [];
let done = 0;
const t0 = Date.now();

function one() {
  return new Promise((resolve) => {
    const s = Date.now();
    const req = http.request(
      { host: HOST, port: PORT, path: PATH, method: 'GET', agent, headers: { Cookie: process.env.COOKIE || 'session_id=probe' } },
      (res) => {
        const ms = Date.now() - s;
        lat.push(ms);
        counts.ok++;
        counts.status[res.statusCode] = (counts.status[res.statusCode] || 0) + 1;
        res.resume();
        res.on('end', () => { done++; resolve(); });
      },
    );
    req.on('error', (e) => {
      const key = e.code || e.name || 'unknown';
      counts.err[key] = (counts.err[key] || 0) + 1;
      done++;
      resolve();
    });
    req.setTimeout(60000, () => req.destroy(new Error('client-timeout')));
    req.end();
  });
}

(async () => {
  const queue = Array.from({ length: TOTAL }, () => one());
  await Promise.all(queue);
  const wall = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((lat.length * p) / 100))] : 0);
  console.log(`conc=${CONC} total=${TOTAL} path=${PATH} wall=${wall.toFixed(1)}s rps=${(TOTAL / wall).toFixed(0)}`);
  console.log(`ok=${counts.ok} p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`);
  console.log('statuses:', JSON.stringify(counts.status));
  console.log('errors:', JSON.stringify(counts.err));
  agent.destroy();
})();
